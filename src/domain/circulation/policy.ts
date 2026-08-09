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
 * BR §16.3: "Blocking conditions (reader at loan limit, copy already lent,
 * membership not active) surface as a clear message *before* the confirm step,
 * never as an error afterwards." The same predicates answer both
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
 * **The hold branch is guarded on `state === "held"`, and the state it is
 * about is `on_loan`.** An earlier version of this paragraph said the guard was
 * what keeps a lost copy reading as lost. It is not, and the next paragraph
 * said so against it: the `lost || retired` branch returns three lines above,
 * so a lost copy with a stale hold never reaches this line at all. Measured —
 * dropping `copy.state === "held" &&` leaves every lost/retired test green.
 *
 * What it actually decides is the one remaining case: a copy that is `on_loan`
 * while a live approved hold names the reader now asking for it. Without the
 * guard this predicate answers *yes* to that, and the copy in a child's hands
 * gets promised to somebody else. The command would still refuse — INV-1's
 * partial unique index rejects the second active loan and `lendCopy`
 * translates the `23505` to the same `copy_not_available` — but that is a
 * constraint violation caught after the write was attempted, where BR §16.3
 * asks for an answer a *screen* can give before the confirm step, and a screen
 * cannot consult an index. A pure predicate that is wrong and rescued by a
 * constraint is still wrong.
 *
 * That state is representable across two tables even though no single column
 * admits it (DB §4.4 and §7 on what `book_copies.state` alone guarantees), and
 * it was reachable through C1's own commands until `lendCopy` started closing
 * a collected hold in the transaction that collects it. It is C2's request
 * commands that could make it reachable again; the guard is what makes the
 * answer right either way, and `tests/domain/circulation/policy.test.ts` pins
 * it directly rather than through a case that returns earlier.
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
 * Whether a copy may be put aside for a queued reader — `ApproveBorrowRequest`'s
 * question, and INV-3 and INV-7 again from the other end.
 *
 * **Not `copyLendable` with a different caller.** That predicate answers "may
 * *this reader* take this copy away", and its whole reason for existing is the
 * `held`-for-me case (see its docstring). This one answers "may this copy be
 * promised to somebody who is not standing here", and the `held` case is the
 * opposite answer: a copy already under a live hold is already promised, to a
 * child who may be on their way to collect it, and promising it twice is how one
 * of them is sent home. So there is no `forUserId` parameter — there is nobody
 * to compare against, which is the difference, stated as a signature rather than
 * as a comment.
 *
 * **`heldForUserId` is read through a `hold_expires_at > olibra_now()` filter**,
 * exactly as `copyLendable`'s caller reads it, so a hold that has lapsed arrives
 * here as `null`. That is what makes BR §8's "if the tidy-up never runs,
 * `copies_borrowable` is still right" true of this command too: a copy left
 * `held` by an uncollected hold is refused by the *state* branch below and not
 * by the hold branch, and it takes somebody recording `held → available` to free
 * it — a transition a command performs, not one an approval performs on the way
 * past. The same line `copyLendable` draws, for the same reason.
 *
 * The two refusals are OPS §4.2's own, under `ApproveBorrowRequest` (`:304`,
 * `:305`) — and `chosen_copy_lost_or_retired` is a distinct code from
 * `copy_lost_or_retired` because OPS gives the two commands different sentences
 * (`errors.ts` carries the argument).
 */
export function copyHoldable(copy: {
  state: CopyState;
  heldForUserId: string | null;
}): Block {
  if (copy.state === "lost" || copy.state === "retired") {
    return no("chosen_copy_lost_or_retired");
  }
  // `available` and free of a live hold, in one condition rather than two
  // branches, because it is one question: `copies_borrowable`
  // (`20260808_14_olibra_now.sql:114-126`) is these same two clauses, and this
  // is the predicate form of that view for a caller that has already resolved a
  // single copy. Both are needed — the state alone would admit a copy sitting
  // `available` under a hold written by some other path, and the hold alone
  // would admit one that is `on_loan`.
  if (copy.state === "available" && copy.heldForUserId === null) return OK;
  return no("no_copy_available");
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
 * Whether this reader may join a queue — INV-4 for `CreateBorrowRequest`.
 *
 * **The status list is `membershipAllowsNewLoan`'s, and only the sentence
 * differs.** `memberMayBorrow` above states at length why INV-4's list of
 * statuses appears exactly once in this codebase, in the domain that owns
 * memberships; that argument does not weaken because the refusal is worded
 * differently. So this calls that function and swaps one code for another,
 * rather than asking `status === "active"` for a second time.
 *
 * The swap is conditional rather than blanket. `membershipAllowsNewLoan`
 * returns exactly one reason today, and a version of this that threw
 * `membership_not_active_cannot_request` at *any* refusal would silently
 * relabel a second reason as the first the day one is added — which is the
 * shape of the drift the single-list rule exists to prevent, reintroduced one
 * level up.
 *
 * **Why the sentence differs at all.** OPS §4.2 gives `membership_not_active`
 * "không thể mượn thêm" under `LendCopy` (`:233`) and `HandoverRequest`
 * (`:245`), and "không thể gửi yêu cầu mượn" under `CreateBorrowRequest`
 * (`:293`). Both are true statements about a suspended reader and they are not
 * the same statement: the first is about a book going into a child's hands now,
 * and a child told they cannot borrow *more* would reasonably conclude the
 * queue is still open to them. One code maps to one sentence, so the second
 * gets its own (`errors.ts`).
 *
 * INV-5 is deliberately not consulted. A reader at the loan limit may still
 * queue: nothing goes out on a request, the limit is checked again by
 * `HandoverRequest` at the moment a book actually changes hands, and a child
 * who has three books today will not have three when their turn comes. OPS
 * §4.2 lists `loan_limit_reached` under `HandoverRequest` (`:247`) and not
 * under `CreateBorrowRequest`, which is the same reading.
 */
export function memberMayRequest(member: { status: MembershipStatus }): Block {
  const standing = membershipAllowsNewLoan(member);
  if (!standing.blocked) return OK;
  return standing.reason === "membership_not_active"
    ? no("membership_not_active_cannot_request")
    : standing;
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

/**
 * When a hold placed *now* lapses — `hold_days` after the instant the clock
 * gave, in milliseconds.
 *
 * **Not `now() + interval '3 days'` in SQL, and not `olibra_now() + …`
 * either.** The interval is fixed-length wall time, so no timezone or DST
 * reasoning applies — unlike `dueDateFor` above, which produces a *date* and
 * must count in `Asia/Ho_Chi_Minh`. What matters is only which clock the
 * arithmetic starts from: `now()` would start from the database host's, while
 * every later read of `hold_expires_at` compares it against `olibra_now()`,
 * which is `ctx.clock`'s (`20260808_14_olibra_now.sql:124`, and the lateral join
 * in `./commands/lend-copy.ts`). A `fixedClock` set in 2026 would otherwise find
 * every hold it wrote already expired, or never expiring, depending on which
 * direction the two clocks differ — and the acceptance criterion this slice is
 * built around ("a hold silently stops being handable-over when the clock
 * advances, with no job running") would be untestable rather than false.
 *
 * **Moved here from `./commands/receive-return.ts`, where it was private**
 * (C2). `ApproveBorrowRequest` writes the same column from the same rule, and
 * this is a function of its arguments with no I/O in it — which is what this
 * file is for.
 */
export function holdExpiryFrom(now: Date, holdDays: number): Date {
  return new Date(now.getTime() + holdDays * 24 * 60 * 60 * 1000);
}
