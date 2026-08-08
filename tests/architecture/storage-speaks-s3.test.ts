import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder, stripCommentsAndStrings } from "../support/source-text";

/**
 * SDD §6.8's portability claim, as tests rather than as a sentence.
 *
 * > MinIO is an implementation, not the interface. The application speaks S3
 * > and never imports a MinIO SDK, so changing provider is a change of
 * > environment variables — endpoint, region, bucket, credentials — and
 * > nothing else.
 *
 * Both halves of that are checkable and neither was checked before this slice:
 * "never imports a MinIO SDK" was true only because `src/storage/` did not
 * exist, and "and nothing else" is a promise about which variables the code
 * reads, which no amount of documentation can keep.
 *
 * Like `ci-supplies-required-env.test.ts`, these read source as text rather
 * than parsing it. That is a weaker claim — a specifier assembled at runtime
 * would slip through — but it is one that cannot itself be subtly wrong, and
 * the thing being guarded against is an ordinary `import` somebody adds
 * because it looked convenient.
 */

/** Every module specifier in `source`, however the import is spelled. */
function importSpecifiers(source: string): string[] {
  const pattern = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((m) => m[1]);
}

test("no MinIO SDK is a dependency", () => {
  // The package.json half. A MinIO client that is merely installed is one
  // `import` away from being used, and the review that would have caught the
  // import is the same review that let the dependency in.
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];

  expect(declared.filter((name) => /minio/i.test(name))).toEqual([]);
});

test("no source file imports a MinIO SDK", () => {
  // The source half, over all of `src/` rather than only `src/storage/`. The
  // interesting version of this mistake is not the storage module reaching for
  // `minio` — it is a route handler doing so directly because the store did
  // not expose something it wanted, which is exactly the coupling that makes
  // "changing provider is a change of environment variables" stop being true.
  const offenders = filesUnder("src")
    .filter((file) =>
      importSpecifiers(readFileSync(file, "utf8")).some((s) => /minio/i.test(s)),
    )
    .map((file) => file.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

/** §7.5: the store reads these seven and nothing else. */
const S3_VARIABLES = [
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_PUBLIC_URL",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
];

/**
 * Every file in the storage module, as code with comments and strings removed.
 *
 * The whole directory, not `s3.ts`. Both checks below used to read that one
 * hard-coded path, and the escape from them was not adversarial — it was the
 * ordinary next file. A reviewer added `src/storage/env-extra.ts` reading an
 * eighth variable *and* `DATABASE_URL`, imported it from `s3.ts`, and all four
 * tests here stayed green. `src/storage/config.ts` or `src/storage/r2.ts` is
 * what that looks like when nobody is trying.
 *
 * ## What this still does not catch, stated rather than implied
 *
 * These are text checks, and the following are known to slip through. They are
 * left uncaught deliberately — each is a deliberate evasion rather than a thing
 * someone does by accident, and chasing them means writing a parser, which is a
 * larger surface to be subtly wrong in than the rule it would be guarding:
 *
 * - `const leaked = process.env;` inside `s3ConfigFromEnv`, then `leaked.X`
 *   anywhere else in the module.
 * - `import.meta.env.X`, which is a different expression entirely.
 * - `process["env"].X`, which the string-stripping above turns into
 *   `process[""].X` before either regex ever sees it.
 *
 * The claim these tests support is therefore "no eighth variable arrived by
 * ordinary means", which is the failure that actually happens.
 */
const STORAGE_SOURCES = filesUnder("src/storage").map((file) => ({
  file,
  code: stripCommentsAndStrings(readFileSync(file, "utf8")),
}));

test("the storage module reads exactly the seven documented S3 variables", () => {
  // Each name is read as a literal property access in `s3ConfigFromEnv` — a
  // `process.env[name]` lookup inside a helper would be invisible here, and
  // this test would then pass over a module reading whatever it liked. That is
  // why the implementation writes each name twice and says so.
  expect(STORAGE_SOURCES.length).toBeGreaterThan(0);

  const read = STORAGE_SOURCES.flatMap(({ code }) =>
    [...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  );

  expect([...new Set(read)].sort()).toEqual([...S3_VARIABLES].sort());
});

test("only s3ConfigFromEnv reads the environment", () => {
  // The criterion above is only meaningful if there is one place to look. A
  // module that reached for `process.env.S3_BUCKET` from three functions — or,
  // as above, from a second file — would still satisfy the name check while
  // making "and nothing else" a claim nobody can verify without re-reading the
  // whole directory. It would also leave the suite unable to point a store at a
  // test bucket without mutating `process.env`, which under
  // `fileParallelism: false` leaks into every later file in the same worker.
  const declaring = STORAGE_SOURCES.filter(({ code }) =>
    code.includes("export function s3ConfigFromEnv"),
  );
  expect(declaring.map((s) => s.file)).toEqual(["src/storage/s3.ts"]);

  const source = declaring[0].code;
  const start = source.indexOf("export function s3ConfigFromEnv");
  // The function's closing brace: the first `}` at column zero after it.
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);

  const inModule = STORAGE_SOURCES.reduce(
    (n, { code }) => n + [...code.matchAll(/process\.env/g)].length,
    0,
  );
  const inFunction = [...body.matchAll(/process\.env/g)].length;
  expect(inFunction).toBe(inModule);
});
