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
])("a bare %o is caught", (after) => {
  expect(() =>
    assertNoSecrets({
      action: "x.y",
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
        action: "x.y",
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
      action: "x.y",
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
      action: "x.y",
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
