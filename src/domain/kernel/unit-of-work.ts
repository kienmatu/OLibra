import type { JSONValue, PendingQuery, Row, Sql, TransactionSql } from "postgres";
import type { AuditEntry } from "./audit";
import { toRow } from "./audit";
import type { ErrorCode } from "./errors";
import { NotFound, ValidationFailed } from "./errors";
import type { TenantContext } from "./tenant";

/** The driver's own transaction handle, before the zero-row write guard (below) wraps it. */
type RawTx = TransactionSql;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rejects a malformed `bookshelfId` before it ever reaches Postgres.
 *
 * A non-empty string that is not a UUID has no handling anywhere in the
 * policy — it reaches the cast inside `nullif(current_setting(...), '')
 * ::uuid` the moment any scoped table is touched and raises a raw
 * `PostgresError: invalid input syntax for type uuid` from inside the
 * transaction, a driver error at the kernel boundary rather than a named
 * one. Checking the shape here, before `sql.begin` ever opens a transaction,
 * turns that into `ValidationFailed` instead, on both paths.
 *
 * An empty string is different, and the two callers below disagree about it
 * on purpose:
 *
 * - `runQuery` passes `allowEmpty: true`. Empty is the sentinel
 *   `0010_rls.sql`'s policy is built to handle: `nullif('', '')` is `null`,
 *   `null::uuid` never raises, and the policy's own comparison then fails
 *   closed to zero rows — a read that asks for no shelf sees nothing, which
 *   is correct and must not become an error.
 * - `runAs` (the write path, both `runCommand` and `runGlobalCommand`)
 *   passes `allowEmpty: false`. The audit insert this function does after
 *   every command has no such `nullif` between it and the `uuid` column —
 *   `insert into audit_log (bookshelf_id, ...) values (${row.bookshelfId},
 *   ...)` binds an empty string straight into a `uuid` column, and Postgres
 *   raises the same raw, unstructured `PostgresError` a malformed id does.
 *   There is no legitimate "fails closed" reading of an empty shelf on the
 *   write path — a command always acts within a real shelf — so this is
 *   rejected the same way a non-UUID string is, before any transaction
 *   opens.
 */
function assertValidBookshelfId(
  bookshelfId: string,
  { allowEmpty }: { allowEmpty: boolean },
): void {
  if (bookshelfId === "") {
    if (allowEmpty) return;
    throw new ValidationFailed("invalid_bookshelf_id", "bookshelfId");
  }
  if (!UUID_RE.test(bookshelfId)) {
    throw new ValidationFailed("invalid_bookshelf_id", "bookshelfId");
  }
}

/** `UPDATE`/`DELETE` are the two statement types RLS's `using` clause can filter to zero rows without raising. */
const GUARDED_COMMANDS = new Set(["UPDATE", "DELETE"]);

/**
 * A guarded `tx\`...\`` result. Awaiting it is unchanged for a read, and for
 * a write that matched rows. `allowZero()` is the escape hatch for a write
 * that may legitimately match nothing — a genuinely conditional
 * `update`/`delete` — declared at the call site, before the await, so a
 * reviewer sees the opt-out exactly where the risk is:
 *
 * ```ts
 * const result = await tx`update ... where id = ${id} and status = 'draft'`.allowZero();
 * ```
 */
export interface GuardedPendingQuery<
  T extends readonly (object | undefined)[] = Row[],
> extends PendingQuery<T> {
  allowZero(): PendingQuery<T>;
}

/**
 * The handle a `Command` actually receives — `tx` from the driver, wrapped
 * so its tagged-template calls return a `GuardedPendingQuery` (see
 * `guardWrites`, below) instead of a bare `PendingQuery`. Everything else on
 * `Tx` — `.json`, `.unsafe`, `.array`, `.begin`/`.savepoint`, and so on — is
 * the driver's own `TransactionSql`, untouched.
 */
export interface Tx extends RawTx {
  <T extends readonly (object | undefined)[] = Row[]>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): GuardedPendingQuery<T>;
}

/**
 * Wraps one `tx\`...\`` result so an `UPDATE`/`DELETE` that affects zero
 * rows rejects instead of resolving as if it had succeeded.
 *
 * `result.command` and `result.count` come straight from the `postgres`
 * driver's own `ResultMeta` — the kernel does not parse SQL to get them.
 * Probed live, inside a real `runCommand`, against the three statement
 * shapes a command actually issues:
 *
 * ```
 * update -> command=UPDATE count=0 | select -> command=SELECT count=1 | insert -> command=INSERT count=1
 * ```
 *
 * `SELECT` and `INSERT` are never in `GUARDED_COMMANDS`: a read has nothing
 * to guard, and `insert`'s cross-shelf case is already rejected by RLS's
 * `with check` (raises, rather than filtering) before this ever runs. Only
 * `UPDATE`/`DELETE` reach here with a `count` that can silently be `0`.
 *
 * The check runs inside the `.then` chained onto the driver's own pending
 * query (`Query` sets `Symbol.species` to the plain `Promise`, so this
 * chain is a normal `Promise`, safe to attach extra properties to) — every
 * other `PendingQuery` method (`.raw()`, `.values()`, `.cursor()`, ...) is
 * forwarded to the original, unguarded, query object, since none of them
 * participate in the settled `count`/`command` this guard inspects.
 */
