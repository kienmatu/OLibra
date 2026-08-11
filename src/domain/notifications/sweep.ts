import type { Clock } from "../kernel/clock";
import type { Sql } from "postgres";
import type { TransactionSql } from "postgres";

export interface SweepResult {
  dueSoon: number;
  overdue: number;
}

/**
 * The one scheduled job this system permits, and the reasoning for the
 * exception is worth keeping next to the code.
 *
 * BR §8 is emphatic that overdue *status* is computed on read and never written
 * by a job, and every other slice honours that — `loans_current.is_overdue`
 * derives from `olibra_now()` with no column behind it. A *notification* cannot
 * work that way, because "has this reader already been told" is itself state:
 * you cannot compute a dismissible record on read without either telling
 * somebody twice or losing the fact that they were told.
 *
 * So OPS §7 permits exactly this sweep, and bounds it: *"if it doesn't run for a
 * few hours, nothing a user can observe becomes wrong (the loan's overdue badge
 * is still correct, computed live), only late to be told."* That bound is the
 * acceptance criterion, and it is a test —
 * `tests/domain/notifications/the-sweep-is-housekeeping.test.ts` advances the
 * clock past a due date **without running this** and asserts the badge, the
 * dashboard count and the overdue list are all already right.
 *
 * **Idempotent by a `not exists`, not by a cursor.** Running it twice in a day
 * must not tell a child twice, and the honest key for "already told" is the
 * notification itself: there is no separate `last_swept_at` to drift, get
 * rolled back, or be reset by a restore. The predicate is per loan and per kind,
 * so a loan that was warned as due-soon still gets its overdue notification when
 * it lapses — two different things to say about one book.
 *
 * **It runs as `olibra_admin`, across every shelf.** This is the one caller in
 * the system with no tenant to scope to: a nightly job serves all parishes, and
 * a per-shelf loop would need a list of shelves that is itself a cross-shelf
 * read. `bookshelf_id` is copied from each loan onto the notification it
 * produces, so every row it writes is correctly scoped even though the reader
 * that produced it was not.
 *
 * It is deliberately **not** a `Command`: it has no actor (INV-8 would have
 * nobody to name), it spans shelves, and it writes no audit entry, because
 * nothing about the shelf's record changed — a book became late on its own.
 *
 * **`dueInDays` is a fallback now, not the only window — QA remediation
 * Task 24.** Task 23 gave `due_soon_days` a real per-shelf column
 * (`bookshelves.settings`, `coalesce((settings->>'due_soon_days')::int, 3)`,
 * writable through `updateBookshelfSettings`, shown on `/quan-ly/cai-dat` as
 * "Báo sắp đến hạn trước") and left this function unchanged on purpose —
 * `get-shelf-settings.ts`'s module note says so explicitly: "wiring the
 * nightly sweep to read this per shelf is a separate piece of work this task
 * does not do." Until Task 24 that made the setting inert: a manager could
 * raise it to 7 days, watch the form save, and every reminder would keep
 * arriving at 3 forever, silently, because nothing this job ran ever looked
 * at the column. The paragraph above's key-set architecture test
 * (`every-shown-policy-is-editable.test.ts`) cannot catch that particular
 * failure — it compares what a screen shows against what a command can
 * change, not what a nightly job actually obeys, and this job is not a
 * command. `tests/domain/notifications/the-sweep-is-housekeeping.test.ts`'s
 * "a shelf's own due_soon_days sets its window" is the test that closes it.
 *
 * **The fix is the due-soon query's shape, not this job's scoping — the
 * paragraph above still holds.** "No tenant to scope to" is an argument
 * against turning this into something that loops per shelf, takes a
 * `TenantContext`, or reads a cross-shelf list of shelves to iterate — none
 * of which changed. The due-soon `insert…select` below now also joins
 * `bookshelves` and reads `coalesce((bs.settings->>'due_soon_days')::int,
 * dueInDays)` per row, exactly the way it already reads `l.bookshelf_id`
 * per row to write a correctly-scoped notification from an unscoped read.
 * A join inside one still-single, still-cross-shelf query is not a per-shelf
 * loop; `dueInDays` (still defaulting to 3, still a parameter, per the note
 * below) is what a shelf falls back to when it has never set its own value,
 * the same role `3` already plays in `get-shelf-settings.ts`'s identical
 * `coalesce`. The overdue query is untouched — a lapsed loan is late
 * regardless of how many days' warning its shelf asked for, so no shelf
 * setting was ever a candidate to enter that half.
 */
export async function sweepDueNotifications(
  sql: Sql,
  clock: Clock,
  options: { dueInDays?: number } = {},
): Promise<SweepResult> {
  // BR §16.2 shows the reader dashboard warning before a book is due; three days
  // is the window, and it is a parameter so a shelf-level setting can supersede
  // it later without this function changing shape. QA remediation Task 24 is
  // that "later": `dueInDays` is now the fallback the query's own `coalesce`
  // reaches for when a shelf's `settings` carries no `due_soon_days` of its
  // own — see the module note above for why that is a query-shape change and
  // not a scoping one.
  const dueInDays = options.dueInDays ?? 3;
  const today = clock.today();

  return sql.begin(async (tx: TransactionSql) => {
    await tx`set local role olibra_admin`;

    const dueSoon = await tx<{ id: string }[]>`
      insert into notifications (bookshelf_id, user_id, kind, payload)
      select l.bookshelf_id, l.borrower_id, 'loan_due_soon',
             jsonb_build_object('title', b.title, 'due_on', l.due_on::text)
        from loans l
        join books b on b.id = l.book_id
        join bookshelves bs on bs.id = l.bookshelf_id
       where l.status = 'active'
         and l.due_on >= ${today}::date
         and l.due_on <= ${today}::date
           + coalesce((bs.settings->>'due_soon_days')::int, ${dueInDays}::int)
         and not exists (
           select 1 from notifications n
            where n.user_id = l.borrower_id
              and n.kind = 'loan_due_soon'
              and n.payload->>'due_on' = l.due_on::text
              and n.payload->>'title' = b.title
         )
      returning id
    `;

    const overdue = await tx<{ id: string }[]>`
      insert into notifications (bookshelf_id, user_id, kind, payload)
      select l.bookshelf_id, l.borrower_id, 'loan_overdue',
             jsonb_build_object('title', b.title, 'due_on', l.due_on::text)
        from loans l
        join books b on b.id = l.book_id
       where l.status = 'active'
         and l.due_on < ${today}::date
         and not exists (
           select 1 from notifications n
            where n.user_id = l.borrower_id
              and n.kind = 'loan_overdue'
              and n.payload->>'due_on' = l.due_on::text
              and n.payload->>'title' = b.title
         )
      returning id
    `;

    return { dueSoon: dueSoon.length, overdue: overdue.length };
  });
}
