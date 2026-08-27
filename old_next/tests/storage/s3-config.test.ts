import { afterEach, expect, test } from "vitest";
import {
  flag,
  required,
  s3ConfigFromEnv,
  validateS3Config,
  type S3Config,
} from "../../src/storage/s3";

/**
 * Configuration, without a MinIO.
 *
 * These three functions carried the most emphatic protection claims in
 * `src/storage/s3.ts` — `flag()`'s comment says it "refuses anything but `true`
 * or `false`" because the alternative is "the worst available ordering for
 * finding out" — and not one of them had a test. A reviewer replaced `flag`'s
 * body with `return false` and the whole suite stayed green; the same for
 * `required`. The protection was real in the code and guarded by nothing, which
 * is the same shape as a comment asserting a policy grants `s3:GetObject` and
 * nothing else.
 *
 * Deliberately in its own file, and deliberately without a live store: nothing
 * here needs a network, so a broken `.env` fails on the sentence that names the
 * variable rather than on a connection timeout somewhere else.
 */

/** The seven, all valid, as a starting point for each `s3ConfigFromEnv` case. */
const VALID_ENV: Record<string, string> = {
  S3_ENDPOINT: "http://storage:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "olibra",
  S3_ACCESS_KEY_ID: "an-access-key",
  S3_SECRET_ACCESS_KEY: "a-secret-key",
  S3_FORCE_PATH_STYLE: "true",
  S3_PUBLIC_URL: "http://localhost:9000",
};

const saved = new Map(
  Object.keys(VALID_ENV).map((name) => [name, process.env[name]]),
);

