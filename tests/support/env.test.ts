import { afterEach, expect, test } from "vitest";
import { testDatabaseUrl, testPoolDatabaseUrl, testS3Config } from "./env";

const saved = process.env.TEST_DATABASE_URL;
const savedPool = process.env.TEST_POOL_DATABASE_URL;

/**
 * The storage guards are new; `testDatabaseUrl` and `testPoolDatabaseUrl` had
 * three dedicated cases each and `testS3Config` had none. That mattered:
 * replacing its `if (!bucket.includes("test"))` with `if (false)` left the whole
 * suite green, so the guard the plan's §4.5 argued for was documentation.
 */
const savedS3 = new Map(
  [
    "TEST_S3_BUCKET",
    "TEST_S3_ENDPOINT",
    "TEST_S3_ALLOW_REMOTE_ENDPOINT",
    "TEST_S3_PUBLIC_URL",
  ].map((name) => [name, process.env[name]]),
);

afterEach(() => {
  process.env.TEST_DATABASE_URL = saved;
  process.env.TEST_POOL_DATABASE_URL = savedPool;
  // `fileParallelism: false` shares one worker across files, so anything left
  // set here is inherited by every file that runs after this one.
  for (const [name, value] of savedS3) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("refuses a URL that is not the test database", () => {
  // The mistake this exists to make impossible: the suite truncates every
  // table, so a URL pointing at the development database would quietly delete
  // whatever was being worked on.
  process.env.TEST_DATABASE_URL = "postgres://olibra:x@localhost:5435/olibra";
  expect(() => testDatabaseUrl()).toThrow(/must name the olibra_test database/);
});

test("says how to fix it when nothing is set", () => {
  delete process.env.TEST_DATABASE_URL;
  expect(() => testDatabaseUrl()).toThrow(/docker compose --profile test/);
});

test("returns the URL when it names the test database", () => {
  expect(testDatabaseUrl()).toContain("olibra_test");
});

test("testPoolDatabaseUrl refuses a URL that is not the test database", () => {
  process.env.TEST_POOL_DATABASE_URL =
    "postgres://olibra_pool:x@localhost:5435/olibra";
  expect(() => testPoolDatabaseUrl()).toThrow(/must name the olibra_test database/);
});

test("testPoolDatabaseUrl refuses a URL that does not authenticate as olibra_pool", () => {
  // CRITICAL 2: this handle exists specifically to be provably not the
  // bypassrls superuser — a URL that quietly names `olibra` instead would
  // defeat the entire point of the test that uses it.
  process.env.TEST_POOL_DATABASE_URL =
    "postgres://olibra:x@localhost:5436/olibra_test";
  expect(() => testPoolDatabaseUrl()).toThrow(/must authenticate as olibra_pool/);
});

test("testPoolDatabaseUrl says how to fix it when nothing is set", () => {
  delete process.env.TEST_POOL_DATABASE_URL;
  expect(() => testPoolDatabaseUrl()).toThrow(/TEST_POOL_DATABASE_URL is not set/);
});

test("testPoolDatabaseUrl returns the URL when it names the test database as olibra_pool", () => {
  process.env.TEST_POOL_DATABASE_URL =
    "postgres://olibra_pool:x@localhost:5436/olibra_test";
  expect(testPoolDatabaseUrl()).toContain("olibra_test");
});

// ── testS3Config: the bucket ─────────────────────────────────────────────────

test.each([
  ["the development bucket", "olibra"],
  ["a name that merely contains the letters", "prod-testimonials"],
  ["a name that merely ends with them", "latest"],
  ["covers in production", "olibra-covers"],
])("testS3Config refuses %s", (_label, bucket) => {
  // The same mistake `testDatabaseUrl` exists to make impossible, one layer
  // down. The suite deletes objects out of this bucket, so pointing it at the
  // development one destroys the covers and avatars somebody was working with.
  //
  // `prod-testimonials` is here because the guard used `includes("test")` and
  // passed it. That is not a contrived name.
  process.env.TEST_S3_BUCKET = bucket;
  expect(() => testS3Config()).toThrow(/must name a test bucket/);
});

test("testS3Config says how to fix it when the bucket is not set", () => {
  delete process.env.TEST_S3_BUCKET;
  expect(() => testS3Config()).toThrow(/docker compose up -d storage/);
});

test.each([["olibra-test"], ["test-olibra"], ["test"], ["a-test-b"]])(
  "testS3Config accepts the bucket %j",
  (bucket) => {
    process.env.TEST_S3_BUCKET = bucket;
    expect(testS3Config().bucket).toBe(bucket);
  },
);

// ── testS3Config: the endpoint ───────────────────────────────────────────────

test.each([
  ["a hostname on the internet", "https://s3.ap-southeast-1.amazonaws.com"],
  ["a colleague's machine", "http://192.168.1.40:9000"],
  ["a staging host", "https://storage.example.org"],
])("testS3Config refuses an endpoint naming %s", (_label, endpoint) => {
  // Sharper than the bucket guard, because the failure is worse. `beforeAll` in
  // tests/storage/s3.test.ts applies a policy that makes the bucket readable by
  // anyone on the internet, unconditionally, against whatever this names —
  // so a mistyped endpoint does not merely delete objects, it publishes
  // somebody else's bucket, and no backup undoes that.
  process.env.TEST_S3_ENDPOINT = endpoint;
  expect(() => testS3Config()).toThrow(/must be a loopback address/);
});

test.each([
  ["http://localhost:9000"],
  ["http://127.0.0.1:9000"],
  ["http://[::1]:9000"],
])("testS3Config accepts the loopback endpoint %j", (endpoint) => {
  process.env.TEST_S3_ENDPOINT = endpoint;
  expect(testS3Config().endpoint).toBe(endpoint);
});

test("testS3Config's remote opt-in has to repeat the host exactly", () => {
  // A boolean opt-in would bless every later typo once set. Repeating the host
  // means the opt-in stops applying the moment the endpoint changes — which is
  // the only moment it matters.
  process.env.TEST_S3_ENDPOINT = "https://storage.example.org";

  process.env.TEST_S3_ALLOW_REMOTE_ENDPOINT = "true";
  expect(() => testS3Config()).toThrow(/must be a loopback address/);

  process.env.TEST_S3_ALLOW_REMOTE_ENDPOINT = "storage.example.com"; // .com
  expect(() => testS3Config()).toThrow(/must be a loopback address/);

  process.env.TEST_S3_ALLOW_REMOTE_ENDPOINT = "storage.example.org";
  expect(testS3Config().endpoint).toBe("https://storage.example.org");
});

test("testS3Config refuses an endpoint with no scheme", () => {
  // `new URL("localhost:9000")` parses — "localhost" is a syntactically valid
  // scheme — and its hostname is empty, so a check that only looked at the
  // hostname would reject it for the wrong reason and with the wrong advice.
  process.env.TEST_S3_ENDPOINT = "localhost:9000";
  expect(() => testS3Config()).toThrow(/absolute URL including the scheme/);
});

test("testS3Config runs the result through the application's own validation", () => {
  // The suite must not be able to run against a configuration the application
  // would refuse to start on — otherwise `bun run check` is green on a shape
  // production rejects, which is the ordering the storage module argues against
  // throughout.
  process.env.TEST_S3_PUBLIC_URL = "cdn.example.org";
  expect(() => testS3Config()).toThrow(/S3_PUBLIC_URL must be an absolute URL/);
});
