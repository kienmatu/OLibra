import type { JSONValue, PendingQuery, Row, Sql, TransactionSql } from "postgres";
import type { AuditEntry } from "./audit";
import { toRow } from "./audit";
import type { ErrorCode } from "./errors";
import { NotFound, RuleViolated, ValidationFailed } from "./errors";
import { atLeast } from "./tenant";
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
 * Runs a command with **no shelf and no elevated caller** — the write
 * counterpart of `runPublicQuery`, for the one write in the catalogue a
 * stranger holding neither a shelf nor a session may make.
 *
 * **Why neither `runCommand` nor `runGlobalCommand` can serve this caller.**
 * Both go through `runAs`, and `runAs` calls `assertValidBookshelfId(ctx
 * .bookshelfId, { allowEmpty: false })` before it opens a transaction — its
 * own docstring gives the reason: "a command always acts within a real
 * shelf." That held for every command in the catalogue until Task 17
 * (2026-08-10 QA remediation) wired `/lien-he`'s site-wide góp ý form: a
 * parish with no shelf yet, reading the front door with no session either, is
 * a caller `runAs` was never asked to admit. Widening `allowEmpty` on `runAs`
 * itself was rejected — every existing caller of `runCommand`/
 * `runGlobalCommand` is a *shelf's own* write, and an empty `ctx.bookshelfId`
 * reaching either of them today is exactly the copy-pasted-context mistake
 * that check exists to catch (`command-scope.test.ts`'s "an empty-string
 * bookshelfId on the command path is also a named ValidationFailed"). A third,
 * separately named function keeps that guard intact for every command that
 * still needs it, rather than a parameter that would have to be threaded
 * through — and remembered — at every one of their call sites.
 *
 * **The shape is `runGlobalCommand`'s, with one check relaxed.** The command
 * body still runs as `olibra_app`, scoped to the empty sentinel — the same
 * scope `runPublicQuery` sets, for the identical reason: `''` is what
 * `nullif(current_setting(...), '')` turns into `null`, so every ordinary
 * `<table>_tenant` policy fails closed to zero rows for this session.
 * `feedback_tenant` is the one policy in the schema that does not: its `with
 * check` admits a `bookshelf_id is null` row from *any* session, scoped or
 * not (`20260808_01_feedback_rls.sql`), which is what lets `submitFeedback`'s
 * insert succeed here at all. A second command reached through this seam
 * inherits exactly the privileges `olibra_app` always has and nothing more —
 * the same least-privilege argument `runPublicQuery`'s own docstring makes
 * for reads, run in the other direction for a write.
 *
 * **Every audit entry must be `global: true`, and the reason is arithmetic,
 * not policy.** `ctx.bookshelfId` is always `""` here — the caller has no
 * shelf to put in it — so a non-global entry would ask `toRow` to bind `""`
 * into `audit_log.bookshelf_id`, the exact raw-`uuid`-cast failure
 * `assertValidBookshelfId` exists to turn into a named refusal everywhere
 * else. Checked explicitly below, the same guard `runAdminCommand` already
 * applies for its own empty-scope case, rather than left to surface as
 * Postgres's own `22P02` from inside the transaction.
 *
 * **No `requireSuperAdminActor` gate, unlike `runAdminQuery`/
 * `runAdminCommand` — deliberately the opposite floor.** Those two exist so
 * that only the most trusted caller in the system reaches `olibra_admin`;
 * this exists so that the *least* trusted caller — someone who has proven
 * nothing about who they are — can still make the one write OPS §4.4 opens to
 * `guest`. The two pairs read as mirror images and are not: one widens who
 * may be admitted, the other widens what an admitted stranger may write, and
 * treating them as the same shape would be the same mistake in either
 * direction.
 *
 * **Rare by construction, not by convention.** `submitFeedback` is, as of
 * this writing, the only command whose `SubmitFeedbackInput` can express a
 * caller with no shelf (`bookshelfId: null`, out loud). A future command
 * reached through this seam should be held to the same question this one
 * answers explicitly: is this genuinely a write OPS lists as open to `guest`
 * with no membership anywhere, or does it merely look convenient from inside
 * a page that has not resolved a shelf yet.
 */
export async function runPublicCommand<I, O>(
  sql: Sql,
  ctx: TenantContext,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  assertValidBookshelfId(ctx.bookshelfId, { allowEmpty: true });
  const nowIso = assertValidClockInstant(ctx.clock);
  return sql.begin(async (tx) => {
    await setSessionScope(tx as RawTx, ctx, nowIso);
    await tx`set local role olibra_app`;

    const { result, audit } = await command(guardWrites(tx as RawTx), ctx, input);

    await tx`set local role olibra_admin`;
    for (const entry of Array.isArray(audit) ? audit : [audit]) {
      const row = toRow(entry, ctx);
      // See the docstring above: every entry through this seam must be
      // global, because `ctx.bookshelfId` is always empty here.
      if (row.bookshelfId === "") {
        throw new ValidationFailed("invalid_bookshelf_id", "bookshelfId");
      }
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
    await tx`set local role olibra_app`;

    return result;
  }) as Promise<O>;
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

/**
 * Runs a read that belongs to **no shelf**, as `olibra_app`, in a read-only
 * transaction with the tenant scope deliberately empty.
 *
 * There is exactly one thing in this system a caller may read without naming a
 * shelf, and OPS §3.1 is where it is enumerated: the portal directory
 * (`GetPortalDirectory`, `SearchBookshelves`), both **Global**, both callable
 * by `guest`. OPS §2 (`OPERATIONS.md:25`) lists that alongside
 * promote-to-super-admin and the cross-shelf administration views as the whole
 * of INV-10's named exceptions.
 * A stranger looking for their parish has no membership anywhere, so there is
 * no shelf for `runQuery` to scope to — which is the situation, and not a
 * shortcut around one.
 *
 * **What this is not: the `bypassrls` escalation.** `runGlobalCommand` reaches
 * for `olibra_admin`, and its docstring is explicit that this should stay rare
 * enough that a diff introducing a call to it is worth a second look. This
 * function goes the other way entirely: `olibra_public`
 * (`20260809_01_public_role.sql`) holds strictly *less* than the `olibra_app`
 * every other read runs as.
 *
 * **The role is `olibra_public`, and it is privileges rather than policies that
 * make this safe.** IMPORTANT 1 (fix-report, 2026-08-09-u2-shelf-and-portal):
 * this function used to run as `olibra_app`, on the argument that "every other
 * table's `<table>_tenant` policy is `bookshelf_id = <the GUC>`, which under
 * the empty scope below is `null` and therefore matches no row at all". Swept
 * through the real pool inside this exact transaction, that held for thirteen
 * tables and failed for five: `users` and `sessions` carry no RLS at all (so a
 * public read reached every account row, `password_hash` included, and every
 * live session token hash), `categories` and `schema_migrations` carry none
 * either, and `feedback_tenant`'s `using` admits `bookshelf_id is null`, which
 * is every site-wide row.
 *
 * None of it leaked, because `listPublicShelves` only ever touches
 * `bookshelves` — what it was, was the licence the next public read would be
 * written against. OPS §3.1 already specifies `GetSiteContact` as
 * guest-callable and Global, and written to join `users` for the
 * administrator's name it would have handed a stranger the whole table with
 * this docstring vouching for it.
 *
 * A policy has to be written per table, so it fails open for the table nobody
 * thought about. A grant is absent by default, so it fails closed for every
 * table including the ones a later migration adds. `olibra_public` therefore
 * has `usage` on the schema, a column-level `select` on the five `bookshelves`
 * columns BR §16.1 publishes, and **nothing else at all** — a public read that
 * wanders into `users` raises `42501: permission denied for table users`,
 * which is an error a test asserts and a future author cannot talk themselves
 * past. `tests/db/public-role-privileges.test.ts` sweeps every relation in the
 * schema, discovered from `pg_class`, and every column of `bookshelves`,
 * discovered from `information_schema`, so neither list can go stale.
 *
 * RLS still applies on top of that, unchanged and un-relaxed:
 * `bookshelves_public_read` (`20260808_12_bookshelves_public_read.sql`) is a
 * *permissive* `for select` policy over `status = 'active' and deleted_at is
 * null`, Postgres ORs permissive policies together, and `bookshelves_tenant`
 * under the empty scope below matches nothing. So the rows are the active,
 * undeleted ones and the columns are the five. Two independent boundaries
 * where there was one, and the one that was there was the weaker of them.
 *
 * **The scope is set to the empty string, not left unset.** `''` is the
 * sentinel `0010_rls.sql`'s `nullif(current_setting(...), '')` is built around
 * and `assertValidBookshelfId` already accepts on the read path: it becomes
 * `null::uuid`, and the policy comparison then fails closed to zero rows.
 * Writing it explicitly rather than omitting the statement is what makes this
 * transaction's scope a fact of this function instead of a fact about whatever
 * ran on the pooled connection before it. `set_config(..., true)` is
 * transaction-local, so a previous request's shelf could not survive into this
 * one in any case — but "could not" there is a property of the *other*
 * transaction, and a public read is precisely the transaction that must not
 * depend on one.
 *
 * `olibra.now` is cleared for the same reason and to the same effect: there is
 * no `TenantContext` here and therefore no injected clock, so `olibra_now()`
 * falls back to the database's `now()` (`20260808_14_olibra_now.sql` —
 * `nullif(..., '')` then `coalesce`, so an empty value is the documented
 * fallback and never an error). Nothing public reads a clock-dependent view
 * today; a query that grows one would be reading real time, which is the
 * honest answer for a caller who has no clock to inject.
 *
 * The query receives no `ctx` — there is nothing truthful to put in one. That
 * is the signature carrying the meaning: a read that took a `TenantContext`
 * and ignored it would look like every other query in the codebase while
 * behaving unlike any of them.
 */
export async function runPublicQuery<O>(
  sql: Sql,
  query: (tx: Tx) => Promise<O>,
): Promise<O> {
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', '', true)`;
    await tx`select set_config('olibra.now', '', true)`;
    await tx`set local role olibra_public`;
    return query(guardWrites(tx as RawTx));
  }) as Promise<O>;
}

/**
 * Refuses a caller who is not a `super_admin`, **in the kernel**, before either
 * admin runner below opens a transaction.
 *
 * Every other runner in this file leaves the role check to the query or command
 * it runs — `requireManager`, `requireReader`, `requireSuperAdmin` all live in
 * the domain, and `loadPage`'s docstring gives the reason: permission is a
 * domain decision and the page must not become the security control. That
 * division works because forgetting it is *bounded*. A query under `runQuery`
 * that forgets `requireManager` leaks a manager's view of one shelf to a reader
 * of that shelf; RLS is still underneath, and INV-10 still holds.
 *
 * The two functions below have no such floor. They run as `olibra_admin`, which
 * holds `bypassrls`, so the thing that would have caught the mistake is exactly
 * the thing they turn off. A query that forgot its check would hand a reader of
 * one parish every other parish's records — the failure INV-10 is named for.
 *
 * So the check also lives where it cannot be forgotten. The queries under
 * `src/domain/admin/` call `requireSuperAdmin` as well, and the two are not
 * redundant — they answer different questions:
 *
 * - **Here**: no *runner* may reach `olibra_admin` for a caller who is not one.
 *   This is what protects a query somebody adds next month and forgets to guard.
 * - **In the query**: the query is safe whichever runner reaches it. An admin
 *   query invoked through `runQuery` — by a page, by a test, by a later author
 *   who copied the wrong seam — gets no bypass from the kernel check, because
 *   the kernel check is on a code path it did not take.
 *
 * Two copies of an authorisation rule is normally how one of them drifts. It is
 * not a hazard here because neither is a *rule*: both are the same single floor,
 * `super_admin`, the top of `ROLE_RANK` with nothing above it to drift toward.
 *
 * `atLeast` from `./tenant`, not `requireSuperAdmin` from `../members/policy`:
 * `tests/architecture/boundaries.test.ts` keeps the kernel from importing its
 * own domains, and `super_admin` is the top of `ROLE_RANK`, which is a kernel
 * property already.
 *
 */
function requireSuperAdminActor(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "super_admin")) {
    throw new RuleViolated("not_permitted");
  }
}

