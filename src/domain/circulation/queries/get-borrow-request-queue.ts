import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
// Imported rather than restated, for the reason `../commands/lend-copy.ts`
// records: two identical copies of `requireManager` already exist and each says
// the tidy end state is one copy in the kernel. This file takes the catalogue's,
// as `./get-overdue-loans.ts` beside it does.
import { requireManager } from "../../catalogue/policy";
import { loadParishContext } from "../../members/parish-context";
import { describeSelection } from "../../members/parish-taxonomy";

/** The two statuses a request occupies while somebody is still waiting on it. */
export type QueuedStatus = "pending" | "approved";

export interface QueuedRequestRow {
  requestId: string;
  /**
   * 1-based, within this title's queue — OPS §3.3 lists it under "derived on
   * read", and it is: `row_number()` over the same ordering the rows come back
   * in. Never a stored column, because a stored position is wrong the moment
   * anybody ahead cancels.
   */
  position: number;
  /**
   * `memberships.id` for the reader, or `null` when they hold no membership of
   * this shelf any more. The queue row survives them leaving —
   * `borrow_requests.member_id` is a `users(id)` and carries no membership — so
   * the screen has to be able to render a name with no profile to link to.
   */
  membershipId: string | null;
  /** `borrow_requests.member_id`, which is a `users(id)` despite its name. */
  readerUserId: string;
  readerName: string;
  /** The shelf's own words for the reader's parish unit, or `""`. */
  parishLine: string;
  requestedAt: string;
  status: QueuedStatus;
  copyId: string | null;
  copyCode: string | null;
  holdExpiresAt: string | null;
  /**
   * OPS §3.3's "hold-expired flag (§8)" — `hold_expires_at <= olibra_now()`,
   * decided by the transaction's clock and by nothing written. `false` for a
   * `pending` row, which has no hold to have expired.
   */
  holdExpired: boolean;
}

export interface BookQueue {
  bookId: string;
  title: string;
  author: string;
  slug: string;
  /** `requests.length`, named so a screen does not have to explain itself. */
  waiting: number;
  requests: QueuedRequestRow[];
}

/**
 * OPS §3.3's `GetBorrowRequestQueue` — "requests grouped by book, in
 * request-time order", returning "per book: queue position, requester, status,
 * hold expiry where approved".
 *
 * ── What counts as being in the queue ────────────────────────────────────────
 *
 * `pending` and `approved`, and nothing else. BR §7.2 defines the queue as "the
 * set of pending requests for that title", and on its own that would drop the
 * one row the manager most needs to see: the child whose turn has come, whose
 * copy is on the shelf with their name on it, and who has to be handed the book
 * before the hold lapses. `rejected`, `cancelled` and `fulfilled` are terminal
 * and nobody is waiting on them; `expired` is the status a lapsed hold *would*
 * carry if anything wrote it, and nothing does — expiry is derived on read
 * (BR §8), which is why `holdExpired` below is computed rather than filtered on.
 *
 * An expired hold therefore stays on this screen, flagged. That is deliberate:
 * the copy is still sitting in `held` with nobody coming for it, and a manager
 * has to record `held → available` or offer it to the next reader. Dropping the
 * row would hide the one thing that needs doing.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 *
 * There is no `where bookshelf_id` anywhere in the statement, deliberately.
 * `borrow_requests`, `books`, `book_copies` and `memberships` all carry
 * `<table>_tenant` policies keyed on `olibra.bookshelf_id` (`0010_rls.sql`),
 * which `runQuery` sets; `users` carries none at all, so the join to it can only
 * narrow what `borrow_requests` already admitted, never widen it. A queue is
 * exactly the shape of query where a missing predicate looks like a working
 * feature — every parish's children, in one list, sorted plausibly — so the
 * property is a test rather than a comment: `borrow-request-queue.test.ts` runs
 * this function unchanged under `olibra_admin`, which holds `bypassrls`, and
 * asserts the other shelf's rows then appear.
 *
 * `users` is joined directly rather than through `memberships`, and
 * `memberships` is joined *outward* for its id alone. Joining through it would
 * drop every request whose reader has since left the shelf — and a child who
 * queued and then left is precisely the row a manager needs to see in order to
 * clear it.
 *
 * ── The order is total, and one half of it is folded ─────────────────────────
 *
 * Within a title: `requested_at`, then `r.id`. BR §7.2 gives the first and this
 * project has shipped an untiebroken order twice — U2 measured 304 distinct
 * titles collapsing to 229 across a paged walk, and U3 found two tiebreak tests
 * that were green against the broken query. Two children queueing after the same
 * Sunday mass share a `requested_at` to the second, and without `r.id` the two
 * come back in whatever order the plan produced — so the *position numbers* on
 * the screen change between two reads of unchanged data, which is a queue a
 * child's turn moves around in.
 *
 * Between titles: `olibra_fold(b.title)`, then `b.id`. This cluster's collation
 * is `C`, so byte order is the order and `Đ` sorts above every ASCII letter —
 * every *Đất Rừng Phương Nam* would come before every *Alice*, at the top of the
 * list rather than where a volunteer looks for it. The same defect U2 found in
 * two catalogue queries and U3 in `getReadersList`.
 *
 * **It is not paged**, for the reason `getOverdueLoans` records: the set is
 * bounded by its own state rather than by the size of the shelf. The order is
 * total anyway, so adding `limit`/`offset` later is two lines rather than a
 * re-derivation — which is the expensive half of the paging trap.
 *
 * ── `bookId` narrows it to one title, for the return flow ────────────────────
 *
 * OPS §5 step 3: the return screen surfaces, before confirmation, "whether
 * anyone is waiting for this title (`GetBorrowRequestQueue`'s data, read at this
 * point)". One query with an optional filter rather than a second function,
 * because the manager on that screen and the manager on the queue screen are
 * being shown the same fact and must not be shown two different answers to it.
 */