afterEach(() => {
  // `fileParallelism: false` means files share a worker, so a variable left
  // behind here is a variable every later file inherits.
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function withEnv(overrides: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// ── required() ───────────────────────────────────────────────────────────────

test.each([
  ["undefined", undefined],
  ["empty", ""],
  ["only spaces", "   "],
  ["only a tab", "\t"],
])("required() refuses a value that is %s", (_label, value) => {
  // Whitespace counts as absent on purpose: `.env.example` ships
  // `S3_ACCESS_KEY_ID=           # required`, and a `.env` copied without
  // filling it in leaves exactly that. Treating it as set is how a stack comes
  // up with a root user literally named "# required".
  expect(() => required("S3_ACCESS_KEY_ID", value)).toThrow(/is not set/);
});

test.each([
  ["a plain value", "olibra", "olibra"],
  ["surrounding spaces", "  olibra  ", "olibra"],
  ["a trailing newline", "olibra\n", "olibra"],
])("required() returns %s trimmed", (_label, value, expected) => {
  expect(required("S3_BUCKET", value)).toBe(expected);
});

test("required() names the variable it is complaining about", () => {
  // The error is read by someone who has just cloned the repository, so it has
  // to say which of the seven is missing and what to do about it.
  expect(() => required("S3_REGION", undefined)).toThrow(/S3_REGION/);
  expect(() => required("S3_REGION", undefined)).toThrow(/\.env\.example/);
});

// ── flag() ───────────────────────────────────────────────────────────────────

test.each([
  ["true", true],
  ["false", false],
  ["TRUE", true],
  ["False", false],
  ["  true  ", true],
  ["true\n", true],
])("flag() reads %j as %s", (value, expected) => {
  expect(flag("S3_FORCE_PATH_STYLE", value)).toBe(expected);
});

test.each([
  ["undefined", undefined],
  ["empty", ""],
  ["1", "1"],
  ["0", "0"],
  ["yes", "yes"],
  ["no", "no"],
  ["on", "on"],
  ["ture", "ture"],
])("flag() refuses %s rather than treating it as false", (_label, value) => {
  // The reason this is strict and not lenient: `S3_FORCE_PATH_STYLE=1`
  // defaulting to `false` gives virtual-hosted URLs against MinIO — a working
  // `<img>` on the machine of whoever set the variable and a broken one
  // everywhere else. `ture` is in the list because that is what the mistake
  // actually looks like.
  expect(() => flag("S3_FORCE_PATH_STYLE", value)).toThrow(
    /must be exactly "true" or "false"/,
  );
});

// ── validateS3Config() ───────────────────────────────────────────────────────

const VALID_CONFIG: S3Config = {
  endpoint: "http://storage:9000",
  region: "us-east-1",
  bucket: "olibra",
  accessKeyId: "an-access-key",
  secretAccessKey: "a-secret-key",
  forcePathStyle: true,
  publicUrl: "http://localhost:9000",
};

test.each([
  ["a dot", "my.olibra.bucket"],
  ["uppercase", "MyBucket"],
  ["an underscore", "olibra_covers"],
  ["a leading hyphen", "-olibra"],
  ["a trailing hyphen", "olibra-"],
  ["a slash", "olibra/covers"],
  ["too few characters", "ab"],
  ["a space", "olibra covers"],
])("validateS3Config() refuses a bucket name with %s", (_label, bucket) => {
  // The dot case is the one with teeth. `my.olibra.bucket` virtual-hosted
  // becomes `https://my.olibra.bucket.s3.us-east-1.amazonaws.com/...`, and a
  // wildcard certificate covers one label rather than three: every browser
  // shows a certificate error, and before this validation nothing threw.
  expect(() => validateS3Config({ ...VALID_CONFIG, bucket })).toThrow(
    /S3_BUCKET must be a DNS-compatible bucket name/,
  );
});

test.each([["olibra"], ["olibra-test"], ["a-b-c-1-2-3"], ["abc"]])(
  "validateS3Config() accepts the bucket name %j",
  (bucket) => {
    expect(validateS3Config({ ...VALID_CONFIG, bucket }).bucket).toBe(bucket);
  },
);

test.each([
  ["no scheme at all", "cdn.example.org"],
  ["a bare host and port", "cdn.example.org:9000"],
  ["a scheme that is not http", "ftp://cdn.example.org"],
  ["nothing", ""],
])("validateS3Config() refuses a public URL with %s", (_label, publicUrl) => {
  // `cdn.example.org` is the silent one: path-style it emits
  // `cdn.example.org/bucket/a.jpg`, which is a relative URL and therefore
  // garbage, and that is the branch MinIO uses — the branch every developer
  // runs. Virtual-hosted the same value throws `Invalid URL`, so the failure
  // that is loud is the one nobody exercises locally.
  //
  // `cdn.example.org:9000` is here because it *parses*: "cdn.example.org" is a
  // syntactically valid URL scheme, so checking only that `new URL` succeeds
  // would let the commonest spelling of this mistake through.
  expect(() => validateS3Config({ ...VALID_CONFIG, publicUrl })).toThrow(
    /S3_PUBLIC_URL/,
  );
});

test.each([
  ["no scheme", "storage:9000"],
  ["a scheme that is not http", "s3://olibra"],
])("validateS3Config() refuses an endpoint with %s", (_label, endpoint) => {
  expect(() => validateS3Config({ ...VALID_CONFIG, endpoint })).toThrow(
    /S3_ENDPOINT/,
  );
});

test("validateS3Config() accepts an empty endpoint — that is the AWS row", () => {
  // `.env.example` documents a blank `S3_ENDPOINT` as "AWS S3's own endpoint",
  // and it is the one variable of the seven that is legitimately empty. A
  // validator that refused it would make the AWS configuration unreachable,
  // which is the configuration SDD §6.8's whole portability claim is about.
  expect(validateS3Config({ ...VALID_CONFIG, endpoint: "" }).endpoint).toBe("");
});

// ── s3ConfigFromEnv() ────────────────────────────────────────────────────────

test("s3ConfigFromEnv() reads the seven into a config", () => {
  withEnv({});

  expect(s3ConfigFromEnv()).toEqual({
    endpoint: "http://storage:9000",
    region: "us-east-1",
    bucket: "olibra",
    accessKeyId: "an-access-key",
    secretAccessKey: "a-secret-key",
    forcePathStyle: true,
    publicUrl: "http://localhost:9000",
  });
});

test("s3ConfigFromEnv() treats a blank S3_ENDPOINT as AWS's own", () => {
  withEnv({ S3_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: "false" });

  const config = s3ConfigFromEnv();
  expect(config.endpoint).toBe("");
  expect(config.forcePathStyle).toBe(false);
});

test.each([
  ["S3_REGION missing", { S3_REGION: undefined }, /S3_REGION is not set/],
  ["S3_BUCKET missing", { S3_BUCKET: undefined }, /S3_BUCKET is not set/],
  [
    "S3_FORCE_PATH_STYLE misspelled",
    { S3_FORCE_PATH_STYLE: "yes" },
    /must be exactly "true" or "false"/,
  ],
  [
    "S3_BUCKET containing a dot",
    { S3_BUCKET: "my.olibra.bucket" },
    /DNS-compatible bucket name/,
  ],
  [
    "S3_PUBLIC_URL without a scheme",
    { S3_PUBLIC_URL: "cdn.example.org" },
    /S3_PUBLIC_URL must be an absolute URL/,
  ],
])("s3ConfigFromEnv() fails loudly with %s", (_label, overrides, message) => {
  withEnv(overrides);
  expect(() => s3ConfigFromEnv()).toThrow(message);
});
