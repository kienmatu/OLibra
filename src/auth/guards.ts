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
// M12: `status = 'active'` here means an archived shelf resolves to
// `shelf_not_found` for everyone who reaches it by slug — including its own
// admin, who has no other way in yet, since archiving happens *to* the URL a
// membership is scoped by. That is a decision, not an oversight: archiving a
// shelf is meant to take it out of circulation entirely (readers, managers
// and the portal alike), and a bespoke "but let the admin in anyway" carve-out
// here would quietly split what "archived" means depending on who is asking.
// If a genuine "manage an archived shelf" need shows up later (reactivating
// it, exporting its records), it should get its own explicit admin path —
// `olibra_admin`, the same escalation `seed()` and `landingShelfFor` use, not
// a second reading of this policy.

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
        -- CRITICAL 1: this filtered m.deleted_at but never u.deleted_at, so a
        -- soft-deleted user kept full access through this path even once
        -- resolveSession (session.ts) also stopped returning them a session
        -- — belt and braces, since this function has its own userId input
        -- and must not depend solely on its caller having checked already.
        and u.deleted_at is null
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

/**
 * Where a freshly-signed-in person should land (IMPORTANT 6).
 *
 * A member of exactly one active shelf goes straight there — no reason to
 * make them pick what isn't a choice. A member of several shelves, or of
 * none (including a super_admin, who by nature oversees many, and a person
 * signed in but not yet approved anywhere), lands on the public portal to
 * choose or wait — never on some other shelf's page, which is what
 * hard-coding a single fixture shelf here used to do.
 *
 * Cross-shelf by nature: "every shelf I belong to" cannot be answered from
 * inside any one shelf's RLS scope, the same reason `resolveShelfId` above
 * needs its own public-read policy rather than the ordinary tenant one. This
 * runs as `olibra_admin` for that reason, deliberately and visibly — but
 * scoped to the caller's own `userId` and nothing else: a person listing
 * their own memberships is not the cross-tenant browse INV-10 exists to
 * stop, the same distinction `seed()` (`src/db/seed.ts`) draws for writing
 * across shelves in one pass.
 */
export async function landingShelfFor(
  sql: Sql,
  userId: string,
): Promise<string | null> {
  const rows = await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;
    return tx<{ slug: string }[]>`
      select b.slug
      from memberships m
      join bookshelves b on b.id = m.bookshelf_id
      where m.user_id = ${userId}
        and m.status = 'active'
        and m.deleted_at is null
        and b.status = 'active'
        and b.deleted_at is null
    `;
  });
  return rows.length === 1 ? rows[0].slug : null;
}

/** BR §13.3: the interface hiding an action is never the security control. */
export function requireRole(ctx: TenantContext, required: Role): void {
  if (!atLeast(ctx.actor.role, required)) {
    throw new RuleViolated("not_permitted");
  }
}