function guardPendingQuery<T extends readonly (object | undefined)[]>(
  pending: PendingQuery<T>,
): GuardedPendingQuery<T> {
  let allow = false;

  const checked = pending.then((result) => {
    const meta = result as unknown as { command: string; count: number | null };
    if (!allow && GUARDED_COMMANDS.has(meta.command) && meta.count === 0) {
      throw new NotFound("write_target_not_found");
    }
    return result;
  });

  return Object.assign(checked, {
    allowZero: () => {
      allow = true;
      return checked;
    },
    simple: pending.simple.bind(pending),
    readable: pending.readable.bind(pending),
    writable: pending.writable.bind(pending),
    execute: pending.execute.bind(pending),
    cancel: pending.cancel.bind(pending),
    forEach: pending.forEach.bind(pending),
    cursor: pending.cursor.bind(pending),
    describe: pending.describe.bind(pending),
    values: pending.values.bind(pending),
    raw: pending.raw.bind(pending),
  }) as unknown as GuardedPendingQuery<T>;
}

/**
 * Wraps a transaction handle so every tagged-template call a `Command` makes
 * through it returns a `GuardedPendingQuery` (see `guardPendingQuery`,
 * above) rather than a bare one.
 *
 * A `Proxy` around the callable `tx`, intercepting only `apply` — the
 * tagged-template call itself. Every other property (`.json`, `.unsafe`,
 * `.array`, `.begin`, ...) falls through to the driver's default behavior
 * untouched, which is safe here specifically because `postgres`'s `Sql`
 * function is a plain closure with methods attached by `Object.assign`
 * (verified against `node_modules/postgres/src/index.js`) — none of it
 * reads `this`, so a `Proxy` receiver in place of the real object changes
 * nothing. (This would not be safe against a class using private `#fields`,
 * where a `Proxy` receiver breaks `this.#field` access; `postgres` uses
 * neither classes nor private fields for `Sql` itself.)
 */
function guardWrites(raw: RawTx): Tx {
  const callable = raw as unknown as (...args: unknown[]) => PendingQuery<Row[]>;
  return new Proxy(callable, {
    apply(target, _thisArg, argArray) {
      return guardPendingQuery(Reflect.apply(target, undefined, argArray));
    },
  }) as unknown as Tx;
}

/**
 * Asserts a write affected exactly the row(s) a command expected — an
 * explicit, code-carrying alternative to the guard above, for a command
 * that wants its own `ErrorCode` (or a count other than 1) instead of the
 * guard's generic `write_target_not_found`.
 *
 * As of the `Tx` wrapper (above), the guard already rejects any
 * `UPDATE`/`DELETE` a `Command` runs through `tx` that affects zero rows —
 * `assertWritten` is no longer what makes that structural. What it is still
 * for: a command that wants a *specific* `NotFound` (`book_not_found`
 * rather than the kernel's generic code) or an *expected count other than
 * one*. Reach for both together — call `.allowZero()` on the query to opt
 * out of the automatic guard, then call `assertWritten` on the result with
 * the code this command actually wants:
 *
 * ```ts
 * const result = await tx`update books set title = ... where id = ${bookId}`.allowZero();
 * assertWritten(result, "book_not_found");
 * ```
 *
 * `sql\`update ...\`` and `sql\`delete ...\`` results carry a `.count` from
 * the command tag (the `postgres` driver's `ResultMeta`); pass that result
 * straight through.
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
 * `command` receives `guardWrites(tx)`, not `tx` itself — see `guardWrites`
 * and `guardPendingQuery`, above, for the zero-row write guard this hands
 * every command by construction.
 *
 * `nullif(current_setting(...), '')` — not a bare cast — lives in the policy,
 * not here (see `0010_rls.sql`): `runAs` only ever calls `set_config` with a
 * real, non-empty `ctx.bookshelfId` (checked by `assertValidBookshelfId`
 * above, with `allowEmpty: false` — the write path has no legitimate
 * "empty shelf" reading, see that function's docstring), so it has nothing
 * to guard against on that front.
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
  assertValidBookshelfId(ctx.bookshelfId, { allowEmpty: false });
  return sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    await tx`set local role olibra_app`;

    const { result, audit } = await command(guardWrites(tx as RawTx), ctx, input);

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
 * That rejection is `insert`-only at the database level. An `update`/
 * `delete` that targets a row belonging to another shelf is not rejected by
 * RLS — its `using` clause filters it to zero affected rows instead of
 * raising, so the statement "succeeds" having changed nothing. `command`
 * runs against a guarded `tx` (see `guardWrites`, above), which is what
 * turns that silent zero into a rejection by default: an `UPDATE`/`DELETE`
 * a command runs through `tx` that affects zero rows throws
 * `NotFound("write_target_not_found")` unless the query explicitly opts out
 * with `.allowZero()`. See `assertWritten`'s docstring for when a command
 * wants a more specific error than that default.
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
 *
 * `assertValidBookshelfId` is called with `allowEmpty: true` here — unlike
 * the write path, an empty `ctx.bookshelfId` has a legitimate reading for a
 * read: it is the sentinel the policy's `nullif(...)` handles by failing
 * closed to zero rows, not an error. See that function's docstring for why
 * the write path disagrees.
 */
export async function runQuery<O>(
  sql: Sql,
  ctx: TenantContext,
  query: (tx: Tx, ctx: TenantContext) => Promise<O>,
): Promise<O> {
  assertValidBookshelfId(ctx.bookshelfId, { allowEmpty: true });
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
    await tx`set local role olibra_app`;
    return query(guardWrites(tx as RawTx), ctx);
  }) as Promise<O>;
}
