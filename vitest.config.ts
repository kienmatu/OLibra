import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Loaded before the config object is built, so TEST_DATABASE_URL from .env is
// visible to the suite without every developer exporting it by hand.
config({ path: ".env", quiet: true });

export default defineConfig({
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
