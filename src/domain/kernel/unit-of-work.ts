import type { JSONValue, Sql, TransactionSql } from "postgres";
import type { AuditEntry } from "./audit";
import { toRow } from "./audit";
import type { ErrorCode } from "./errors";
import { NotFound, ValidationFailed } from "./errors";
import type { TenantContext } from "./tenant";

export type Tx = TransactionSql;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects a malformed `bookshelfId` before it ever reaches Postgres.
 *
 * An empty string is the sentinel `0010_rls.sql`'s `nullif(current_setting
 * (...), '')` exists to handle: it fails closed to zero rows, deliberately,
 * so it passes through here unchanged. A non-empty string that is not a UUID
 * has no such handling anywhere in the policy — it reaches the cast inside
 * that same `nullif(...)::uuid` the moment any scoped table is touched and
 * raises a raw `PostgresError: invalid input syntax for type uuid` from
 * inside the transaction, a driver error at the kernel boundary rather than
 * a named one. Checking the shape here, before `sql.begin` ever opens a
 * transaction, turns that into `ValidationFailed` instead.
 */
function assertValidBookshelfId(bookshelfId: string): void {
  if (bookshelfId !== "" && !UUID_RE.test(bookshelfId)) {
    throw new ValidationFailed("invalid_bookshelf_id", "bookshelfId");
  }
}

/**
 * Asserts a write affected exactly the row(s) a command expected — call this
 * immediately after any `update`/`delete` meant to touch a specific known
 * row (or rows).
 *
 * RLS's `with check` raises on an `insert` that names another shelf, but its
 * `using` clause only *filters* rows on `update`/`delete` — it does not
 * raise. A command that does `update books set title = ... where id =
 * ${bookId}` against a `bookId` belonging to another shelf is not rejected:
 * the statement affects zero rows, the command still resolves, and — because
 * the kernel does not parse SQL and cannot tell the difference — the audit
 * entry the command returns still commits, claiming a change that never
 * happened.
 *
 * `sql\`update ...\`` and `sql\`delete ...\`` results carry a `.count` from
 * the command tag (the `postgres` driver's `ResultMeta`); pass that result
 * straight through.
 *
 * Deliberately not automatic — `runCommand`/`runGlobalCommand` do not call
 * this for every write in a transaction. The kernel has no way to tell "zero
 * rows because this row belongs to another shelf" (a bug) apart from "zero
 * rows because a genuinely conditional update legitimately found nothing to
 * do" (fine) — only the command, which knows what it expected, can. Most
 * commands in the catalogue select the row first (inside the same
 * transaction, already shelf-scoped) and so never hit this at all; the ones
 * that write by id without a prior select are exactly the ones that must
 * call this, the same way reaching for `runGlobalCommand` is a deliberate,
 * visible act rather than something the kernel infers for you.
 */
export function assertWritten(
  result: { count: number | null },
  code: ErrorCode,
  expected = 1,
): void {
  if (result.count !== expected) {
    throw new NotFound(code);
  }
}

/**
 * A command: one business fact, plus the audit record that describes it.
 *
 * Returning the audit entry rather than writing it is the whole design. A
 * command that produces no audit entry does not type-check, so G3 — "a
 * command's state change and its audit record commit together or not at all"
 * — is a property of the signature rather than of anyone's memory.
 *
 * Commands never open a transaction. They receive one. That is what keeps
 * "one command, one transaction" true when commands start calling helpers.
 */
export type Command<I, O> = (
  tx: Tx,
  ctx: TenantContext,
  input: I,
) => Promise<{ result: O; audit: AuditEntry | AuditEntry[] }>;

/**
 * Runs `command` in one transaction, scoped to `ctx.bookshelfId`. `role`
 * controls only whether the *audit insert* — never the command body — may
 * write a null-`bookshelf_id` row.
 *
 * `set_config(..., true)` is transaction-local, which is why the driver must
 * be pooled in transaction mode rather than session mode (DB §3). Getting that
 * wrong leaks one request's shelf into the next request on the same
 * connection, and it does so silently.
 *
 * `set local role` is what makes the scoping bite rather than merely read as
 * intent: every connection in this codebase, dev and test alike, currently
 * authenticates as `olibra`, a `bypassrls` superuser (DATABASE.md §3), and a
 * superuser ignores row-level security regardless of what `set_config` claims
 * the shelf is. `set local role olibra_app` is the same switch
 * `tests/invariants/inv-10-tenant-isolation.test.ts` already relies on for
 * reads — a superuser may always switch into an unprivileged role, and once
 * switched, RLS applies.
 *
 * The command body always runs as `olibra_app`, tenant-scoped, regardless of
 * `role`. IMPORTANT 3 (fix-report, 2026-08-07-s2-domain-kernel): an earlier
 * version set the role once, for the whole transaction, before running
 * `command` — so `runGlobalCommand` escalated the command's own writes along
 * with the audit insert, and a command run through it could write a book
 * into another shelf. `runGlobalCommand` exists for exactly one reason (see
 * its docstring): a null-`bookshelf_id` audit row, which `olibra_app` cannot
 * write. So only the audit insert below ever runs as `olibra_admin`, and
 * only when `role` asked for it — `set local role olibra_admin` immediately
 * before the insert loop, `set local role olibra_app` immediately after.
 * Every `set local role` statement here is a literal, never one built from a
 * variable, so nothing in this function hands Postgres an interpolated role
 * name.
 *
 * `nullif(current_setting(...), '')` — not a bare cast — lives in the policy,
 * not here (see `0010_rls.sql`): `runAs` only ever calls `set_config` with a
 * real, non-empty `ctx.bookshelfId` (checked by `assertValidBookshelfId`
 * above), so it has nothing to guard against on that front.
 *
 * What this is not: a defense against a malicious command. A command body
 * can run `reset role` and regain the underlying connection's superuser
 * privileges — commands are our own code, not untrusted input, so this is
 * not a threat model this kernel defends against. "Structural" here means
 * structural against *mistakes* — a copy-pasted id, a mixed-up `ctx` — not
 * against a command that deliberately works around its own scoping.
 */
async function runAs<I, O>(
  sql: Sql,
  ctx: TenantContext,
  role: "olibra_app" | "olibra_admin",
  command: Command<I, O>,
  input: I,
): Promise<O> {
  assertValidBookshelfId(ctx.bookshelfId);
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    await tx`set local role olibra_app`;

    const { result, audit } = await command(tx as Tx, ctx, input);

    const entries = Array.isArray(audit) ? audit : [audit];

    if (role === "olibra_admin") {
      await tx`set local role olibra_admin`;
    }

    for (const entry of entries) {
      const row = toRow(entry, ctx);
      await tx`
        insert into audit_log
          (bookshelf_id, actor_id, action, entity_type, entity_id,
           before, after, occurred_at)
        values
          (${row.bookshelfId}, ${row.actorId}, ${row.action}, ${row.entityType},
           ${row.entityId}, ${tx.json((row.before ?? null) as JSONValue)},
           ${tx.json((row.after ?? null) as JSONValue)}, ${row.occurredAt})
      `;
    }

    if (role === "olibra_admin") {
      await tx`set local role olibra_app`;
    }

    return result;
  }) as Promise<O>;
}

