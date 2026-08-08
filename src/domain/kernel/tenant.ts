import type { Clock } from "./clock";
import { RuleViolated } from "./errors";

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

/**
 * Refuses an actor with no `userId`, for the commands whose whole record
 * depends on naming one.
 *
 * `requireManager` (`../catalogue/policy.ts`, `../members/policy.ts`) answers
 * a different question and cannot answer this one: it ranks a role, and
 * `systemContext` above yields `{ userId: null, membershipId: null, role:
 * "super_admin" }` — the highest rank in the table, with nobody behind it. A
 * command guarded on rank alone therefore *passes* under the seed's or a
 * scheduled job's context and commits a row whose actor columns are all null.
 *
 * INV-8 requires the audit record to name the actor, and BR §11's whole
 * argument for voiding a loan rather than deleting it is that "why is there no
 * loan here" has an answer six months later — with a null actor it has half an
 * answer. `voidLoan` shipped resolving under `systemContext` with
 * `loans.voided_by = null` and `audit_log.actor_id = null`; `lendCopy` shipped
 * raising a raw `PostgresError` 23502 on `lent_by` from inside the
 * transaction, which OPS §2 forbids ("a command never fails with a bare 500 or
 * an unstructured exception"); only `receiveReturn` refused by name. One check
 * in one place, rather than the three-way disagreement that was the tell.
 *
 * This lives in the kernel beside `Actor` and `atLeast` — the two things it is
 * about — rather than beside either copy of `requireManager`, because putting
 * it beside one of them means the other domain gets the copy that drifts.
 * `requireManager` itself is headed here too, once moving it stops being a
 * change to `src/auth`'s neighbours (see the note on either copy).
 *
 * `not_permitted` rather than a new code: OPS §4.2 lists no failure mode for
 * this on any of the three commands, an `ErrorCode` may not be invented with a
 * Vietnamese sentence nobody wrote, and "Bạn không có quyền thực hiện việc
 * này." is exactly what a caller with no identity is being told. It is also
 * the code `receiveReturn` already used for this, so nothing that was already
 * refused starts being refused differently.
 */
export function requireIdentifiedActor(ctx: TenantContext): void {
  if (!ctx.actor.userId) throw new RuleViolated("not_permitted");
}
