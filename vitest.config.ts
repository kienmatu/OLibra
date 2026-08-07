import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Loaded before the config object is built, so TEST_DATABASE_URL from .env is
// visible to the suite without every developer exporting it by hand.
config({ path: ".env", quiet: true });

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Domain tests talk to a real database and must not race each other on the
    // same schema. Per-file isolation lives in tests/support/db.ts; this cap
    // keeps the connection count sane on a laptop.
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
