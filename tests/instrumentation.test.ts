import { afterEach, describe, expect, test } from "vitest";
import {
  checkDatabaseUrlsForSwallowedComments,
  passwordLooksLikeASwallowedComment,
} from "../src/instrumentation";

/**
 * QA remediation Task 26. Falsification evidence for the startup check that
 * refuses to boot the process when `DATABASE_URL` or `MIGRATION_DATABASE_URL`
 * carries a password that is actually a swallowed `.env.example` comment —
 * `src/instrumentation.ts`'s own docstring on both functions under test has
 * the fuller argument for the shape and for why it is checked as a string
 * rather than through `new URL()`.
 *
 * A relative specifier (`../src/instrumentation`), not `@/instrumentation`:
 * Vitest resolves no alias in this project — every other test that reaches
 * into `src/` does the same.
 */
describe("passwordLooksLikeASwallowedComment", () => {
  test("an ordinary password never trips it", () => {
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra_pool:olibra-pool-dev@localhost:5435/olibra",
      ),
    ).toBe(false);
  });

  test("a password that is literally CHANGE_ME never trips it either — wrong is not the same defect as swallowed", () => {
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:CHANGE_ME@localhost:5435/olibra",
      ),
    ).toBe(false);
  });

  test("a password beginning with an unencoded # trips it", () => {
    // The exact shape `docker inspect olibra-db-1` reported live: compose
    // trims the leading whitespace `.env.example`'s own line had before `#`.
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:# required, no default@localhost:5435/olibra",
      ),
    ).toBe(true);
  });

  test("a password with leading whitespace before the # trips it too", () => {
    // The raw `.env.example` shape, before compose's own trimming — pasted
    // by hand rather than read off `docker inspect`.
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:          # required, no default@localhost:5435/olibra",
      ),
    ).toBe(true);
  });

  test("a swallowed comment that was fully percent-encoded before pasting trips it too, once decoded", () => {
    // `%23%20required%2C%20no%20default` decodes to `# required, no default`
    // — the shape a developer gets from copying the *encoded* form of the
    // defect rather than the raw one `docker inspect` actually prints.
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:%23%20required%2C%20no%20default@localhost:5435/olibra",
      ),
    ).toBe(true);
  });

  // The High finding from code review: the first version of this check
  // flagged any password containing `%23` anywhere, which refuses a real,
  // correctly-encoded password that merely *contains* a `#` — exactly the
  // spelling `postgres.js` itself expects (`parseUrl`'s own
  // `decodeURIComponent(urlObj.password)`). `hunter#22`, written into a URL
  // as `hunter%2322`, must authenticate, not be refused as a swallowed
  // comment.
  test("a real password that happens to contain # (correctly percent-encoded) never trips it", () => {
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:hunter%2322@localhost:5435/olibra",
      ),
    ).toBe(false);
  });

  test("a password containing a bare % that is not a valid escape does not throw, and does not trip it", () => {
    // `%of` is not a valid percent-encoded byte (`o`/`f` are not hex
    // digits), so `decodeURIComponent` throws on it — and a password like
    // this is a legal password, not a URL-encoding mistake. The boot check
    // must not crash over it.
    expect(() =>
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:50%off@localhost:5435/olibra",
      ),
    ).not.toThrow();
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:50%off@localhost:5435/olibra",
      ),
    ).toBe(false);
  });

  test("a # elsewhere in the URL — never in the password — does not trip it", () => {
    // The password itself is ordinary; a `#` two segments later (a database
    // name nobody would actually choose, but the check only looks at the
    // password) must not be mistaken for the defect.
    expect(
      passwordLooksLikeASwallowedComment(
        "postgres://olibra:hunter2@localhost:5435/olibra#not-a-password",
      ),
    ).toBe(false);
  });

  test("a URL with no userinfo section is not a match, not a crash", () => {
    expect(
      passwordLooksLikeASwallowedComment("postgres://localhost:5435/olibra"),
    ).toBe(false);
  });

  test("a string with no scheme separator is not a match, not a crash", () => {
    expect(passwordLooksLikeASwallowedComment("not a url at all")).toBe(false);
  });
});

describe("checkDatabaseUrlsForSwallowedComments", () => {
  const ENV_VARS = ["DATABASE_URL", "MIGRATION_DATABASE_URL"] as const;
  const originals = new Map(ENV_VARS.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of ENV_VARS) {
      const original = originals.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  test("does nothing when neither variable is set", () => {
    delete process.env.DATABASE_URL;
    delete process.env.MIGRATION_DATABASE_URL;

    expect(() => checkDatabaseUrlsForSwallowedComments()).not.toThrow();
  });

  test("does nothing when both URLs carry ordinary passwords", () => {
    process.env.DATABASE_URL =
      "postgres://olibra_pool:olibra-pool-dev@localhost:5435/olibra";
    process.env.MIGRATION_DATABASE_URL =
      "postgres://olibra:CHANGE_ME@localhost:5435/olibra";

    expect(() => checkDatabaseUrlsForSwallowedComments()).not.toThrow();
  });

  test("throws the Vietnamese sentence the brief specifies when DATABASE_URL is affected", () => {
    process.env.DATABASE_URL =
      "postgres://olibra_pool:# required, no default@localhost:5435/olibra";
    delete process.env.MIGRATION_DATABASE_URL;

    expect(() => checkDatabaseUrlsForSwallowedComments()).toThrow(
      /Có vẻ mật khẩu trong \.env đang là dòng chú thích — xem \.env\.example\./,
    );
  });

  test("names the affected variable in the thrown message", () => {
    delete process.env.DATABASE_URL;
    process.env.MIGRATION_DATABASE_URL =
      "postgres://olibra:%23%20required@localhost:5435/olibra";

    expect(() => checkDatabaseUrlsForSwallowedComments()).toThrow(
      /MIGRATION_DATABASE_URL/,
    );
  });
});
