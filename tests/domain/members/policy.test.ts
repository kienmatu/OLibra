import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated, ValidationFailed } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  assertPasswordLength,
  assertPhone,
  blank,
  isValidPhone,
  MIN_PASSWORD_LENGTH,
  membershipAllowsNewLoan,
  membershipTransition,
  requireManager,
  requireReader,
  requireSelfOrManager,
} from "../../../src/domain/members/policy";

const MEMBERSHIP = "22222222-2222-2222-2222-222222222222";

const ctxWith = (
  role: TenantContext["actor"]["role"],
  membershipId: string | null = MEMBERSHIP,
): TenantContext => ({
  bookshelfId: "11111111-1111-1111-1111-111111111111",
  actor: { userId: null, membershipId, role },
  clock: fixedClock("2026-08-08T10:00:00Z"),
});

test("the transition table is BR §7.5's diagram, arrow for arrow", () => {
  // pending ──► active ⇄ suspended ──► left ; pending ──► rejected
  // Plus "any status → left" (OPS §4.3 MarkMembershipLeft: "Any status → left").
  const allowed: [string, string][] = [
    ["pending", "active"],
    ["pending", "rejected"],
    ["active", "suspended"],
    ["suspended", "active"],
    ["active", "left"],
    ["suspended", "left"],
    ["pending", "left"],
    ["rejected", "left"],
    // M6: "Any status → left" read literally includes a status that is
    // already left — a re-click is idempotent, not a fresh refusal.
    ["left", "left"],
    // Re-application (BR §2: "the person may re-apply"). The row is reused
    // because memberships_one_per_shelf ignores status — verified live.
    ["rejected", "pending"],
    ["left", "pending"],
  ];
  for (const [from, to] of allowed) {
    expect(membershipTransition(from as never, to as never).allowed).toBe(true);
  }
});

test("approving something already decided names the registration, not the request", () => {
  // OPS §4.3 ApproveMembership: "Đơn đăng ký này đã được xử lý." The code is
  // registration_not_pending, not `not_pending`, so B2b's profile-change
  // sentence ("Yêu cầu này…") can have its own.
  const t = membershipTransition("active", "active");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("registration_not_pending");
});

test("only an active membership may be suspended", () => {
  expect(membershipTransition("pending", "suspended")).toEqual({
    allowed: false,
    reason: "not_active_cannot_suspend",
  });
  expect(membershipTransition("left", "suspended")).toEqual({
    allowed: false,
    reason: "not_active_cannot_suspend",
  });
});

test("only a suspended membership may be reactivated", () => {
  expect(membershipTransition("pending", "active")).toEqual({ allowed: true });
  expect(membershipTransition("left", "active")).toEqual({
    allowed: false,
    reason: "not_suspended_cannot_reactivate",
  });
});

test("INV-4: only an active membership may start a new loan", () => {
  // BR §6 INV-4. The members half only — the loan limit (INV-5) needs a count
  // of loans and belongs to circulation. C1's memberMayBorrow calls this.
  expect(membershipAllowsNewLoan({ status: "active" })).toEqual({ blocked: false });
  for (const status of ["pending", "suspended", "left", "rejected"] as const) {
    expect(membershipAllowsNewLoan({ status })).toEqual({
      blocked: true,
      reason: "membership_not_active",
    });
  }
});

test("INV-4: a pending member cannot borrow either", () => {
  // RegisterMemberOnBehalf still creates a pending application (BR §16.1),
  // so a manager meets this state at the shelf, not only in a test.
  expect(membershipAllowsNewLoan({ status: "pending" }).blocked).toBe(true);
});

