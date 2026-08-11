/**
 * The application's startup hook — a `node`-layer warm-up, not the wiring
 * itself.
 *
 * This used to be the one place `src/domain/members/registration.ts`'s
 * injected setters were actually set, on the theory that `register()` runs
 * once per server process, before any request, which is what a composition
 * root has to be. **It was not**, and the reason is Turbopack layering rather
 * than anything wrong with that reasoning in isolation: Next builds this file
 * into the `node` layer and every server action into the `react-server`
 * layer, and a module imported by both — `src/domain/kernel/crypto.ts`
 * (formerly the setters living directly in `registration.ts`) — is bundled
 * into both, as two separate instances with two separate copies of every
 * module-level binding. Calling `setPasswordHasher` here wired only the
 * `node` layer's copy; `registerMembershipAction` ran in the `react-server`
 * layer's copy, which stayed at its throwing default for the life of the
 * process. Confirmed live by a QA sweep on 10/08/2026: this file's own
 * startup log reported the hasher wired while `POST /dang-ky` 500'd for
 * every reader who supplied a username and password, `NotWired` all the way
 * up the stack from `hasher` in `registration.ts`.
 *
 * **The fix is `src/lib/page-data.ts`.** Its four entry points —
 * `loadPage`, `loadPublicPage`, `submitCommand`, `submitAdminCommand` — each
 * call `ensureCryptoWired()` as their first statement, which is what
 * guarantees the request path: whichever layer's copy of `crypto.ts` a given
 * request actually runs in, that copy wires itself on its own first call,
 * rather than depending on a different layer having already done it.
 *
 * This file still calls the same function, belt-and-braces: it warms the
 * `node` layer before the first request arrives, which is a real (if small)
 * saving of one `import()` on a cold start, and it is harmless — the port
 * being wired earlier via this function does not stop `page-data.ts` also
 * getting to check the idempotent flag on `wired` the way it does for every
 * other request. It is no longer the mechanism the request path depends on
 * being correct.
 *
 * **Why a gap here goes unnoticed for so long in the product** — this bug
 * and the one before it (`grep -rn setPasswordHasher src` once returned
 * three comments *about* wiring and no call at all) — is recorded in
 * `src/domain/kernel/crypto.ts`'s own docstring, not repeated here: in
 * short, registration without credentials never reaches `hashFor`, and
 * sign-in verifies through `src/auth/session.ts` directly rather than
 * through this port, so the one path that ever needed it wired was
 * "somebody types a password" — the path nobody had tried.
 *
 * The `nodejs` guard is Next's documented shape: this file is also loaded in
 * the edge runtime, where `@node-rs/argon2` is a native addon that cannot
 * load. No route in this application runs on edge, so the guard is about the
 * bundler rather than about behaviour.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  checkDatabaseUrlsForSwallowedComments();

  const { ensureCryptoWired } = await import("./lib/crypto-wiring");
  await ensureCryptoWired();
}

/**
 * QA remediation Task 26. `.env.example` used to write `POSTGRES_PASSWORD`
 * and five other credentials with an inline comment trailing the `=` on the
 * same line — `POSTGRES_PASSWORD=          # required, no default — compose
 * refuses to start without it`. Compose keeps everything after `=` in a
 * `.env` file, comment included, so that line's actual value was the
 * sentence itself. Confirmed live: `docker inspect olibra-db-1` reported
 * `POSTGRES_PASSWORD=# required, no default — compose refuses to start
 * without it`, and Postgres had already started and accepted it as the
 * superuser's real password.
 *
 * `.env.example` no longer has that shape (every inline comment now sits on
 * its own line above its variable, and `tests/architecture/env-example-has-
 * no-inline-comments.test.ts` guards the file against a regression). This
 * check is the other half: a developer who hit the bug *before* that fix,
 * and "fixed" `DATABASE_URL` or `MIGRATION_DATABASE_URL` by hand by pasting
 * in whatever `docker inspect` reported for the swallowed-comment password,
 * would carry the defect forward into a URL the file-level test cannot see,
 * because it only reads `.env.example` and this password lives in `.env` or
 * the process environment. Left uncaught, `postgres.js` would refuse the
 * connection with a bare authentication failure — U1 §3.3's "a fault
 * rendered as a friendly Vietnamese sentence tells a volunteer their input
 * was wrong when the database was down" runs in the other direction here: a
 * *developer* facing a raw driver error has no reason to suspect an `.env`
 * file three layers away, which is exactly the "why does `bun run
 * db:migrate` fail from the host" confusion this task's brief was opened to
 * explain.
 *
 * **The signal, not a URL parser.** A password that starts with a literal
 * `#`, or that contains `%23` (the percent-encoded form) anywhere, is not a
 * password anybody would choose or Postgres would generate — the only
 * plausible way either character lands in a connection string's password
 * field is a comment that leaked into it, encoded or not. Checking for that
 * shape is cheap (a handful of string operations, no regular expression
 * pathological enough to matter, no network I/O) and unambiguous: it cannot
 * misfire on an unrelated malformed URL, because it only *looks* at the
 * password once one is found, and it never runs at all for a URL with no
 * userinfo section.
 *
 * Checked here rather than in `src/db/client.ts`: this runs once, at process
 * start, before the first request or the first pool connection — a fault a
 * developer sees in `next dev`'s own startup log, not one buried inside the
 * first page render's stack trace.
 *
 * Exported, alongside `passwordLooksLikeASwallowedComment` below, for
 * `tests/instrumentation.test.ts` — the falsification evidence for both:
 * `register()` itself is not a unit a test can call cheaply (it imports and
 * wires the password hasher as a side effect), so the test drives this
 * function directly, mutating `process.env` around each case rather than
 * spawning a process to observe a startup crash.
 */
