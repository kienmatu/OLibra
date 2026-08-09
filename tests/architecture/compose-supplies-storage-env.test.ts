import { readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

/**
 * The composed `app` service must carry the seven `S3_*` variables the object
 * store reads.
 *
 * **Why this could not have been written before B2b.** `s3ConfigFromEnv()`
 * throws on any of the seven being unset, and until this slice nothing in the
 * application constructed an `ObjectStore` at all — so the variables could have
 * been absent from `compose.yaml` indefinitely and every test, every page and
 * every `docker compose up` would have stayed green. As of `src/lib/object-store
 * .ts` a missing one is a 500 on the first avatar upload, in the container,
 * which is the worst place to find out.
 *
 * The CI side of this already had a guard
 * (`tests/architecture/ci-supplies-required-env.test.ts`, written after
 * `TEST_POOL_DATABASE_URL` shipped without being added to the workflow and
 * turned `main` red for three merges). This is the same guard for the same class
 * of failure, on the other file that supplies environment to a running process.
 *
 * Read as text, deliberately, for the reason that test states: parsing the YAML
 * would mean agreeing with a parser about anchors, multi-line scalars and which
 * block a key belongs to. "The name appears inside the `app:` service's block"
 * is a weaker claim than a parse and one that cannot itself be subtly wrong.
 */

/**
 * Exactly the names `s3ConfigFromEnv()` reads. Kept as a literal list rather
 * than grepped out of that function, because the point is to compare two
 * independently-written statements of the same fact — a list derived from the
 * source would agree with the source by construction.
 */
const STORAGE_ENV = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FORCE_PATH_STYLE",
  "S3_PUBLIC_URL",
];

/**
 * The `app:` service's own block: from its two-space-indented key to the next
 * key at that indentation, or the end of the file.
 *
 * Scoped rather than searched whole-file, because `compose.yaml` also configures
 * the `storage` service and its `storage-init` sidecar, both of which mention
 * `S3_BUCKET` — so a whole-file `includes` would pass with the `app` service
 * carrying none of them.
 */
function appService(compose: string): string {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => /^ {2}app:\s*$/.test(line));
  expect(start).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

test("compose passes every S3 variable to the app service", () => {
  const service = appService(readFileSync("compose.yaml", "utf8"));
  const missing = STORAGE_ENV.filter(
    (name) => !new RegExp(`^\\s+${name}:`, "m").test(service),
  );
  expect(missing).toEqual([]);
});

test("the list this test guards is the one s3ConfigFromEnv actually reads", () => {
  // Keeps the literal above honest. `s3ConfigFromEnv` is the only function in
  // `src/storage/s3.ts` allowed to touch `process.env`
  // (`storage-speaks-s3.test.ts` pins that), so every `process.env.X` in that
  // file is one of the seven — and an eighth added there without being added
  // here fails, rather than shipping a container that starts and then cannot
  // store an avatar.
  const source = readFileSync("src/storage/s3.ts", "utf8");
  const read = [...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map(
    (m) => m[1],
  );
  expect([...new Set(read)].sort()).toEqual([...STORAGE_ENV].sort());
});

test("a route file under src/app reaches the object store", () => {
  // B5's Docker smoke stage boots the standalone server and fails the build
  // unless it serves a page. That gate could not catch `@aws-sdk/client-s3`
  // failing to load under Bun unless the SDK is *in* the image, and Next traces
  // `.next/standalone` from what the **routes** import — B5's own plan recorded
  // the gate as vacuous "until B1 or B2b wires the store into a route".
  //
  // **A `"use server"` module that no route references is not enough**, and this
  // test shipped, briefly, not knowing that. Its first version walked every
  // `.ts` under `src/app`, so `actions.ts` satisfied it by importing the store
  // itself — and the assertion passed with the page's `import { proposeAvatar
  // Action }` deleted, which is precisely the state that leaves the smoke gate
  // vacuous. Measured rather than reasoned: with the action file present and
  // unreferenced, `docker build --target smoke .` passed and the image contained
  // no `@aws-sdk` directory at all; with the page importing it, the image
  // carries sixteen `@aws-sdk` packages and `bun -e 'import("@aws-sdk/client-s3")'`
  // resolves inside it.
  //
  // So the roots are route files only — the ones Next renders and therefore
  // traces from — and the walk is transitive, because the reach is
  // `page.tsx -> actions.ts -> lib/avatar.ts -> lib/object-store.ts ->
  // storage/s3.ts`.
  const reaches = new Map<string, boolean>();

  const importsOf = (file: string): string[] =>
    [
      ...readFileSync(file, "utf8").matchAll(
        /\b(?:from|import)\s*\(?\s*["'](\.[^"']+|@\/[^"']+)["']/g,
      ),
    ].map((m) => m[1]);

  const resolve = (from: string, specifier: string): string | null => {
    // `node:path`, not `new URL(specifier, "file://" + from)`: the route tree
    // contains `[shelf]`, and a URL percent-encodes the brackets, so every
    // resolved path under a dynamic segment would be a filename that does not
    // exist and the whole traversal would silently answer "no".
    const base = specifier.startsWith("@/")
      ? pathResolve("src", specifier.slice(2))
      : pathResolve(dirname(from), specifier);
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
    ]) {
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // Not this spelling.
      }
    }
    return null;
  };

  const reachesStore = (file: string, stack: Set<string>): boolean => {
    const cached = reaches.get(file);
    if (cached !== undefined) return cached;
    // A cycle is not an answer, so it contributes `false` without being cached
    // — caching it would poison every later query about the same file.
    if (stack.has(file)) return false;
    stack.add(file);
    const answer =
      file.includes("/src/storage/") ||
      importsOf(file).some((specifier) => {
        const target = resolve(file, specifier);
        return target !== null && reachesStore(target, stack);
      });
    stack.delete(file);
    reaches.set(file, answer);
    return answer;
  };

  // The files Next.js treats as a route's entry points, and therefore the only
  // roots its tracing starts from.
  const routes = filesUnder("src/app").filter((f) =>
    /\/(page|layout|route|template|default)\.tsx?$/.test(f.replace(/\\/g, "/")),
  );
  expect(routes.filter((f) => reachesStore(f, new Set()))).not.toEqual([]);
});
