import { validateS3Config, type S3Config } from "../../src/storage/s3";

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
 * A bucket name with `test` as a delimited word: `olibra-test`, `test-bucket`,
 * `test`. Not `prod-testimonials`.
 *
 * The guard below used `includes("test")`, which passes `prod-testimonials` and
 * `latest-covers` — names a real deployment could plausibly have. A delimiter
 * on each side is the smallest change that stops that without becoming a puzzle
 * to read.
 *
 * The hyphen is the only delimiter, because it is the only one a bucket name
 * can contain: `validateS3Config()` refuses underscores and dots outright, the
 * latter because a dotted name breaks TLS in virtual-hosted addressing. Listing
 * delimiters this name can never have would only suggest they were allowed.
 */
const TEST_BUCKET_PATTERN = /(?:^|-)test(?:-|$)/;

/** Hosts a suite that opens a bucket to the world may point at. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Where the suite's object storage lives, and the same guards for the same
 * reason `testDatabaseUrl` above carries one.
 *
 * The storage tests **delete objects**. That is the identical hazard the
 * database guard exists for — a one-character slip in a bucket name, pointed
 * at the development bucket, and the covers and avatars somebody was working
 * with are gone.
 *
 * They do something worse than delete, though, and the bucket guard alone did
 * not cover it: `beforeAll` in `tests/storage/s3.test.ts` makes the bucket
 * **world-readable**, unconditionally, against whatever `TEST_S3_ENDPOINT`
 * happens to name. `TEST_DATABASE_URL` must name `olibra_test`; the endpoint
 * was checked for nothing at all. A mistyped or pasted-in endpoint therefore
 * did not merely destroy objects — it published somebody else's bucket to the
 * internet, which is not a mistake that can be undone by restoring a backup.
 *
 * So the endpoint must be loopback. The escape hatch is `TEST_S3_ENDPOINT`'s
 * own host name spelled again in `TEST_S3_ALLOW_REMOTE_ENDPOINT`, rather than a
 * boolean: a boolean opt-in, once set, blesses every later typo, whereas
 * repeating the host means a typo in the endpoint no longer matches the thing
 * that was opted into. It is documented in `.env.example` as a commented line
 * on purpose — an uncommented one would make
 * `tests/architecture/ci-supplies-required-env.test.ts` demand it in the
 * workflow, and CI's MinIO is on localhost like everyone else's.
 *
 * These are seven `TEST_S3_*` variables mirroring the seven `S3_*` ones rather
 * than a reuse of `s3ConfigFromEnv()` with the bucket swapped, and the reason
 * is CI rather than tidiness. `tests/architecture/ci-supplies-required-env.test.ts`
 * guards every `TEST_`-prefixed variable `.env.example` documents; a config
 * that borrowed `S3_ENDPOINT` and friends would need six unguarded variables
 * present in the workflow, which is precisely the failure that turned `main`
 * red for three merges when `TEST_POOL_DATABASE_URL` shipped without them.
 *
 * The result goes through `validateS3Config()`, the same function
 * `s3ConfigFromEnv()` uses, so the suite cannot run against a configuration the
 * application would refuse to start on.
 */
export function testS3Config(): S3Config {
  const bucket = requireTestVar("TEST_S3_BUCKET");
  if (!TEST_BUCKET_PATTERN.test(bucket)) {
    throw new Error(
      `TEST_S3_BUCKET must name a test bucket — "test" has to appear as a ` +
        `whole word, delimited by a hyphen or the ends of the name (e.g. ` +
        `"olibra-test"), because the suite deletes objects out of it and ` +
        `makes it world-readable. Got: ${bucket}`,
    );
  }

  return validateS3Config({
    endpoint: requireLocalEndpoint(requireTestVar("TEST_S3_ENDPOINT")),
    region: requireTestVar("TEST_S3_REGION"),
    bucket,
    accessKeyId: requireTestVar("TEST_S3_ACCESS_KEY_ID"),
    secretAccessKey: requireTestVar("TEST_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: requireTestVar("TEST_S3_FORCE_PATH_STYLE") === "true",
    publicUrl: requireTestVar("TEST_S3_PUBLIC_URL"),
  });
}

function requireLocalEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(
      `TEST_S3_ENDPOINT must be an absolute URL including the scheme, e.g. ` +
        `"http://localhost:9000". Got: ${endpoint}`,
    );
  }

  // `new URL("localhost:9000")` parses — "localhost" is a syntactically valid
  // scheme — and yields an *empty* hostname. Without this check the loopback
  // test below would reject it, correctly but for the wrong reason and with
  // advice ("set TEST_S3_ALLOW_REMOTE_ENDPOINT=") that names no host.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `TEST_S3_ENDPOINT must be an absolute URL including the scheme, e.g. ` +
        `"http://localhost:9000" — "${endpoint}" parses as a URL whose scheme ` +
        `is ${JSON.stringify(url.protocol)}, which is not what was meant.`,
    );
  }

  // `new URL()` brackets an IPv6 host; the opt-in variable is written without
  // them, and so is every error message anyone reads.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(host)) return endpoint;

  const allowed = process.env.TEST_S3_ALLOW_REMOTE_ENDPOINT?.trim();
  if (allowed !== undefined && allowed !== "" && allowed === host) {
    return endpoint;
  }

  throw new Error(
    `TEST_S3_ENDPOINT must be a loopback address (${[...LOOPBACK_HOSTS].join(
      ", ",
    )}), got the host ${JSON.stringify(host)}. The storage suite deletes ` +
      `objects and applies a policy that makes the bucket readable by anyone ` +
      `on the internet, so a mistyped endpoint does not merely lose data — it ` +
      `publishes somebody else's bucket. If this host really is a throwaway ` +
      `object store, set TEST_S3_ALLOW_REMOTE_ENDPOINT=${host} to say so; it ` +
      `has to repeat the host exactly, so that the next typo is refused too.`,
  );
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
