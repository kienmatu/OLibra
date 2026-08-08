import { expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  ROLE_RANK,
  atLeast,
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
