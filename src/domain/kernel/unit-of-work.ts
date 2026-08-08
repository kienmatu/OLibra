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

/**
 * The shape `Date.prototype.toISOString()` produces for every instant
 * `olibra_now()` will accept: a four-digit year, and `Z` rather than a naked
 * local time.
 *
 * Deliberately the same shape `olibra_now()` itself enforces
 * (`20260808_15_olibra_now_strict.sql`). Two checks, one contract: this one
 * so the failure is a named error at the kernel boundary, that one because
 * the function is the schema's contract and is reachable from `psql`.
 */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Rejects a `Clock` whose `now()` cannot be sent to Postgres, before
 * `sql.begin` ever opens a transaction — the symmetry `assertValidBookshelfId`
 * above already has, and the clock did not.
 *
 * Both settings on a scoped transaction come from `ctx`; only one of them was
 * checked. `ctx.clock.now().toISOString()` was evaluated *inside* `sql.begin`,
 * so a broken clock surfaced exactly the way a malformed `bookshelfId` used to,
 * which is the thing that function exists to prevent. Measured through
 * `runQuery` against a view that calls `olibra_now()`:
 *
 * - `new Date("nonsense")`, `new Date(Infinity)` — `toISOString()` throws a
 *   raw `RangeError: Invalid time value` from inside the transaction. No
 *   `code`, not a `DomainError`, nothing a caller can branch on.
 * - `new Date(8.64e15)`, the largest valid `Date` — `toISOString()` succeeds
 *   and yields `+275760-09-13T00:00:00.000Z`, which Postgres then rejects with
 *   `PostgresError 22009: time zone displacement out of range`. A raw driver
 *   error from inside a transaction: the exact shape, and the exact place,
 *   `assertValidBookshelfId` was written for.
 *
 * **None of this is reachable in production.** `systemClock.now()` is
 * `new Date()`, which is always valid and always in range. This is a
 * test-authoring footgun and a symmetry gap, not a defect: `fixedClock(
 * "2026-13-45")` is a plausible typo, and today it fails deep in the kernel
 * with a message that names neither the clock nor the test that set it.
 *
 * The code is `validation_failed` rather than something clock-specific
 * because this branch adds no `ErrorCode`; the `field` is what carries which
 * of the two settings was wrong, exactly as `"bookshelfId"` does above. A
 * later slice that wants a distinct code and Vietnamese sentence for it is
 * welcome to it — no volunteer can act on either message, so the value would
 * be to the next developer reading a stack trace, not to a reader.
 *
 * Returns the string to send, so the caller cannot check one value and send a
 * differently-derived other one.
 */
function assertValidClockInstant(clock: TenantContext["clock"]): string {
  const instant = clock.now();
  if (!Number.isFinite(instant.getTime())) {
    throw new ValidationFailed("validation_failed", "clock");
  }
  const iso = instant.toISOString();
  if (!ISO_INSTANT_RE.test(iso)) {
    throw new ValidationFailed("validation_failed", "clock");
  }
  return iso;
}

/**
 * Sets the two session settings every scoped transaction runs under: the
 * tenant, and the clock.
 *
 * Both are `set_config(..., true)` — the `true` is `LOCAL`, scoped to this
 * transaction and no further, which is why the driver must be pooled in
 * transaction mode (DB §3). Getting that wrong leaks one request's shelf
 * into the next request on the same connection, silently; the same is now
 * true of one request's clock, and `tests/db/sql-clock.test.ts` asserts the
 * non-leak directly rather than trusting the flag.
 *
 * `olibra.bookshelf_id` is read back by `0010_rls.sql`'s `<table>_tenant`
 * policies. `olibra.now` is read back by `olibra_now()`
 * (`20260808_14_olibra_now.sql`), which `loans_current` and
 * `copies_borrowable` call in place of `now()` — so `is_overdue`,
 * `days_remaining` and hold expiry all follow `ctx.clock` instead of
 * ignoring it. Before this, `src/domain/kernel/clock.ts`'s whole premise
 * ("every one of those rules is only testable if the clock can be moved")
 * held in TypeScript and failed in SQL: a test could hold a `fixedClock` and
 * still not make a loan overdue or a hold expire without waiting real time.
 *
 * **This does change whose clock the two views read in production, and that
 * is worth being precise about.** `ctx.clock` is `systemClock` on every real
 * request, so the value written here is `new Date()` in *this Node/Bun
 * process* — not `now()` in the database. On the composed stack those are the
 * same machine and the distinction is invisible; split them, or run two app
 * instances whose clocks disagree, and overdue status and hold expiry follow
 * the application host while every `default now()` column follows the
 * database host. DB §6, "Two clocks in one transaction", is the long version,
 * including the rule that follows from it: **a timestamp the domain means —
 * `lent_at`, `requested_at`, `assessed_at` — is written explicitly from
 * `ctx.clock`, not left to a column default.** Defaults stay as a backstop
 * for rows written outside the domain; they are not a source a `fixedClock`
 * can move, and they are not the same clock as this one.
 *
 * What is *not* given up is the one-consistent-now-per-transaction property a
 * reader will immediately wonder about: Postgres's `now()` is *transaction
 * start* time, not statement time, and this is one value captured once,
 * before the command body runs, and read by every statement in the
 * transaction. That is the same guarantee, sourced from the clock the domain
 * already injects everywhere else.
 *
 * `nowIso` is an ISO-8601 string rather than the `Date` itself, because
 * `set_config`'s second parameter is `text`: the driver would otherwise bind a
 * `timestamptz` against a `text` parameter. The explicit `Z` offset is not
 * cosmetic — it is what makes the string round-trip through `::timestamptz` in
 * `olibra_now()` unambiguously, regardless of the session's `TimeZone`, which
 * DB §2.2 warns must never be relied on for correctness since a web request, a
 * migration console and a background job may each carry a different one. The
 * same string without an offset is three different instants under three
 * `TimeZone` settings, so `olibra_now()` refuses one (see
 * `20260808_15_olibra_now_strict.sql`) and `assertValidClockInstant` above
 * refuses to send one.
 *
 * It arrives as a parameter, already checked by `assertValidClockInstant`
 * *before* `sql.begin`, rather than being derived here — a clock read here
 * could be a different value from the one that was validated, and a clock
 * that throws here throws from inside a transaction.
 */
async function setSessionScope(
  tx: RawTx,
  ctx: TenantContext,
  nowIso: string,
): Promise<void> {
  await tx`select set_config('olibra.bookshelf_id', ${ctx.bookshelfId}, true)`;
  await tx`select set_config('olibra.now', ${nowIso}, true)`;
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
  const nowIso = assertValidClockInstant(ctx.clock);
  return sql.begin(async (tx) => {
    await setSessionScope(tx as RawTx, ctx, nowIso);
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
  const nowIso = assertValidClockInstant(ctx.clock);
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await setSessionScope(tx as RawTx, ctx, nowIso);
    await tx`set local role olibra_app`;
    return query(guardWrites(tx as RawTx), ctx);
  }) as Promise<O>;
}
