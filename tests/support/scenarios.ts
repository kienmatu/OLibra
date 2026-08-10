import type { Sql } from "postgres";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { makeBookWithCopies, makeMember, makeShelf, makeUser } from "./factories";

/**
 * Multi-row starting positions, built out of `./factories.ts`'s single-row
 * builders and the real commands.
 *
 * A factory writes one row and defaults the rest; a scenario here is a *state
 * the product can actually be in*, reached the way the product reaches it. That
 * distinction is why `lentOut` below calls `lendCopy` rather than inserting a
 * `loans` row directly: a test about returning a book should be describing a
 * book that was really lent, so that a change breaking the lend cannot leave
 * the return's tests passing against a fixture nothing produces any more.
 *
 * Where a test needs the *opposite* — a loan in a state no command has shipped
 * yet, or one deliberately malformed — it should still write its own SQL, as
 * `inv-05-loan-limit.test.ts`'s `lendDirectly` does for returned and voided
 * loans. This file is for shared, honest starting positions, not for every
 * fixture.
 */

/** The instant every scenario here is built at, unless the caller says otherwise. */
export const SCENARIO_CLOCK = "2026-08-07T10:00:00Z";

export function managerContextFor(
  bookshelfId: string,
  manager: { id: string; userId: string },
  instant: string = SCENARIO_CLOCK,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock(instant),
  };
}

/** A shelf, a manager, and a `TenantContext` on a fixed clock. */
export async function managerContext(
  sql: Sql,
  over: { slug?: string; instant?: string } = {},
) {
  const shelf = await makeShelf(sql, over.slug ? { slug: over.slug } : {});
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return {
    shelf,
    manager,
    ctx: managerContextFor(shelf.id, manager, over.instant),
  };
}

/**
 * A super_admin and the context the administration surface runs under.
 *
 * `bookshelfId` is the empty string and `membershipId` is null, which is what
 * `adminContextFor` (`src/auth/guards.ts`) builds and what `Actor.membershipId`
 * is documented as meaning: this person oversees every shelf and belongs to
 * none. A test that gives them a shelf id here is testing a context the
 * application never produces.
 *
 * The `is_super_admin` flag is set on the user row rather than only in the
 * context, so a test that goes through `adminContextFor` and one that builds
 * the context directly are talking about the same person.
 */
export async function superAdminContext(
  sql: Sql,
  instant: string = SCENARIO_CLOCK,
) {
  const user = await makeUser(sql, { fullName: "Quản trị viên hệ thống" });
  await sql`update users set is_super_admin = true where id = ${user.id}`;
  const ctx: TenantContext = {
    bookshelfId: "",
    actor: { userId: user.id, membershipId: null, role: "super_admin" },
    clock: fixedClock(instant),
  };
  return { user, ctx };
}

/**
 * A shelf, a manager, a reader, one copy, and that copy already lent out —
 * through `lendCopy` itself, so the loan, the copy's `on_loan` state and the
 * `loan.created` audit row are all exactly what the product would have written.
 */
export async function lentOut(
  sql: Sql,
  over: { slug?: string; instant?: string } = {},
) {
  const { shelf, manager, ctx } = await managerContext(sql, over);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const { loanId, dueOn } = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  });
  return { shelf, manager, ctx, bookId, copyId: copyIds[0], reader, loanId, dueOn };
}
