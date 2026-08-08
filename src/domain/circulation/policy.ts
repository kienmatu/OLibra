import type { Clock } from "../kernel/clock";
import type { ErrorCode } from "../kernel/errors";
import type { Block } from "../kernel/block";
// Imported, never redeclared: both unions already exist, spelled exactly as
// `copy_state` and `membership_status` spell them. A local copy is a third and
// fourth place the enums can drift away from — and drift between a
// hand-maintained list and the table beside it is the exact shape of the
// defect B2a shipped (fix-report, 2026-08-08-b2-members), where a suspended
// reader could clear their own suspension.
import type { CopyState } from "../catalogue/policy";
import { membershipAllowsNewLoan, type MembershipStatus } from "../members/policy";

/**
 * The circulation domain's pure rules. No SQL, no clock *reading*, no I/O —
 * everything here is a function of its arguments, the same way
 * `../catalogue/policy.ts` holds BR §7.1's state machine and
 * `../members/policy.ts` holds BR §7.5's.
 *
 * BR §16.3: "Blocking conditions surface as a clear message *before* the
 * confirm step, never as an error afterwards." The same predicates answer both
 * the "can I?" question on the quick-lend screen and the "may I?" question
 * inside the command at commit time. If those were two implementations they
 * would drift, and a volunteer would be told yes and then no — which is worse
 * than being told no, because the book is already in the child's hands.
 */

const OK: Block = { blocked: false };
const no = (reason: ErrorCode): Block => ({ blocked: true, reason });

/**
 * INV-3 and INV-7, as one predicate.
 *
 * **`heldForUserId` and `forUserId` are `users.id`, not `memberships.id`, and
 * the names are load-bearing.** A hold's holder is `borrow_requests.member_id`
 * (`0005_circulation.sql:63`) — a column whose name says membership and whose
 * `references users(id)` says otherwise, left that way deliberately by
 * `20260808_04_composite_tenant_fks.sql:42` because `users` is a global table
 * with no shelf-scoped column to pair an id with. Comparing a membership id
 * against it is never equal, so a caller that passed one would turn INV-3's
 * most interesting case — *a held copy is lendable to its holder* — into *a
 * held copy is never lendable*, with every unit test here still green because
 * the predicate itself would be doing exactly what it was told. Naming the
 * parameters after the id they actually carry is what makes that mistake
 * unwriteable without noticing.
 *
 * **This is not a second `copyStateTransition`.** `../catalogue/policy.ts:88`
 * already refuses `lost|retired → on_loan` and permits `available|held →
 * on_loan`, and INV-7's shipped test leans on it. What a transition table
 * structurally cannot answer is *whose* hold a `held` copy is under — the one
 * question that distinguishes `LendCopy` from `HandoverRequest`, and the
 * reason this predicate exists alongside that one rather than instead of it.
 *
 * **The hold branch is guarded on `state === "held"`, and that guard is what
 * keeps a lost copy reading as lost.** A copy can carry a stale approved hold
 * and then be reported lost — nothing deletes the `borrow_requests` row (OPS
 * §2 lists it among the tables never hard-deleted) — so `heldForUserId` can be
 * non-null on a copy whose state is `lost`. The volunteer must hear "đã mất
 * hoặc ngừng dùng", which names something they can act on, rather than "đang
 * được mượn hoặc đang giữ chỗ", which sends them to look for a book that is
 * not on the shelf. Dropping `copy.state === "held" &&` reads as a safe
 * simplification — surely only a held copy has a holder — and is not.
 *
 * The *statement order* of the two blocks, by contrast, carries no weight:
 * `state` holds one value, so the branches cannot both match. Measured, by
 * swapping them and watching every test stay green. It is written
 * lost-first because that is the order a reader wants to meet the rules in,
 * not because moving it would change an answer.
 */
export function copyLendable(
  copy: { state: CopyState; heldForUserId: string | null },
  forUserId: string,
): Block {
  if (copy.state === "lost" || copy.state === "retired") {
    return no("copy_lost_or_retired");
  }
  if (copy.state === "available") return OK;
  if (copy.state === "held" && copy.heldForUserId === forUserId) {
    // The hold is this reader's — collecting it is exactly the permitted
    // held → on_loan transition (BR §7.1). Both sides are `users.id`: see the
    // paragraph on naming, above.
    return OK;
  }
  // Reached by `on_loan`, and by `held` under somebody else's hold or under no
  // live hold at all. A `held` copy whose hold has lapsed arrives here with
  // `heldForUserId === null`, because the caller reads that column through a
  // `hold_expires_at > olibra_now()` filter — so expiry presents as absence,
  // and absence must not match a reader. It refuses rather than falling
  // through to OK: the copy has to be returned to `available` first, which is
  // a transition somebody records, not one a lend performs on the way past.
  return no("copy_not_available");
}

/**
 * INV-4 and INV-5, composed — INV-4 borrowed, INV-5 this function's own.
 *
 * The status half is `membershipAllowsNewLoan` (`../members/policy`), called
 * rather than restated. That function's own docstring asks for exactly this,
 * and B2a's fix report is why: a hand-maintained status list drifted from the
 * transition graph sitting a few lines above it, and a suspended reader could
 * clear their own suspension. INV-4's list of statuses appears once in this
 * codebase, in the domain that owns memberships.
 *
 * INV-4 is checked first, deliberately. A suspended reader who is also at the
 * limit hears "Tài khoản đang tạm khoá, không thể mượn thêm." — something a
 * volunteer can act on — rather than being sent to collect books that would
 * not unblock anything.
 *
 * INV-4 is also deliberately narrow: a non-active membership blocks a *new*
 * loan and leaves existing ones alone. A reader suspended while holding a book
 * keeps the book (BR §3, and `inv-04-suspended-cannot-borrow.test.ts`'s second
 * test).
 *
 * `maxConcurrentLoans` is passed in rather than read from anywhere, because it
 * is per-shelf configuration (BR §5.5, default 3) and this file has no way to
 * reach a shelf row. The caller resolves it; `search-readers-for-lending.ts`
 * already takes it the same way.
 */
export function memberMayBorrow(
  member: { status: MembershipStatus; activeLoans: number },
  maxConcurrentLoans: number,
): Block {
  const standing = membershipAllowsNewLoan({ status: member.status });
  if (standing.blocked) return standing;
  if (member.activeLoans >= maxConcurrentLoans) return no("loan_limit_reached");
  return OK;
}

/**
 * The due date, as a date.
 *
 * BR §5.4: a book is due at the end of a day, not at 14:23 on it — `due_on` is
 * a `date` column, and every comparison against it (`loans_current`'s
 * `is_overdue` and `days_remaining`) is made in `Asia/Ho_Chi_Minh`. So the
 * count starts from the clock's *local* `today()`, not from its instant: a
 * book lent at 23:30Z on the 7th is lent at half past six on the morning of
 * the 8th in Ho Chi Minh City, and is due fourteen days after the 8th. Taking
 * the UTC date instead would make every evening's loans a day short.
 *
 * The arithmetic goes through `Date.UTC`, which normalises an out-of-range
 * day — `Date.UTC(2026, 7, 39)` is the 8th of September — so month, year and
 * leap-day boundaries need no special case. `UTC` rather than the local
 * constructor because the host's timezone is not `Asia/Ho_Chi_Minh` and must
 * not participate: the timezone conversion has already happened, in
 * `clock.today()`, and doing it twice is how a date shifts by one.
 */
export function dueDateFor(clock: Clock, loanDays: number): string {
  const [y, m, d] = clock.today().split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + loanDays));
  return due.toISOString().slice(0, 10);
}
