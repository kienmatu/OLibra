import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";

/**
 * OPS §4.5's three grants — who may manage a shelf, and who may manage the
 * installation.
 *
 * **A person has at most one role per bookshelf** (§4 assumption 8), so
 * `AssignManager` either creates a membership or overwrites the `role` on the
 * one that exists. It never adds a second row, and the audit sentence is about
 * the person rather than about the row, which is why both actions are
 * `membership.*` rather than `manager.*`: the same person may be a manager of
 * one parish and a reader of another, and neither fact is about "being a
 * manager" in general.
 */

export interface AssignManagerInput {
  userId: string;
  bookshelfId: string;
  role: "manager" | "admin";
}

export const assignManager: Command<AssignManagerInput, void> = async (
  tx,
  ctx,
  input,
) => {
  if (input.role !== "manager" && input.role !== "admin") {
    throw new ValidationFailed("validation_failed", "role");
  }

  const [user] = await tx<{ id: string; full_name: string }[]>`
    select id, full_name from users
    where id = ${input.userId} and deleted_at is null
  `;
  if (!user) throw new NotFound("membership_not_found");

  const [shelf] = await tx<{ id: string }[]>`
    select id from bookshelves
    where id = ${input.bookshelfId} and deleted_at is null
  `;
  if (!shelf) throw new NotFound("shelf_not_found");

  const [existing] = await tx<{ id: string; role: string; status: string }[]>`
    select id, role, status from memberships
    where user_id = ${user.id} and bookshelf_id = ${shelf.id}
      and deleted_at is null
  `;

  if (existing) {
    await tx`
      update memberships
         set role = ${input.role},
             -- A person being given the keys is a member of this shelf,
             -- whatever their application said. Leaving a promoted manager
             -- pending would put them in the approval queue they are now
             -- meant to be working. (No backticks in SQL comments: inside a
             -- tagged template they end the literal.)
             status = 'active'
       where id = ${existing.id}
    `;
  } else {
    await tx`
      insert into memberships (bookshelf_id, user_id, role, status)
      values (${shelf.id}, ${user.id}, ${input.role}, 'active')
    `;
  }

  void ctx;

  return {
    result: undefined,
    audit: {
      action: "membership.role_assigned",
      entityType: "membership",
      entityId: existing?.id ?? user.id,
      before: existing ? { role: existing.role, status: existing.status } : null,
      after: { role: input.role, subject: user.full_name },
    },
  };
};

/**
 * `manager`/`admin` → `reader`, at that shelf.
 *
 * **The membership and its audit trail are retained** — OPS §4.5 quotes §16.4's
 * own wording for the confirmation step: "Revocation requires confirmation and
 * states plainly that history is retained." Nothing is deleted (G10); the
 * person keeps their loans, their comments and their place in the parish.
 */
export const revokeManager: Command<{ membershipId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  const [row] = await tx<
    { id: string; role: string; full_name: string; bookshelf_id: string }[]
  >`
    select m.id, m.role, u.full_name, m.bookshelf_id
      from memberships m
      join users u on u.id = m.user_id and u.deleted_at is null
     where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!row) throw new NotFound("membership_not_found");
  if (row.role === "reader") throw new RuleViolated("not_permitted");

  await tx`update memberships set role = 'reader' where id = ${row.id}`;

  void ctx;

  return {
    result: undefined,
    audit: {
      action: "membership.role_revoked",
      entityType: "membership",
      entityId: row.id,
      before: { role: row.role },
      after: { role: "reader", subject: row.full_name },
    },
  };
};

/**
 * OPS §4.5's `PromoteSuperAdmin` — the global grant, and the only one in the
 * catalogue that belongs to no shelf.
 *
 * §13.2 names it as a permission distinct from `AssignManager`, which is why it
 * is a command of its own rather than a fourth role in the enum: a super_admin
 * holds no membership anywhere by nature, and `users.is_super_admin` is a
 * column on the *person*.
 *
 * **There is no demotion command**, and that is OPS's shape rather than an
 * omission here: §4.5 lists none. Removing the last administrator's own grant
 * would lock the installation out of its own administration surface, and
 * nothing in the requirements says what should happen instead.
 */
export const promoteSuperAdmin: Command<{ userId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  const [user] = await tx<
    { id: string; full_name: string; is_super_admin: boolean }[]
  >`
    select id, full_name, is_super_admin from users
    where id = ${input.userId} and deleted_at is null
  `;
  if (!user) throw new NotFound("membership_not_found");
  if (user.is_super_admin) throw new RuleViolated("already_super_admin");

  await tx`update users set is_super_admin = true where id = ${user.id}`;

  void ctx;

  return {
    result: undefined,
    audit: {
      action: "user.promoted_super_admin",
      entityType: "user",
      entityId: user.id,
      before: { is_super_admin: false },
      after: { is_super_admin: true, subject: user.full_name },
      // No shelf: this is a fact about a person and about the installation.
      global: true,
    },
  };
};
