import { RuleViolated } from "./errors";
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
  /**
   * True for a system-wide fact with no owning shelf — a null `bookshelf_id`
   * row in `audit_log` (BR §13.2: cross-shelf audit visibility is a
   * super_admin permission; DATABASE.md §3: audit_log's null means a
   * system-wide action, and its policy makes a null row unreachable, in
   * either direction, to `olibra_app`).
   *
   * Only `runGlobalCommand` can make this stick: it runs as `olibra_admin`,
   * which bypasses the policy. A command run through the ordinary
   * `runCommand` path (`olibra_app`) that sets this is not silently
   * downgraded to its own shelf — the insert is rejected outright, because
   * `audit_log_tenant`'s `with check` requires `bookshelf_id` to equal the
   * session's shelf, and null never does.
   */
  global?: boolean;
}

/**
 * Fields never permitted in an audit record.
 *
 * BR §2: "The audit records the act, never the secret." No password, no hash,
 * no session token — only that a named manager set credentials for a named
 * reader at a given time. The temptation to log "what it was changed to" is
 * strongest exactly here, so this is enforced rather than documented.
 *
 * Matched as whole snake_case/camelCase tokens (`assertNoSecrets`, below),
 * not substrings — `"password"` alone already catches `password_hash`, so
 * that entry was dropped: keeping both proved nothing, since removing
 * `password_hash` from this list while `password` stayed would never make a
 * test that only tries `password_hash` fail.
 *
 * `mat_khau` is `password` transliterated — this codebase's audit actions
 * and error messages are Vietnamese-facing (BR §2, §14), and a diff object
 * assembled from a Vietnamese-named source column is exactly the kind of
 * thing a command author might do without thinking of it as "password".
 */
const FORBIDDEN = [
  "password",
  "hash",
  "pwd",
  "token",
  "session",
  "secret",
  "mat_khau",
];

/**
 * Field names that would match a `FORBIDDEN` token but name something BR §2
 * explicitly permits — metadata *about* a secret, not the secret itself.
 * `password_changed_at`/`password_set_at` are the shape BR §2's own
 * permitted record takes ("a named manager set credentials for a named
 * reader at a given time"); `has_password` and `session_count` are booleans
 * and counts, never the value.
 *
 * Checked as whole dotted-path suffixes (see `isAllowed`, below), so
 * `credentials.has_password` is allowed by the same entry that allows
 * `has_password` at the top level.
 */
const ALLOWED = new Set([
  "password_changed_at",
  "password_set_at",
  "has_password",
  "session_count",
]);

function tokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isAllowed(key: string): boolean {
  return ALLOWED.has(key.toLowerCase()) || ALLOWED.has(tokens(key).join("_"));
}

function matchesForbiddenTerm(keyTokens: string[], term: string): boolean {
  const termTokens = tokens(term);
  for (let i = 0; i + termTokens.length <= keyTokens.length; i++) {
    if (termTokens.every((t, j) => keyTokens[i + j] === t)) return true;
  }
  return false;
}

/** True when `key`, matched as whole tokens rather than a substring, names a secret. */
function isForbiddenKey(key: string): boolean {
  if (isAllowed(key)) return false;
  const kt = tokens(key);
  return FORBIDDEN.some((term) => matchesForbiddenTerm(kt, term));
}

function walk(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(key)) throw new RuleViolated("audit_forbidden_field");
    walk(child);
  }
}

/**
 * Walks `before`/`after` — including nested objects and arrays, the natural
 * shape for a diff — and rejects any field whose name is a secret.
 *
 * A top-level-only guard is what let `after: { credentials: { password_hash
 * } } }` and `after: { changes: [{ password_hash }] }` reach the audit log:
 * nesting is legal on `Record<string, unknown>`, and it is exactly how a
 * command author writes "what changed" for a compound value.
 *
 * Throws `RuleViolated`, a `DomainError`, rather than a bare `Error` — OPS
 * §2: "a command never fails with a bare 500 or an unstructured exception."
 * The message deliberately does not name the offending field or its value:
 * the whole point is that neither belongs anywhere a stack trace or a log
 * line might surface it.
 */
export function assertNoSecrets(entry: AuditEntry): void {
  for (const bag of [entry.before, entry.after]) {
    if (!bag) continue;
    walk(bag);
  }
}

export type AuditRow = Omit<AuditEntry, "global"> & {
  bookshelfId: string | null;
  actorId: string | null;
  occurredAt: Date;
};

export function toRow(entry: AuditEntry, ctx: TenantContext): AuditRow {
  assertNoSecrets(entry);
  const { global: isGlobal, ...fact } = entry;
  return {
    ...fact,
    bookshelfId: isGlobal ? null : ctx.bookshelfId,
    actorId: ctx.actor.userId,
    occurredAt: ctx.clock.now(),
  };
}
