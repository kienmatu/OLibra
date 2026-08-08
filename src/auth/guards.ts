import type { Sql } from "postgres";
import type { Clock } from "../domain/kernel/clock";
import { NotFound, RuleViolated } from "../domain/kernel/errors";
import { atLeast, type Role, type TenantContext } from "../domain/kernel/tenant";
import { resolveSession } from "./session";

/**
 * Resolves a bookshelf slug to an id, as `olibra_app`.
 *
 * This is the read `bookshelves_public_read` (Step 1's migration) exists
 * for: the id is not known yet, so `bookshelves_tenant`'s ordinary
 * `id = <the GUC>` policy cannot be satisfied — and must not need to be. A
 * stranger with no session at all still needs this to work (OPS §2: "only
 * the landing page, the portal directory, and the sign-in and registration
 * forms are public").
 */
async function resolveShelfId(sql: Sql, slug: string): Promise<string | null> {
  const [shelf] = await sql.begin(async (tx) => {
    await tx`set local role olibra_app`;
    return tx<{ id: string }[]>`
      select id from bookshelves
      where slug = ${slug} and status = 'active' and deleted_at is null
    `;
  });
  return shelf?.id ?? null;
}

/**
 * Looks up (if any) the caller's membership of `bookshelfId`, as `olibra_app`
 * scoped to that shelf — the same scoping `runQuery` gives an ordinary
 * command (`unit-of-work.ts`). Setting the GUC before the query, not only
 * switching role, is load-bearing: `memberships_tenant`'s policy is
 * `bookshelf_id = <the GUC>`, so without it every row on every shelf is
 * invisible regardless of who is asking — verified live, the failure this
 * reconciliation found in the original listing.
 */
async function membershipFor(
  sql: Sql,
  bookshelfId: string,
  userId: string,
): Promise<{ id: string | null; role: Role; isSuperAdmin: boolean } | null> {
  const [row] = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${bookshelfId}, true)`;
    await tx`set local role olibra_app`;
    return tx<{ id: string; role: Role; is_super_admin: boolean }[]>`
      select m.id, m.role, u.is_super_admin
      from users u
      left join memberships m
        on m.user_id = u.id
       and m.bookshelf_id = ${bookshelfId}
       -- Status, not merely role. A suspended member is not a reader of
       -- this shelf, though their existing loans survive (INV-4).
       and m.status = 'active'
       and m.deleted_at is null
      where u.id = ${userId}
    `;
  });
  if (!row) return null;
  return { id: row.id ?? null, role: row.role, isSuperAdmin: row.is_super_admin };
}

/**
 * Builds the context a domain call needs, from a cookie and a URL segment.
 *
 * OPS §2 is the rule being enforced here: "a valid `reader` session for shelf
 * A grants nothing on shelf B." Authentication answers *who*; the membership
 * lookup answers *what, here*. Skipping the second would let anyone signed in
 * anywhere browse every parish's catalogue, which BR §1.2 explicitly closed.
 */
export async function contextFor(
  sql: Sql,
  input: { token: string | null; bookshelfSlug: string; clock: Clock },
): Promise<TenantContext> {
  const bookshelfId = await resolveShelfId(sql, input.bookshelfSlug);
  if (!bookshelfId) throw new NotFound("shelf_not_found");

  const guest: TenantContext = {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "guest" },
    clock: input.clock,
  };

  if (!input.token) return guest;

  const session = await resolveSession(sql, input.token, input.clock);
  if (!session) return guest;

  const membership = await membershipFor(sql, bookshelfId, session.userId);

  if (membership?.isSuperAdmin) {
    return {
      bookshelfId,
      actor: {
        userId: session.userId,
        membershipId: membership.id,
        role: "super_admin",
      },
      clock: input.clock,
    };
  }

  if (!membership?.id) {
    // Signed in, but not a member here. Guest, deliberately — not an error,
    // because the portal exists so a stranger can find their parish.
    return { ...guest, actor: { ...guest.actor, userId: session.userId } };
  }

  return {
    bookshelfId,
    actor: {
      userId: session.userId,
      membershipId: membership.id,
      role: membership.role,
    },
    clock: input.clock,
  };
}

/** BR §13.3: the interface hiding an action is never the security control. */
export function requireRole(ctx: TenantContext, required: Role): void {
  if (!atLeast(ctx.actor.role, required)) {
    throw new RuleViolated("not_permitted");
  }
}