export async function getBorrowRequestQueue(
  tx: Tx,
  ctx: TenantContext,
  input: { bookId?: string } = {},
): Promise<BookQueue[]> {
  requireManager(ctx);

  const bookId = input.bookId ?? null;

  const rows = await tx<
    {
      request_id: string;
      position: number;
      book_id: string;
      title: string;
      author: string;
      slug: string;
      membership_id: string | null;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      reader_user_id: string;
      reader_name: string;
      requested_at: string;
      status: QueuedStatus;
      copy_id: string | null;
      copy_code: string | null;
      hold_expires_at: string | null;
      hold_expired: boolean;
    }[]
  >`
    select
      r.id as request_id,
      -- OPS §3.3's "queue position", derived on read. The partition and the
      -- ordering are the same two keys the outer order by uses, so the number
      -- printed beside a row and the row's place in the list cannot disagree.
      row_number() over (
        partition by r.book_id order by r.requested_at asc, r.id asc
      )::int as position,
      r.book_id, b.title, b.author, b.slug,
      m.id as membership_id, m.parish_unit_l1_id, m.parish_unit_l2_id,
      r.member_id as reader_user_id,
      u.full_name as reader_name,
      r.requested_at::text as requested_at,
      r.status,
      r.copy_id, c.code as copy_code,
      r.hold_expires_at::text as hold_expires_at,
      -- BR §8, derived against the injected clock: no job writes the expired
      -- status, so a hold stops standing because olibra_now() passed it.
      -- coalesce, because a pending row has no hold and null is not a flag.
      coalesce(r.hold_expires_at <= olibra_now(), false) as hold_expired
    from borrow_requests r
    join books b on b.id = r.book_id and b.deleted_at is null
    -- users carries no RLS policy at all, so this can only narrow.
    join users u on u.id = r.member_id and u.deleted_at is null
    -- Outward, for the id and the parish placement alone. An inner join here
    -- would drop every request whose reader has since left the shelf, which is
    -- exactly the row a manager needs in order to clear it.
    left join memberships m on m.user_id = r.member_id and m.deleted_at is null
    left join book_copies c on c.id = r.copy_id
    where r.status in ('pending', 'approved')
      and r.deleted_at is null
      and (${bookId}::uuid is null or r.book_id = ${bookId})
    order by olibra_fold(b.title) asc, b.id asc, r.requested_at asc, r.id asc
  `;

  const { taxonomy, units } = await loadParishContext(tx, ctx);

  // Grouped in TypeScript rather than with `json_agg`, because the rows arrive
  // in the grouping order already — so this is one pass with no sort — and
  // because `describeSelection` is the domain's own function for the shelf's
  // wording and cannot be called from inside SQL.
  const queues: BookQueue[] = [];
  for (const r of rows) {
    let queue = queues.at(-1);
    if (!queue || queue.bookId !== r.book_id) {
      queue = {
        bookId: r.book_id,
        title: r.title,
        author: r.author,
        slug: r.slug,
        waiting: 0,
        requests: [],
      };
      queues.push(queue);
    }
    queue.requests.push({
      requestId: r.request_id,
      position: r.position,
      membershipId: r.membership_id,
      readerUserId: r.reader_user_id,
      readerName: r.reader_name,
      parishLine: describeSelection(taxonomy, units, {
        l1: r.parish_unit_l1_id,
        l2: r.parish_unit_l2_id,
      }),
      requestedAt: r.requested_at,
      status: r.status,
      copyId: r.copy_id,
      copyCode: r.copy_code,
      holdExpiresAt: r.hold_expires_at,
      holdExpired: r.hold_expired,
    });
    queue.waiting = queue.requests.length;
  }
  return queues;
}

/**
 * How many readers are waiting across the whole shelf — the sidebar's
 * *Yêu cầu mượn* badge.
 *
 * **Counted the way the list is selected, not a shorter way that happens to
 * agree today.** `getManagerBadgeCounts`' own docstring states the rule and why:
 * "a badge that disagrees with the list it links to is worse than no badge —
 * the volunteer clicks *Yêu cầu mượn 5*, counts four cards, and now has to
 * decide which of the two the software means." So this is the same
 * `status in ('pending','approved')`, the same two `deleted_at is null`, and the
 * same joins to `books` and `users` that could drop a row.
 *
 * It is a separate statement rather than `queue.length` for the reason the
 * dashboard has one: the sidebar renders on *every* manager page, and running
 * the full grouped query — parish context and all — on each of them to print
 * one number would be paying for a screen nobody is looking at.
 */
export async function countQueuedRequests(
  tx: Tx,
  ctx: TenantContext,
): Promise<number> {
  requireManager(ctx);
  const [row] = await tx<{ waiting: number }[]>`
    select count(*)::int as waiting
      from borrow_requests r
      join books b on b.id = r.book_id and b.deleted_at is null
      join users u on u.id = r.member_id and u.deleted_at is null
     where r.status in ('pending', 'approved')
       and r.deleted_at is null
  `;
  return row?.waiting ?? 0;
}
