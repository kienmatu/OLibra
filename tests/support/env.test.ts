import { afterEach, expect, test } from "vitest";
import { testDatabaseUrl } from "./env";

const saved = process.env.TEST_DATABASE_URL;
afterEach(() => {
  process.env.TEST_DATABASE_URL = saved;
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
