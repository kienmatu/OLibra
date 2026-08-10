import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { NotWired } from "../../src/domain/kernel/errors";
import { hashFor, verifyFor } from "../../src/domain/members/registration";

/**
 * **The domain's two injected setters are actually set, by the application.**
 *
 * `registration.ts` defaults its hasher and its verifier to throwing
 * `NotWired`, and says why: an unwired hasher must fail loudly rather than
 * write a plausible-looking string into `password_hash`. Until U5 nothing in the
 * running application called either setter — `grep -rn setPasswordHasher src`
 * returned three comments *about* the wiring and no call — so
 * `SetReaderCredentials` and `ChangeOwnPassword` would both have thrown
 * `password_hasher_not_wired` the first time a volunteer used them.
 *
 * **Every test in the suite was green, and that is the point of this file.** The
 * suite calls the setters in its own setup, so a test can never observe the
 * unwired state; the defect lives strictly between the domain and the
 * application, which is the seam no domain test crosses.
 *
 * It also stayed hidden in the product. Registration without credentials — the
 * ordinary case, since most children never supply a username — returns before
 * the hasher is reached, and sign-in verifies through `src/auth/session.ts`,
 * which calls `verifyPassword` directly rather than through `verifyFor`. So
 * seeded accounts signed in, the link crawl passed, and the only untried path
 * was changing a password.
 *
 * So the rule is read off the source rather than by calling the functions: this
 * file cannot *invoke* `register()` and then assert, because doing so would
 * wire them and the assertion would hold whether the application did it or not.
 */

const INSTRUMENTATION = "src/instrumentation.ts";

/**
 * The error a call raised, however it raised it.
 *
 * The two defaults do not fail the same way and the difference is invisible at
 * the call site: `hasher` is a plain arrow that throws **synchronously**, while
 * `verifier` is `async` and therefore returns a **rejected promise**. A test
 * written for one shape passes vacuously against the other — `expect(() =>
 * verifyFor(…)).toThrow()` fails not because the verifier is wired but because
 * nothing was thrown to catch.
 */
async function raisedBy(call: () => unknown): Promise<unknown> {
  try {
    return await call();
  } catch (err) {
    return err;
  }
}

test("the defaults really do throw, so wiring them is not decoration", async () => {
  // The floor for everything below. If the unwired default quietly returned a
  // string, the rest of this file would be checking a call nobody needs.
  expect(await raisedBy(() => hashFor("bất kỳ"))).toBeInstanceOf(NotWired);
  expect(await raisedBy(() => verifyFor("a", "b"))).toBeInstanceOf(NotWired);
});

test("the application's startup hook wires both", () => {
  const source = readFileSync(INSTRUMENTATION, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // Next calls `register()` once per server process, before any request.
  expect(source).toMatch(/export\s+async\s+function\s+register\s*\(/);

  for (const setter of ["setPasswordHasher", "setPasswordVerifier"]) {
    expect(source, `${INSTRUMENTATION} calls ${setter}`).toContain(`${setter}(`);
  }

  // And with the real implementations, not with stubs written here.
  expect(source).toContain("hashPassword");
  expect(source).toContain("verifyPassword");
  expect(source).toContain("./auth/password");
});

test("nothing else in the application wires them, so there is one composition root", () => {
  // Two call sites is how one of them stops being reached and nobody notices —
  // the failure mode is silent, because whichever ran first already wired the
  // module for the whole process.
  const { execSync } =
    require("node:child_process") as typeof import("node:child_process");
  const hits = execSync(
    "grep -rln 'setPasswordHasher(\\|setPasswordVerifier(' src || true",
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    // The module that *declares* them is not a caller.
    .filter((f) => f !== "src/domain/members/registration.ts");

  expect(hits).toEqual([INSTRUMENTATION]);
});
