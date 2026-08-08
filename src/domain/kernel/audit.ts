import type { TenantContext } from "./tenant";

/**
 * One audit record, as a command declares it.
 *
 * BR §14 requires two things this shape encodes: an action name meaningful
 * enough for the browser to filter and label ("manager approved this
 * registration", not "update"), and the before/after values.
 */
export interface AuditEntry {
  /** `noun.verb` — `loan.created`, `credentials.set`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Fields never permitted in an audit record.
 *
 * BR §2: "The audit records the act, never the secret." No password, no hash,
 * no session token — only that a named manager set credentials for a named
 * reader at a given time. The temptation to log "what it was changed to" is
 * strongest exactly here, so this is enforced rather than documented.
 */
const FORBIDDEN = ["password", "password_hash", "token", "session", "secret"];

export function assertNoSecrets(entry: AuditEntry): void {
  for (const bag of [entry.before, entry.after]) {
    if (!bag) continue;
    for (const key of Object.keys(bag)) {
      if (FORBIDDEN.some((f) => key.toLowerCase().includes(f))) {
        throw new Error(
          `Audit entry for ${entry.action} carries a forbidden field "${key}". ` +
            "BR §2: the audit records the act, never the secret.",
        );
      }
    }
  }
}

export type AuditRow = AuditEntry & {
  bookshelfId: string;
  actorId: string | null;
  occurredAt: Date;
};

export function toRow(entry: AuditEntry, ctx: TenantContext): AuditRow {
  assertNoSecrets(entry);
  return {
    ...entry,
    bookshelfId: ctx.bookshelfId,
    actorId: ctx.actor.userId,
    occurredAt: ctx.clock.now(),
  };
}