/**
 * Runs a command as `olibra_app` — every ordinary request. This is the only
 * path almost every command in the catalogue needs: RLS scopes both the
 * command's own writes and its audit entry to `ctx.bookshelfId`, and an
 * `insert` naming a row (or an audit entry, via `AuditEntry.global`)
 * belonging to another shelf, or to no shelf, is rejected by the database
 * before it commits.
 *
 * That rejection is `insert`-only. An `update`/`delete` that targets a row
 * belonging to another shelf is not rejected — RLS's `using` clause filters
 * it to zero affected rows instead of raising, so the statement "succeeds"
 * having changed nothing. A command that writes by id without first
 * selecting the row (already shelf-scoped, in the same transaction) must
 * call `assertWritten` on the result to turn that silent zero into a named
 * error instead of a command that resolves successfully and commits an
 * audit entry describing a change that never happened.
 */
export async function runCommand<I, O>(
  sql: Sql,
  ctx: TenantContext,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  return runAs(sql, ctx, "olibra_app", command, input);
}

/**
 * Runs a command as `olibra_admin` for its audit insert only — the
 * deliberate, visible escalation for a system-wide fact that has no owning
 * shelf. The command *body* still runs as `olibra_app`, exactly as under
 * `runCommand`; see `runAs`, above, for why that split matters.
 *
 * This exists for exactly one reason: `audit_log`'s policy makes a null
 * `bookshelf_id` unreachable to `olibra_app` in either direction (BR §13.2,
 * DATABASE.md §3), so a command whose audit entry sets `global: true` cannot
 * run through `runCommand` — the insert is rejected, not silently rescoped.
 * S1 built two separate Postgres roles precisely so that reaching for the
 * bypass is a name a reviewer sees at the call site (`runGlobalCommand`, not
 * a boolean option buried in an args bag that quietly widens scope). Every
 * command in the catalogue today is shelf-scoped; this function is the
 * exception, not the default, and should stay rare enough that a diff
 * introducing a new call to it is worth a second look.
 */
export async function runGlobalCommand<I, O>(
  sql: Sql,
  ctx: TenantContext,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  return runAs(sql, ctx, "olibra_admin", command, input);
}

/**
 * Runs a read in a scoped, read-only transaction.
 *
 * Read-only is not decoration: OPS §1 says "queries never change state", and
 * a transaction the database refuses writes on turns that from a naming
 * convention into something enforced. A query that grows an `insert` during a
 * hurried afternoon fails loudly instead of quietly becoming a command with no
 * audit record.
 *
 * `set local role olibra_app` is what actually makes the tenant scoping bite.
 * DB §3 (see `docs/DATABASE.md`) is explicit that every connection in this
 * codebase — dev and test alike — authenticates as `olibra`, a bypassrls
 * superuser, until S3 wires up a real non-superuser application role; a
 * superuser ignores row-level security regardless of what `set_config`
 * claims the shelf is. `tests/invariants/inv-10-tenant-isolation.test.ts`
 * already leans on exactly this: `set local role olibra_app` works today
 * because a superuser may always switch into an unprivileged role, and once
 * switched, RLS applies. `runQuery` does the same switch as `runAs` (above)
 * so that scoping is a property of the function rather than of the caller
 * remembering to ask for it — the write side (`runCommand`/
 * `runGlobalCommand`) does this too, closing what DATABASE.md §3 used to
 * flag as still-missing there; that gap is closed, not open, as of this
 * module.
 */
export async function runQuery<O>(
  sql: Sql,
  ctx: TenantContext,
  query: (tx: Tx, ctx: TenantContext) => Promise<O>,
): Promise<O> {
  assertValidBookshelfId(ctx.bookshelfId);
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    await tx`set local role olibra_app`;
    return query(tx as Tx, ctx);
  }) as Promise<O>;
}
