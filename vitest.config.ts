import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Loaded before the config object is built, so TEST_DATABASE_URL from .env is
// visible to the suite without every developer exporting it by hand.
config({ path: ".env", quiet: true });

export default defineConfig({
  resolve: {
    // `@/` → `src/`, matching `tsconfig.json`'s own `paths`.
    //
    // **This is new, and it does not retract the notes it appears to.** Half a
    // dozen modules under `src/components/` and `src/app/` carry a comment
    // saying they import relatively because "Vitest resolves no alias"; those
    // comments were accurate and the workaround they describe still works
    // unchanged. What they were paying for is a *page* being untestable: a
    // `page.tsx` is written for Next, imports `@/` freely, and is not going to
    // be rewritten into relative specifiers just so a test can load it. The
    // first test that renders one
    // (`tests/lib/profile-page-shows-a-decided-request.test.tsx`, which pins a
    // crash that only existed in JSX) needed this, and every future page test
    // needs it too.
    //
    // **An anchored `RegExp`, and the object shorthand `{ "@/": ".../src/" }`
    // is not an acceptable simplification of it.** That shorthand was written
    // first and it *resolved the page fine* — which is exactly why it is worth
    // a paragraph. What it also did was leave the suite intermittently
    // destroying its own database: `tests/db/migrate.test.ts` and
    // `contacts-backfill-migration.test.ts` legitimately `drop schema public
    // cascade` and rebuild, and under the string form the run interleaved with
    // them — `policy "feedback_tenant" ... already exists`,
    // `relation "parish_units_bookshelf_id_id_key" already exists`, `deadlock
    // detected` on `resetDatabase`'s truncate, and rows vanishing between two
    // statements on one connection. Measured, on a freshly rebuilt schema:
    // 355 of 1527 tests failed with the string form and none with this one,
    // and the failures moved around between runs, which is what makes the
    // shorthand worth naming rather than just avoiding. `tests/db` plus
    // `tests/lib/page-data.test.ts` — no new file involved at all — is the
    // smallest reproduction, so this is not a property of the test below.
    alias: [
      {
        find: /^@\//,
        replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
      },
    ],
  },
  test: {
    // `.tsx` is included alongside `.ts`: task 8 (2026-08-10 QA remediation)
    // added the first component-rendering test
    // (`tests/components/reader-tabs.test.tsx`), and a glob that only matched
    // `.ts` would have let that file sit in the tree, never run, and still
    // show green — the same toothless-test failure mode task 3's
    // architecture test hit.
    include: ["tests/**/*.test.{ts,tsx}"],
    // Vitest parallelises *files* by default. Every DB test file shares one
    // `public` schema, and `beforeEach(resetDatabase)` (tests/support/db.ts)
    // truncates every table in it between tests — two files running at once
    // stomp each other's data, and a file that does something more drastic to
    // the schema (e.g. `drop schema public cascade`) would take down whatever
    // else is running concurrently. There is no per-file isolation anywhere in
    // this repo; that was previously (incorrectly) claimed here. `fileParallelism:
    // false` is the fix: it serialises test files. The suite is fast enough
    // that this costs nothing worth trading correctness for.
    fileParallelism: false,
    // Bounds concurrency for tests that opt into `test.concurrent` *within* a
    // single file. Unrelated to the cross-file race above — that's handled by
    // fileParallelism, not this.
    maxConcurrency: 4,
    // G6. Set here rather than per-file so no test can forget it. Every rule
    // involving due_on, overdue or hold expiry is timezone-sensitive, and the
    // failure mode without this is a suite that passes in Vietnam and fails in
    // CI — the worst possible way to find out.
    env: { TZ: "Asia/Ho_Chi_Minh" },
    // A hung database connection should fail, not hang CI forever.
    testTimeout: 15_000,
  },
});
