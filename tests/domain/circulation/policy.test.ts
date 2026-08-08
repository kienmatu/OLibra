import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { membershipAllowsNewLoan } from "../../../src/domain/members/policy";
import {
  copyLendable,
  dueDateFor,
  memberMayBorrow,
} from "../../../src/domain/circulation/policy";

const HELD_BY_NOBODY = null;

test("INV-3: an available copy is lendable to anyone", () => {
  expect(
    copyLendable({ state: "available", heldForUserId: HELD_BY_NOBODY }, "u1"),
  ).toEqual({ blocked: false });
});

test("INV-3: a held copy is lendable only to its holder", () => {
  // The case that distinguishes LendCopy from HandoverRequest. Reader A holds
  // the hold; handing the book to reader B must fail even though B is a
  // perfectly good member. Ids here are *user* ids — borrow_requests.member_id
  // references users(id) (0005_circulation.sql:63).
  const held = { state: "held" as const, heldForUserId: "u1" };
  expect(copyLendable(held, "u1")).toEqual({ blocked: false });
  expect(copyLendable(held, "u2")).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

test("INV-3: a held copy with an expired hold is nobody's to collect", () => {
  // `heldForUserId` is null when no *live* hold exists — the caller reads it
  // through a `hold_expires_at > olibra_now()` filter, so an expired hold
  // arrives here as absence rather than as a holder. A predicate that treated
  // null as "matches nobody in particular" and fell through to OK would let
  // any reader collect a copy whose hold has lapsed without the copy ever
  // returning to `available` first, which is a state transition
  // `copyStateTransition` never authorised. Null is refused, and the refusal
  // is `copy_not_available` — the shelf must put the copy back first.
  expect(
    copyLendable({ state: "held", heldForUserId: HELD_BY_NOBODY }, "u1"),
  ).toEqual({ blocked: true, reason: "copy_not_available" });
});

test("INV-3: a copy already on loan is not lendable", () => {
  expect(
    copyLendable({ state: "on_loan", heldForUserId: HELD_BY_NOBODY }, "u1"),
  ).toEqual({ blocked: true, reason: "copy_not_available" });
});

test("INV-7: a lost or retired copy is never lendable", () => {
  for (const state of ["lost", "retired"] as const) {
    expect(copyLendable({ state, heldForUserId: HELD_BY_NOBODY }, "u1")).toEqual({
      blocked: true,
      reason: "copy_lost_or_retired",
    });
  }
});

test("INV-7 over INV-3: a lost copy someone holds still reads as lost", () => {
  // A copy can carry a stale approved hold and then be reported lost — the
  // hold row is not deleted by ReportCopyLost (OPS §2 lists the tables that
  // are never hard-deleted). The volunteer must hear "đã mất hoặc ngừng dùng",
  // which names something they can act on, rather than "đang được mượn hoặc
  // đang giữ chỗ", which sends them to find a book that is not on the shelf.
  //
  // What this catches is the `lost || retired` branch being moved *below* the
  // hold branch, or losing its own hold-insensitivity. It does **not** catch
  // the loss of `copy.state === "held" &&` on the hold branch, which an earlier
  // version of this comment claimed: the branch above returns first, so this
  // case never reaches the guard. Measured, by making exactly that edit and
  // watching this stay green — the test below is the one that catches it. Nor
  // does it catch the two blocks being swapped: `state` holds one value, so
  // their order changes no answer.
  expect(copyLendable({ state: "lost", heldForUserId: "u1" }, "u1")).toEqual({
    blocked: true,
    reason: "copy_lost_or_retired",
  });
});

test("INV-3: a copy out with someone is not lendable to whoever holds it", () => {
  // The `state === "held"` guard's real effect, and the only case that reaches
  // it: `on_loan`, with a live approved hold naming the very reader asking.
  // Drop `copy.state === "held" &&` and this predicate answers *yes* — the copy
  // in one child's hands is promised to another.
  //
  // `lendCopy` would still refuse, because INV-1's partial unique index rejects
  // the second active loan and the `23505` becomes this same code. That is why
  // no end-to-end test can catch this and why it is asserted here: the command
  // being rescued by a constraint is not the predicate being right, and BR
  // §16.3 wants an answer a screen can give *before* the confirm step, from
  // this function, with no transaction open.
  expect(copyLendable({ state: "on_loan", heldForUserId: "u1" }, "u1")).toEqual({
    blocked: true,
    reason: "copy_not_available",
  });
});

test("INV-4: memberMayBorrow refuses whatever membershipAllowsNewLoan refuses", () => {
  // Not a second statement of INV-4's status list — that list lives in
  // members/policy.ts and inv-04-suspended-cannot-borrow.test.ts already pins
  // every status against it. What this pins is the *composition*: that
  // memberMayBorrow's status answer is byte-for-byte the delegate's, for every
  // status, so the two can never disagree about a reader at the shelf.
  for (const status of [
    "pending",
    "active",
    "suspended",
    "left",
    "rejected",
  ] as const) {
    expect(memberMayBorrow({ status, activeLoans: 0 }, 3)).toEqual(
      membershipAllowsNewLoan({ status }),
    );
  }
});

test("INV-4 before INV-5: a suspended reader at the limit hears about the suspension", () => {
  // Both rules refuse; only one sentence is shown. "Tài khoản đang tạm khoá"
  // names something the volunteer can act on today; "đã mượn tối đa" would send
  // them to collect books that would not unblock anything.
  expect(memberMayBorrow({ status: "suspended", activeLoans: 5 }, 3)).toEqual({
    blocked: true,
    reason: "membership_not_active",
  });
});

test("INV-5: a member at the loan limit is blocked", () => {
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 3)).toEqual({
    blocked: true,
    reason: "loan_limit_reached",
  });
  expect(memberMayBorrow({ status: "active", activeLoans: 2 }, 3)).toEqual({
    blocked: false,
  });
});

test("INV-5: the limit is the shelf's, not a constant", () => {
  // BR §5.5 — max_concurrent_loans is per-shelf configuration.
  expect(memberMayBorrow({ status: "active", activeLoans: 3 }, 5)).toEqual({
    blocked: false,
  });
});

test("the due date is loan_days from today, in the local timezone", () => {
  // G6. 23:30Z on the 7th is already the 8th in Ho Chi Minh City, so a book
  // lent then is due on the 22nd, not the 21st.
  expect(dueDateFor(fixedClock("2026-08-07T23:30:00Z"), 14)).toBe("2026-08-22");
  expect(dueDateFor(fixedClock("2026-08-07T10:00:00Z"), 14)).toBe("2026-08-21");
});

test("the due date crosses a month and a year boundary correctly", () => {
  // `Date.UTC(y, m - 1, d + loanDays)` relies on the constructor normalising
  // an out-of-range day, which it does. Written down because the obvious
  // "simplification" — string arithmetic on the `YYYY-MM-DD` parts — silently
  // produces `2026-08-35`, and nothing else in the suite would catch it.
  expect(dueDateFor(fixedClock("2026-08-25T03:00:00Z"), 14)).toBe("2026-09-08");
  expect(dueDateFor(fixedClock("2026-12-28T03:00:00Z"), 14)).toBe("2027-01-11");
  // 2028 is a leap year, so the 29th of February exists to be landed on.
  expect(dueDateFor(fixedClock("2028-02-15T03:00:00Z"), 14)).toBe("2028-02-29");
});
