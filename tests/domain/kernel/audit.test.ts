import { expect, test } from "vitest";
import { assertNoSecrets } from "../../../src/domain/kernel/audit";
import { RuleViolated } from "../../../src/domain/kernel/errors";

/**
 * IMPORTANT 2 + MINOR 4 (fix-report, 2026-08-07-s2-domain-kernel).
 *
 * BR §2: "The audit records the act, never the secret." These are pure unit
 * tests of `assertNoSecrets` itself — the DB-backed end-to-end case lives in
 * `tests/invariants/inv-08-every-transition-audited.test.ts`.
 */

test("a top-level secret is still caught", () => {
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      after: { password_hash: "$2b$whatever" },
    }),
  ).toThrow(RuleViolated);
});

test("a secret nested one level deep is caught", () => {
  // The natural shape for a diff — `after: { credentials: { password_hash } }`
  // — reached the audit log before the guard walked past the top level.
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      after: { credentials: { password_hash: "$2b$whatever" } },
    }),
  ).toThrow(RuleViolated);
});

test("a secret nested inside an array of objects is caught", () => {
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      after: { changes: [{ password_hash: "xyz" }] },
    }),
  ).toThrow(RuleViolated);
});

test.each([
  { hash: "$2b$12$whatever" },
  { pwd: "abc" },
  { token: "abc" },
  { session: "abc" },
  { secret: "abc" },
  { mat_khau: "abc" },
  { api_key: "abc" },
  { salt: "abc" },
  { otp: "123456" },
])("a bare %o is caught", (after) => {
  expect(() =>
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after,
    }),
  ).toThrow(RuleViolated);
});

test.each(["password_changed_at", "has_password", "session_count", "tokens_read"])(
  "%s is a legitimate field, not a secret",
  (field) => {
    expect(() =>
      assertNoSecrets({
        action: "book.created",
        entityType: "x",
        entityId: "x",
        after: { [field]: "whatever" },
      }),
    ).not.toThrow();
  },
);

test("the failure is a named DomainError, not a bare exception", () => {
  // OPS §2: a command never fails with a bare 500 or an unstructured
  // exception — every failure mode is a stable code with a Vietnamese
  // sentence.
  try {
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after: { password: "abc" },
    });
    throw new Error("expected assertNoSecrets to throw");
  } catch (e) {
    expect(e).toBeInstanceOf(RuleViolated);
    expect((e as RuleViolated).code).toBe("audit_forbidden_field");
    expect((e as RuleViolated).message).not.toMatch(/^Error/);
  }
});

test("before is walked too, not only after", () => {
  expect(() =>
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      before: { password: "abc" },
    }),
  ).toThrow(RuleViolated);
});

test("an entry with no secrets anywhere passes", () => {
  expect(() =>
    assertNoSecrets({
      action: "credentials.set",
      entityType: "user",
      entityId: "x",
      before: null,
      after: null,
    }),
  ).not.toThrow();
});

// New with the recursive walk (IMPORTANT 2): a cyclic or pathologically deep
// payload used to recurse without bound and crash with a bare `RangeError:
// Maximum call stack size exceeded` — the same unstructured-exception class
// this guard was already fixed for once. A depth cap turns both the cyclic
// case and the merely-very-deep case into the same named RuleViolated.
test("a cyclic payload is a named RuleViolated, not a bare RangeError", () => {
  const cyclic: Record<string, unknown> = { child: {} as Record<string, unknown> };
  (cyclic.child as Record<string, unknown>).parent = cyclic;

  expect(() =>
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after: cyclic,
    }),
  ).toThrow(RuleViolated);

  try {
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after: cyclic,
    });
  } catch (e) {
    expect((e as RuleViolated).code).toBe("audit_nesting_too_deep");
  }
});

test("a pathologically deep (but non-cyclic) payload is also a named RuleViolated", () => {
  let deep: Record<string, unknown> = { value: "leaf" };
  for (let i = 0; i < 50; i++) {
    deep = { child: deep };
  }

  expect(() =>
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after: deep,
    }),
  ).toThrow(RuleViolated);
});

test("ordinary nesting well under the depth cap still passes", () => {
  expect(() =>
    assertNoSecrets({
      action: "book.created",
      entityType: "x",
      entityId: "x",
      after: { a: { b: { c: { d: "fine" } } } },
    }),
  ).not.toThrow();
});
