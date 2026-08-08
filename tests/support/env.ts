/**
 * Where the suite's database lives, and the one guard worth having here.
 *
 * The suite truncates every table between tests. Pointing it at the
 * development database — a one-character slip in a URL — would silently
 * destroy whatever was being worked on. So the URL must name `olibra_test`,
 * and anything else is refused before a connection is opened.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test database with:\n" +
        "  docker compose --profile test up -d db-test\n" +
        "and copy .env.example to .env",
    );
  }
  if (!url.includes("olibra_test")) {
    throw new Error(
      `TEST_DATABASE_URL must name the olibra_test database, got: ${url}`,
    );
  }
  return url;
}

/**
 * The same test database, authenticated as `olibra_pool` instead of the
 * `olibra` superuser `testDatabaseUrl` above connects as.
 *
 * CRITICAL 2's acceptance test needs a connection that is provably not a
 * superuser to run the guard path (`signIn`, `contextFor`, ...) through —
 * `tests/support/db.ts`'s shared `sql` handle cannot become that connection
 * itself, because it also does setup and truncation
 * (`RESET_EXCLUDED_TABLES`'s own comment), which a non-superuser role
 * genuinely granted only `olibra_app`/`olibra_admin` membership cannot do
 * (no privilege to truncate arbitrary tables, no bypass of `bookshelves`'
 * revoked `insert` grant, etc.) — failures unrelated to whatever the test
 * using this second handle is actually checking. This is that second
 * handle's URL.
 */
export function testPoolDatabaseUrl(): string {
  const url = process.env.TEST_POOL_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_POOL_DATABASE_URL is not set. It must authenticate as " +
        "olibra_pool (20260808_13_pool_role.sql) against the same database " +
        "TEST_DATABASE_URL names — see .env.example.",
    );
  }
  if (!url.includes("olibra_test")) {
    throw new Error(
      `TEST_POOL_DATABASE_URL must name the olibra_test database, got: ${url}`,
    );
  }
  if (!url.includes("olibra_pool")) {
    throw new Error(
      `TEST_POOL_DATABASE_URL must authenticate as olibra_pool, not the ` +
        `superuser — a superuser bypasses RLS regardless of which role it ` +
        `then sets, which is the exact trap CRITICAL 2 exists to catch. Got: ${url}`,
    );
  }
  return url;
}