export function checkDatabaseUrlsForSwallowedComments(): void {
  for (const name of ["DATABASE_URL", "MIGRATION_DATABASE_URL"] as const) {
    const value = process.env[name];
    if (!value) continue;
    if (passwordLooksLikeASwallowedComment(value)) {
      throw new Error(
        "Có vẻ mật khẩu trong .env đang là dòng chú thích — xem .env.example. " +
          `(${name} là biến bị ảnh hưởng.)`,
      );
    }
  }
}

/**
 * Whether `url`'s own password segment starts with `#` or contains `%23` —
 * see `checkDatabaseUrlsForSwallowedComments` above for why either is an
 * unambiguous signal rather than a guess.
 *
 * Exported for `tests/instrumentation.test.ts` — see
 * `checkDatabaseUrlsForSwallowedComments` above for the fuller note on why
 * these two functions, and not `register()` itself, are what the test calls.
 *
 * `.trim()` before the `#` check, not on the raw password: compose trims the
 * leading whitespace `.env.example`'s own multiple spaces before `#` carried
 * — the live `docker inspect olibra-db-1` output this whole task is written
 * against reports `POSTGRES_PASSWORD=# required, no default…`, no leading
 * spaces — but a password pasted by hand from the raw `.env.example` text,
 * whitespace and all, is exactly as much the defect and must not slip past a
 * check that only compared against compose's already-trimmed shape.
 */
export function passwordLooksLikeASwallowedComment(url: string): boolean {
  const password = connectionStringPassword(url);
  if (password === null) return false;
  return password.trim().startsWith("#") || password.includes("%23");
}

/**
 * The password segment of a `scheme://user:password@host/…` connection
 * string, or `null` when the string carries no userinfo to read one from.
 *
 * Deliberately not `new URL(url)`: a password that begins with an unencoded
 * `#` is exactly the defect this file exists to catch, and `#` is the
 * fragment delimiter in the URL standard — parsing a string carrying the live
 * defect through a spec-compliant parser is precisely the case most likely to
 * throw or to silently truncate the very password this function needs to
 * see. Three string operations instead: the last `@` before the authority
 * ends splits userinfo from host (a password containing `@` unencoded would
 * defeat this, and is out of scope for the same "cheap, not a parser" reason
 * every other architecture check in this codebase accepts for itself), and
 * the first `:` inside that userinfo splits user from password.
 */
function connectionStringPassword(url: string): string | null {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return null;

  const afterScheme = url.slice(schemeEnd + 3);
  const at = afterScheme.lastIndexOf("@");
  if (at === -1) return null;

  const userinfo = afterScheme.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon === -1) return null;

  return userinfo.slice(colon + 1);
}