test("a password is at least eight characters, and says which password", () => {
  expect(MIN_PASSWORD_LENGTH).toBe(8);
  expect(() =>
    assertPasswordLength("12345678", "password_too_short"),
  ).not.toThrow();
  try {
    assertPasswordLength("1234567", "password_too_short");
    throw new Error("expected a throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationFailed);
    expect((e as ValidationFailed).code).toBe("password_too_short");
    expect((e as ValidationFailed).message).toBe("Mật khẩu cần ít nhất 8 ký tự.");
  }
  try {
    assertPasswordLength("short", "new_password_too_short");
    throw new Error("expected a throw");
  } catch (e) {
    expect((e as ValidationFailed).message).toBe(
      "Mật khẩu mới cần ít nhất 8 ký tự.",
    );
  }
});

test("the length is counted in code points, not UTF-8 bytes", () => {
  // "Mật khẩu" is Vietnamese-facing copy; a child may well type Vietnamese.
  // Eight accented characters is eight characters, whatever they weigh.
  expect(() =>
    assertPasswordLength("mậtkhẩu1", "password_too_short"),
  ).not.toThrow();
});

test("role gates are server-side, per BR §13.3", () => {
  expect(() => requireManager(ctxWith("manager"))).not.toThrow();
  expect(() => requireManager(ctxWith("admin"))).not.toThrow();
  expect(() => requireManager(ctxWith("super_admin"))).not.toThrow();
  expect(() => requireManager(ctxWith("reader"))).toThrow(RuleViolated);
  expect(() => requireReader(ctxWith("guest"))).toThrow(RuleViolated);
});

test("a reader may act on their own membership and no other", () => {
  // UpdateOwnProfile, CancelProfileChange and ChangeOwnPassword all need this
  // (OPS §4.3: caller "reader (self only)"). A manager passes regardless.
  expect(() => requireSelfOrManager(ctxWith("reader"), MEMBERSHIP)).not.toThrow();
  expect(() =>
    requireSelfOrManager(ctxWith("reader"), "33333333-3333-3333-3333-333333333333"),
  ).toThrow(RuleViolated);
  expect(() =>
    requireSelfOrManager(
      ctxWith("manager"),
      "33333333-3333-3333-3333-333333333333",
    ),
  ).not.toThrow();
  // A guest holds no membership at all and is never "self".
  expect(() => requireSelfOrManager(ctxWith("guest", null), MEMBERSHIP)).toThrow(
    RuleViolated,
  );
});

test("blank treats whitespace as absent", () => {
  expect(blank(undefined)).toBe(true);
  expect(blank(null)).toBe(true);
  expect(blank("   ")).toBe(true);
  expect(blank("Giuse")).toBe(false);
});

/**
 * QA remediation Task 18. Measured on 2026-08-10: `khong-phai-so` typed into
 * the required "Số điện thoại" on `/quan-ly/nguoi-doc/moi` was accepted,
 * stored, and rendered as `tel:khong-phai-so` on the approval card, the
 * reader profile and the overdue list — the field whose own hint says it is
 * how the shelf calls about an overdue book. `/gop-y` already used
 * `type="tel"` on its own phone box; the knowledge existed, it was simply
 * never applied to the member-facing forms or checked in the domain that
 * receives them.
 *
 * The shape ("9-11 digits after stripping spaces, dots and dashes, optionally
 * `+84`-prefixed") was chosen after reading, not assumed: the seeded database
 * (`src/db/seed.ts`) and the live dev database both carry every phone number
 * as 10 digits, sometimes grouped with spaces ("0912 345 678") or written
 * solid ("0999888777") — never with dots or dashes in practice, but the rule
 * strips them anyway since a person copying a number from a printed list may
 * well type one. No `+84`-prefixed number exists in either database today;
 * the allowance is for the day a family gives their number in international
 * form, which the shape already covers correctly.
 */
test("assertPhone accepts the shapes the seed and the dev database actually carry", () => {
  expect(() => assertPhone("0912 345 678", "phone")).not.toThrow();
  expect(() => assertPhone("0999888777", "phone")).not.toThrow();
  expect(() => assertPhone("+84912345678", "phone")).not.toThrow();
  // Dots and dashes are stripped like spaces are — a number copied from a
  // printed parish list may be grouped either way.
  expect(() => assertPhone("091.234.5678", "phone")).not.toThrow();
  expect(() => assertPhone("091-234-5678", "phone")).not.toThrow();
});

test("assertPhone refuses khong-phai-so, naming the field and OPS's own sentence", () => {
  try {
    assertPhone("khong-phai-so", "phone");
    throw new Error("expected a throw");
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationFailed);
    expect((e as ValidationFailed).code).toBe("phone_invalid");
    expect((e as ValidationFailed).field).toBe("phone");
    expect((e as ValidationFailed).message).toBe(
      "Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.",
    );
  }
});

test("assertPhone refuses a number with too few or too many digits", () => {
  expect(() => assertPhone("091234", "phone")).toThrow(ValidationFailed);
  expect(() => assertPhone("091234567890123", "phone")).toThrow(ValidationFailed);
  expect(() => assertPhone("", "phone")).toThrow(ValidationFailed);
});

test("isValidPhone is the query PhoneLink uses to decide whether to render tel:", () => {
  expect(isValidPhone("0912 345 678")).toBe(true);
  expect(isValidPhone("khong-phai-so")).toBe(false);
});
