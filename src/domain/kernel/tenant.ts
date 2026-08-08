import type { Clock } from "./clock";

/** BR §13.1. Hierarchical within a shelf; super_admin is global. */
export const ROLE_RANK = {
  guest: 0,
  reader: 1,
  manager: 2,
  admin: 3,
  super_admin: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;

/** `admin ⊃ manager ⊃ reader` — so no caller list has to repeat inherited roles. */
export function atLeast(held: Role, required: Role): boolean {
  return ROLE_RANK[held] >= ROLE_RANK[required];
}

export interface Actor {
  /** Null for system actions — the seed, scheduled housekeeping. */
  userId: string | null;
  /** Null when the actor has no membership of this shelf (super_admin). */
  membershipId: string | null;
  role: Role;
}

/**
 * Everything a command needs to know about who is asking and where.
 *
 * Every command and every shelf-scoped query takes one of these as its first
 * parameter, with no overload that omits it. That is what makes INV-10
 * structural at the application layer as well as in the database: there is no
 * way to express an unscoped call.
 */
export interface TenantContext {
  bookshelfId: string;
  actor: Actor;
  clock: Clock;
}

export function systemContext(bookshelfId: string, clock: Clock): TenantContext {
  return {
    bookshelfId,
    actor: { userId: null, membershipId: null, role: "super_admin" },
    clock,
  };
}
