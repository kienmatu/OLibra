import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  ROLE_RANK,
  atLeast,
  requireIdentifiedActor,
  systemContext,
} from "../../../src/domain/kernel/tenant";

test("roles are hierarchical within a shelf", () => {
  // BR §13.1: admin ⊃ manager ⊃ reader. OPS §2 relies on this so the
  // operations catalogue never has to repeat an inherited role.
  expect(atLeast("admin", "manager")).toBe(true);
  expect(atLeast("manager", "reader")).toBe(true);
  expect(atLeast("reader", "manager")).toBe(false);
  expect(atLeast("guest", "reader")).toBe(false);
});

test("super_admin outranks everything", () => {
  expect(atLeast("super_admin", "admin")).toBe(true);
});

test("the rank order has no gaps or duplicates", () => {
  const ranks = Object.values(ROLE_RANK);
  expect(new Set(ranks).size).toBe(ranks.length);
});

test("a system context carries no actor", () => {
  // Used by the seed and by scheduled housekeeping. BR §5.4 allows an audit
  // record with no actor precisely for these.
  const ctx = systemContext("shelf-1", fixedClock("2026-08-07T00:00:00Z"));
  expect(ctx.actor.userId).toBeNull();
  expect(ctx.bookshelfId).toBe("shelf-1");
});

test("rank alone does not make an actor, and requireIdentifiedActor says so", () => {
  // The trap this function exists for, in one place: `systemContext` yields
  // the *highest* role in `ROLE_RANK`, so every `requireManager`/`requireAdmin`
  // check in the codebase passes it — with nobody behind it. A command that
  // writes an actor column (`loans.lent_by`, `loans.voided_by`,
  // `condition_assessments.assessed_by`) or leans on INV-8's "the audit record
  // names the actor" needs the second question asked, and asking it by role is
  // structurally impossible.
  const clock = fixedClock("2026-08-07T00:00:00Z");
  const system = systemContext("shelf-1", clock);
  expect(atLeast(system.actor.role, "manager")).toBe(true);
  expect(() => requireIdentifiedActor(system)).toThrow(
    expect.objectContaining({ code: "not_permitted" }),
  );

  expect(() =>
    requireIdentifiedActor({
      bookshelfId: "shelf-1",
      actor: { userId: "user-1", membershipId: "m-1", role: "manager" },
      clock,
    }),
  ).not.toThrow();
});
