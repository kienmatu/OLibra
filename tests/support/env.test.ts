import { afterEach, expect, test } from "vitest";
import { testDatabaseUrl, testPoolDatabaseUrl } from "./env";

const saved = process.env.TEST_DATABASE_URL;
const savedPool = process.env.TEST_POOL_DATABASE_URL;
afterEach(() => {
  process.env.TEST_DATABASE_URL = saved;
  process.env.TEST_POOL_DATABASE_URL = savedPool;
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
