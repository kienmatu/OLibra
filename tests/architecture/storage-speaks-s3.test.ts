import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

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

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Every module specifier in `source`, however the import is spelled. */
function importSpecifiers(source: string): string[] {
  const pattern = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((m) => m[1]);
}

/**
 * Comments and string literals removed, so the two environment checks below
 * see code and only code.
 *
 * They need it more than they might appear to: `src/storage/s3.ts` documents
 * *why* it reads the environment from one place, and does so by naming
 * `process.env` several times in prose sitting above the function. Counting
 * raw occurrences would make the module fail its own test for explaining
 * itself, which is the wrong incentive to build into the suite.
 *
 * A deliberate small copy of `boundaries.test.ts`'s helper rather than a
 * shared one — same known gaps (a string containing a block-comment opener is
 * misread, which is a false negative and happens nowhere in this repo), and
 * the same disclaimer applies: it is not a parser and does not claim to be.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/\/\/.*$/gm, "");
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

test("the object store reads exactly the seven documented S3 variables", () => {
  // Each name is read as a literal property access in `s3ConfigFromEnv` — a
  // `process.env[name]` lookup inside a helper would be invisible here, and
  // this test would then pass over a module reading whatever it liked. That is
  // why the implementation writes each name twice and says so.
  const source = stripCommentsAndStrings(readFileSync("src/storage/s3.ts", "utf8"));
  const read = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
    (m) => m[1],
  );

  expect([...new Set(read)].sort()).toEqual([...S3_VARIABLES].sort());
});

test("only s3ConfigFromEnv reads the environment", () => {
  // The criterion above is only meaningful if there is one place to look. A
  // module that reached for `process.env.S3_BUCKET` from three functions would
  // still satisfy the name check while making "and nothing else" a claim
  // nobody can verify without re-reading the whole file — and would leave the
  // suite unable to point a store at a test bucket without mutating
  // `process.env`, which under `fileParallelism: false` leaks into every later
  // file in the same worker.
  const source = stripCommentsAndStrings(readFileSync("src/storage/s3.ts", "utf8"));
  const start = source.indexOf("export function s3ConfigFromEnv");
  expect(start).toBeGreaterThan(-1);

  // The function's closing brace: the first `}` at column zero after it.
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);

  const inFile = [...source.matchAll(/process\.env/g)].length;
  const inFunction = [...body.matchAll(/process\.env/g)].length;
  expect(inFunction).toBe(inFile);
});
