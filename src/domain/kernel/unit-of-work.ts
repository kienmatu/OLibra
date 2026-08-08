import type { JSONValue, Sql, TransactionSql } from "postgres";
import type { AuditEntry } from "./audit";
import { toRow } from "./audit";
import type { TenantContext } from "./tenant";

export type Tx = TransactionSql;

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
 * Runs `command` in one transaction, scoped to `ctx.bookshelfId`, as `role`.
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
 * the shelf is. `set local role olibra_app` (or `olibra_admin`, for the
 * escalation `runGlobalCommand` asks for) is the same switch
 * `tests/invariants/inv-10-tenant-isolation.test.ts` already relies on for
 * reads — a superuser may always switch into an unprivileged role, and once
 * switched, RLS applies. Only two literal `set local role` statements ever
 * run here, never one built from a variable, so nothing in this function
 * hands Postgres an interpolated role name.
 *
 * `nullif(current_setting(...), '')` — not a bare cast — lives in the policy,
 * not here (see `0010_rls.sql`): `runAs` only ever calls `set_config` with a
 * real, non-empty `ctx.bookshelfId`, so it has nothing to guard against on
 * that front.
 */
async function runAs<I, O>(
  sql: Sql,
  ctx: TenantContext,
  role: "olibra_app" | "olibra_admin",
  command: Command<I, O>,
  input: I,
): Promise<O> {
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    if (role === "olibra_admin") {
      await tx`set local role olibra_admin`;
    } else {
      await tx`set local role olibra_app`;
    }

    const { result, audit } = await command(tx as Tx, ctx, input);

    const entries = Array.isArray(audit) ? audit : [audit];
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

    return result;
  }) as Promise<O>;
}

/**
 * Runs a command as `olibra_app` — every ordinary request. This is the only
 * path almost every command in the catalogue needs: RLS scopes both the
 * command's own writes and its audit entry to `ctx.bookshelfId`, and an
 * attempt to write a row (or an audit entry, via `AuditEntry.global`)
 * belonging to another shelf, or to no shelf, is rejected by the database
 * before it commits.
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
 * Runs a command as `olibra_admin` — the deliberate, visible escalation for
 * a system-wide fact that has no owning shelf.
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
 * switched, RLS applies. `runQuery` does the same switch so that scoping is a
 * property of the function rather than of the caller remembering to ask for
 * it — DATABASE.md §3 flags this same switch as still-missing on the write
 * side (`runCommand`), which is why `INV-10: a query scoped to shelf A cannot
 * see shelf B's books`-style enforcement was never structural until now.
 */
export async function runQuery<O>(
  sql: Sql,
  ctx: TenantContext,
  query: (tx: Tx, ctx: TenantContext) => Promise<O>,
): Promise<O> {
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    await tx`set local role olibra_app`;
    return query(tx as Tx, ctx);
  }) as Promise<O>;
}
