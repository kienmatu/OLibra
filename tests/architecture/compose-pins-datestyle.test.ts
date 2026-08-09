import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Both Postgres services must pin `DateStyle`, and neither may inherit it.
 *
 * Postgres's default is `ISO, MDY`, and `postgres:16.10-alpine` ships it, so
 * until this pin existed the ordering a date *string* is read in came from an
 * image default nobody had chosen. Measured through this application's driver
 * against that default: `02/04/2015` — 2 April 2015, as it is written in
 * Vietnamese — is stored as `2015-02-03`.
 *
 * The pin is not the rule. `assertStorableDate`
 * (`src/domain/members/profile-fields.ts`) refuses anything that is not
 * `YYYY-MM-DD` before it reaches the database, and that is what
 * `tests/domain/members/dates-are-real-dates.test.ts` holds. This is the other
 * half, for everything that does not go through the domain — a `psql` session,
 * a restore, a future job — and it is asserted here rather than trusted because
 * a line in a YAML file is exactly the kind of thing a later edit drops while
 * moving something else.
 *
 * **Both services, and that is the point of asserting a count.** `db-test` is
 * what the suite runs against; a suite that reads dates differently from
 * production is a suite that agrees with itself and not with the thing it is
 * testing, which is the argument `compose.yaml`'s own locale comment already
 * makes about collation.
 *
 * Read as text, like `ci-pins-the-storage-image.test.ts`, and for the same
 * reason: parsing the YAML would mean agreeing with a parser about anchors and
 * multi-line scalars, while "the string appears once per Postgres service" is a
 * weaker claim that cannot itself be subtly wrong.
 */
test("both Postgres services pin DateStyle rather than inheriting the image default", () => {
  const compose = readFileSync("compose.yaml", "utf8");

  const postgresServices = compose.match(/image: postgres:/g) ?? [];
  const pins = compose.match(/datestyle=ISO, YMD/gi) ?? [];

  expect(postgresServices.length).toBeGreaterThan(0);
  expect(pins).toHaveLength(postgresServices.length);
});
