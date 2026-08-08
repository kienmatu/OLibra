import type { S3Config } from "../../src/storage/s3";

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
 * Where the suite's object storage lives, and the same guard for the same
 * reason `testDatabaseUrl` above carries one.
 *
 * The storage tests **delete objects**. That is the identical hazard the
 * database guard exists for — a one-character slip in a bucket name, pointed
 * at the development bucket, and the covers and avatars somebody was working
 * with are gone. So `TEST_S3_BUCKET` must contain `test`, checked before a
 * client is constructed.
 *
 * These are seven `TEST_S3_*` variables mirroring the seven `S3_*` ones rather
 * than a reuse of `s3ConfigFromEnv()` with the bucket swapped, and the reason
 * is CI rather than tidiness. `tests/architecture/ci-supplies-required-env.test.ts`
 * guards every `TEST_`-prefixed variable `.env.example` documents; a config
 * that borrowed `S3_ENDPOINT` and friends would need six unguarded variables
 * present in the workflow, which is precisely the failure that turned `main`
 * red for three merges when `TEST_POOL_DATABASE_URL` shipped without them.
 */
export function testS3Config(): S3Config {
  const bucket = requireTestVar("TEST_S3_BUCKET");
  if (!bucket.includes("test")) {
    throw new Error(
      `TEST_S3_BUCKET must name a test bucket — its name has to contain ` +
        `"test", because the suite deletes objects out of it. Got: ${bucket}`,
    );
  }

  return {
    endpoint: requireTestVar("TEST_S3_ENDPOINT"),
    region: requireTestVar("TEST_S3_REGION"),
    bucket,
    accessKeyId: requireTestVar("TEST_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireTestVar("TEST_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: requireTestVar("TEST_S3_FORCE_PATH_STYLE") === "true",
    publicUrl: requireTestVar("TEST_S3_PUBLIC_URL"),
  };
}

function requireTestVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Start the object store with:\n` +
        "  docker compose up -d storage\n" +
        "and copy .env.example to .env — the storage suite needs all seven " +
        "TEST_S3_* variables.",
    );
  }
  return value.trim();
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
