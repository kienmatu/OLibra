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
    // **Added for the first test that renders a page component**
    // (`tests/lib/profile-page-shows-a-decided-request.test.tsx`, which pins a
    // 500 that existed only in JSX). A `page.tsx` is written for Next and
    // imports `@/` freely; it was never going to be rewritten into relative
    // specifiers just so a test could load it, and every future page test
    // needs this line too.
    //
    // **It also retired a workaround that had spread to twenty-six files.**
    // Modules under `src/app/`, `src/components/` and `src/lib/` used to
    // import relatively — `../../../../../domain/kernel/errors` — each with a
    // comment explaining that Vitest resolved no alias, so an `@/` import
    // would make the module unloadable by the suite rather than merely
    // untested. The split ran through single directories: `ui/card.tsx` said
    // `@/lib/utils` and `ui/field.tsx` said `../../lib/utils`, the same import
    // twice, divided only by whether a test happened to reach the file. Those
    // files now say `@/` like everything else and the twenty-six comments are
    // gone; `src/domain/` stays fully relative, which is a different rule for
    // a different reason (SDD §3.1 — it must run outside this pipeline).
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
