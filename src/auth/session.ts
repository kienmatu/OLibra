import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "postgres";
import type { Clock } from "../domain/kernel/clock";
import { RuleViolated } from "../domain/kernel/errors";
import { verifyPassword } from "./password";

const SESSION_DAYS = 30;

/**
 * Runs `fn` against a fresh transaction, explicitly switched to `olibra_app`.
 *
 * `users` and `sessions` carry no RLS policy (both are global — DATABASE.md
 * §3's "Global tables" note, extended to `sessions` in Task 2), so this
 * needs no `set_config('olibra.bookshelf_id', ...)` the way `runCommand`/
 * `runQuery` do (`unit-of-work.ts`). The role switch is still explicit and
 * still happens on every call, for the same reason it is explicit there:
 * this only works at all once the connection pool's own role is a genuine
 * non-superuser granted membership in `olibra_app` (Task 4) — relying
 * instead on that role *inheriting* the grant without ever naming it here
 * would make every query in this file quietly depend on a `GRANT`'s
 * `INHERIT` flag nobody re-checks, rather than on a switch a reviewer sees
 * at the call site the same way every other privileged query in this
 * codebase already reads.
 */
async function asApp<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role olibra_app`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

/**
 * Tokens are stored hashed, for the same reason passwords are: a leaked
 * backup should not be a stack of usable sessions. SHA-256 rather than Argon2
 * because the token is 256 bits of randomness — there is nothing to brute
 * force, and this runs on every request.
 */
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function signIn(
  sql: Sql,
  input: {
    username: string;
    password: string;
    clock: Clock;
    // M8: DATABASE.md §4.1 promises these columns make "who signed in from
    // where" answerable. Optional, and defaulted to null below, because not
    // every caller of signIn runs inside a request with headers to read —
    // tests, a future CLI-driven sign-in — and a caller with nothing to
    // report should not have to fabricate a value.
    userAgent?: string | null;
    ipAddress?: string | null;
  },
): Promise<{ token: string; userId: string }> {
  return asApp(sql, async (tx) => {
    const [user] = await tx<{ id: string; password_hash: string | null }[]>`
      select id, password_hash from users
      where lower(username) = lower(${input.username})
        and deleted_at is null
    `;

    // INV-14: an account with no credentials is a valid state (BR §2) and
    // simply cannot sign in. Verify against a dummy hash anyway so a missing
    // account and a wrong password take the same time to fail.
    const stored = user?.password_hash ?? null;
    const ok = stored
      ? await verifyPassword(input.password, stored)
      : (await verifyPassword(
          input.password,
          "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$0000000000000000000000000000000000000000000",
        ),
        false);

    // IMPORTANT 3: `sign_in_failed`, not `not_authenticated` — that code's
    // Vietnamese sentence is "you need to sign in to continue", the wrong
    // thing to tell someone who just tried and failed. One code covers a
    // wrong password, an unknown username and an account with no
    // credentials at all (INV-14) alike, deliberately: distinguishing them
    // in the response would tell a caller which accounts exist.
    if (!user || !ok) throw new RuleViolated("sign_in_failed");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      input.clock.now().getTime() + SESSION_DAYS * 86_400_000,
    );

    await tx`
      insert into sessions (token_hash, user_id, expires_at, user_agent, ip_address)
      values (
        ${hashToken(token)}, ${user.id}, ${expiresAt},
        ${input.userAgent ?? null}, ${input.ipAddress ?? null}
      )
    `;

    return { token, userId: user.id };
  });
}

export async function resolveSession(
  sql: Sql,
  token: string,
  clock: Clock,
): Promise<{ userId: string } | null> {
  return asApp(sql, async (tx) => {
    // CRITICAL 1: a session row surviving its owner does not mean the owner
    // may still act. Deleting a user (safeguarding, a merged duplicate
    // account, a manager's mistake undone) must sign them out in substance,
    // not merely stop `signIn` from issuing a *new* token — an existing one
    // must stop resolving too, on the very next request, not up to
    // SESSION_DAYS later when it happens to expire.
    const [row] = await tx<{ user_id: string }[]>`
      select s.user_id from sessions s
      join users u on u.id = s.user_id
      where s.token_hash = ${hashToken(token)}
        and s.expires_at > ${clock.now()}
        and u.deleted_at is null
    `;
    return row ? { userId: row.user_id } : null;
  });
}

export async function signOut(sql: Sql, token: string): Promise<void> {
  await asApp(
    sql,
    (tx) => tx`delete from sessions where token_hash = ${hashToken(token)}`,
  );
}

/**
 * Ends every session for a person.
 *
 * Called when a manager sets a reader's credentials (BR §2). The design leans
 * on that power being visible rather than restricted; it must also not leave
 * an old session alive after the credentials behind it changed.
 */
export async function revokeAllSessions(sql: Sql, userId: string): Promise<void> {
  await asApp(sql, (tx) => tx`delete from sessions where user_id = ${userId}`);
}
