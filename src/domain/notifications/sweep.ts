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
 */
export async function sweepDueNotifications(
  sql: Sql,
  clock: Clock,
  options: { dueInDays?: number } = {},
): Promise<SweepResult> {
  // BR §16.2 shows the reader dashboard warning before a book is due; three days
  // is the window, and it is a parameter so a shelf-level setting can supersede
  // it later without this function changing shape.
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
       where l.status = 'active'
         and l.due_on >= ${today}::date
         and l.due_on <= ${today}::date + ${dueInDays}::int
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