/**
 * Runs a **cross-shelf** read as `olibra_admin`, in a read-only transaction
 * with the tenant scope deliberately empty.
 *
 * This is the escalation `runPublicQuery`'s docstring contrasts itself against,
 * and it is the read counterpart of `runGlobalCommand`. Everything that
 * docstring says about staying rare applies here word for word: a diff
 * introducing a call to it is worth a second look, and the reason it exists at
 * all is that OPS §2 (`OPERATIONS.md:25`) names the cross-shelf administration
 * views as one of INV-10's three enumerated exceptions, alongside the portal
 * directory and promote-to-super-admin.
 *
 * **What it is for, precisely.** OPS §3.4 lists ten queries whose whole content
 * is "every shelf at once" — `GetAdminOverview` is one row per shelf,
 * `GetFeedbackInbox` spans every parish's messages plus the site-wide ones,
 * `GetManagersList` is every manager across every shelf. None of them can be
 * expressed under `runQuery`: its scope is one shelf by construction, and a
 * caller that looped over shelves would be doing the same bypass one
 * transaction at a time, with no single place to check the role.
 *
 * **The role check is in `requireSuperAdminActor` above *as well as* in each
 * query**, and that function's docstring is where the argument for both lives.
 *
 * **The scope is empty, and every query here must therefore name its own
 * shelf filter.** `set_config('olibra.bookshelf_id', '')` is the same sentinel
 * `runPublicQuery` uses, so a query that *did* rely on RLS would see nothing
 * rather than everything — an empty page rather than a leak, if `olibra_admin`
 * did not bypass. It does bypass, so the sentinel proves nothing on its own; it
 * is written explicitly so this transaction's scope is a fact of this function
 * rather than of whatever ran on the pooled connection before it.
 *
 * **`olibra.now` is set from `ctx.clock`, unlike `runPublicQuery`.** There is a
 * `TenantContext` here and therefore a real injected clock, and the admin views
 * are exactly the ones that count overdue loans across every shelf — a figure
 * `loans_current` computes from `olibra_now()`. A cross-shelf overdue count
 * that ignored the injected clock would be the one number on the administrator's
 * dashboard no test could move.
 */
export async function runAdminQuery<O>(
  sql: Sql,
  ctx: TenantContext,
  query: (tx: Tx, ctx: TenantContext) => Promise<O>,
): Promise<O> {
  requireSuperAdminActor(ctx);
  const nowIso = assertValidClockInstant(ctx.clock);
  return sql.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`select set_config('olibra.bookshelf_id', '', true)`;
    await tx`select set_config('olibra.now', ${nowIso}, true)`;
    await tx`set local role olibra_admin`;
    return query(guardWrites(tx as RawTx), ctx);
  }) as Promise<O>;
}

/**
 * Runs a **cross-shelf** command as `olibra_admin` — body and audit insert
 * alike — for the handful of operations OPS §4.5 gives exclusively to
 * `super_admin`.
 *
 * **This is a wider escalation than `runGlobalCommand`, and the difference is
 * the point.** `runGlobalCommand` runs the command *body* as `olibra_app` and
 * escalates only the audit insert; `runAs`'s docstring records why (an earlier
 * version escalated the whole transaction, and a command run through it could
 * write a book into another shelf). That split works because every command it
 * serves acts within one shelf and only its audit row belongs to none.
 *
 * The commands here are the opposite case. `CreateBookshelf` inserts the row
 * that *makes* a shelf, and `20260808_08_revoke_bookshelves_insert_from_app.sql`
 * revoked that insert from `olibra_app` outright, deliberately, so it is
 * unavailable under any scoping. `AssignManager` writes a `memberships` row for
 * a shelf the caller holds no membership of. `UpdateBookshelfSettings` edits a
 * shelf named by the URL rather than by the session. Each of them is
 * "act on a shelf that is not mine", which is what INV-10 forbids and what OPS
 * §2 exempts this surface from by name.
 *
 * So the body runs escalated, and the compensating control is that
 * `requireSuperAdminActor` (above) refuses before `sql.begin` — no transaction
 * opens at all for a caller who is not a super_admin.
 *
 * **`ctx.bookshelfId` may be empty here, and what that means is checked rather
 * than assumed.** `runAs` rejects an empty shelf on the write path because its
 * audit insert binds `bookshelfId` straight into a `uuid` column. That hazard is
 * the same here and the situation is not: a genuinely global command
 * (`UpdateSystemDefaults`, `PromoteSuperAdmin`) has no shelf to name, and its
 * entry sets `global: true`, which `toRow` turns into a null `bookshelf_id`. So
 * an empty scope is allowed, and each *entry* is then checked after `toRow` has
 * decided: a non-global entry under an empty scope would bind `''` into that
 * `uuid` column and raise a raw `PostgresError` from inside the transaction —
 * the exact shape, in the exact place, `assertValidBookshelfId` exists to
 * prevent. It becomes a named `ValidationFailed` instead.
 *
 * A *non*-empty `ctx.bookshelfId` is validated as a uuid exactly as everywhere
 * else, so an admin command acting on one named shelf writes an ordinary
 * shelf-scoped audit row that the shelf's own manager can read.
 */
export async function runAdminCommand<I, O>(
  sql: Sql,
  ctx: TenantContext,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  requireSuperAdminActor(ctx);
  assertValidBookshelfId(ctx.bookshelfId, { allowEmpty: true });
  const nowIso = assertValidClockInstant(ctx.clock);
  return sql.begin(async (tx) => {
    await setSessionScope(tx as RawTx, ctx, nowIso);
    await tx`set local role olibra_admin`;

    const { result, audit } = await command(guardWrites(tx as RawTx), ctx, input);

    for (const entry of Array.isArray(audit) ? audit : [audit]) {
      const row = toRow(entry, ctx);
      // The check this runner adds over `runAs`: an entry that names a shelf,
      // written under a context that has none. See the docstring above.
      if (row.bookshelfId === "") {
        throw new ValidationFailed("invalid_bookshelf_id", "bookshelfId");
      }
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
