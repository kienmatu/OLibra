import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { NotWired } from "../../src/domain/kernel/errors";
import {
  hashFor,
  resetCryptoForTests,
  verifyFor,
} from "../../src/domain/kernel/crypto";
import {
  ensureCryptoWired,
  resetCryptoWiringForTests,
} from "../../src/lib/crypto-wiring";

/**
 * **The domain's crypto port is actually wired, on the path a real request
 * takes — not merely by `src/instrumentation.ts`, which used to be this
 * file's whole story and was not enough.**
 *
 * This file used to read `src/instrumentation.ts` as text and assert it
 * contained `setPasswordHasher(`. That assertion was true for the entire time
 * `POST /dang-ky` returned 500 for every reader who supplied a username and
 * password — confirmed live by a QA sweep on 10/08/2026 — because it never
 * crossed the seam the defect actually lives in. Turbopack bundles a module
 * imported by both `src/instrumentation.ts` (the `node` layer) and a server
 * action (the `react-server` layer) as two separate instances, each with its
 * own copy of every module-level binding; `instrumentation.ts` calling
 * `setPasswordHasher` wired only its own copy; `registerMembershipAction` ran
 * against the other one, still at its throwing default. Reading
 * `instrumentation.ts`'s source cannot see that, and neither can calling
 * `hashFor`/`verifyFor` after the suite's own setup has wired them — every
 * unit test in this project does exactly that, in its own `beforeAll`, so
 * none of them could ever observe the unwired state either.
 *
 * The regression guard for *that* — an actual request, through Next's own
 * handler — is `tests/lib/registration-over-http.test.ts`, which this file
 * cannot replace: an in-process test, however it calls `hashFor`, never
 * crosses the layer boundary.
 *
 * **Why a gap like this survives in the product long enough for a QA sweep
 * to find it, rather than the first reader who tries it**, is recorded in
 * `src/domain/kernel/crypto.ts`'s own docstring: registration without
 * credentials never reaches `hashFor`, and sign-in verifies through
 * `src/auth/session.ts` directly rather than through this port, so the only
 * path that ever needed the port wired is somebody typing a *new*
 * password — which is exactly the path this bug, and the wiring gap before
 * it, both went untried on.
 *
 * What this file can and does check:
 *
 * 1. The unwired default still throws (`NotWired`), so wiring is not
 *    decoration — the floor everything else stands on.
 * 2. `ensureCryptoWired()` (`src/lib/crypto-wiring.ts`) really does wire a
 *    hasher and verifier that agree with each other, with the real
 *    implementation (`$argon2` output), not a stub written here.
 * 3. Every one of `src/lib/page-data.ts`'s four entry points —
 *    `loadPage`, `loadPublicPage`, `submitCommand`, `submitAdminCommand` —
 *    calls `ensureCryptoWired()` inside its own body. This is a source-text
 *    check again, and it inherits the same limit the old one had: it cannot
 *    prove the call actually runs before the port is needed, only that it is
 *    written. It stays anyway, as the cheap regression guard for exactly this
 *    defect's shape — a future edit that adds a fifth entry point, or
 *    removes the call from one of the four while refactoring, fails this
 *    test immediately rather than waiting for `registration-over-http.test.ts`
 *    (or a QA sweep) to notice a specific request path stopped wiring itself.
 */

const raisedBy = async (call: () => unknown): Promise<unknown> => {
  try {
    return await call();
  } catch (err) {
    return err;
  }
};

test("the unwired default throws, so wiring is not decoration", async () => {
  resetCryptoForTests();
  expect(await raisedBy(() => hashFor("bất kỳ"))).toBeInstanceOf(NotWired);
  expect(await raisedBy(() => verifyFor("a", "b"))).toBeInstanceOf(NotWired);
});

test("ensureCryptoWired produces a hash the verifier accepts", async () => {
  // Both resets: `resetCryptoForTests` puts the domain's hasher/verifier back
  // to their throwing defaults, and `resetCryptoWiringForTests` clears
  // `crypto-wiring.ts`'s own `wired` flag — without the second,
  // `ensureCryptoWired()` below would see `wired` still `true` from an
  // earlier test in this file and return immediately, leaving the just-reset
  // throwing defaults in place.
  resetCryptoForTests();
  resetCryptoWiringForTests();

  await ensureCryptoWired();
  const hash = await hashFor("matkhau123");
  expect(hash).toMatch(/^\$argon2/);
  expect(await verifyFor("matkhau123", hash)).toBe(true);
  expect(await verifyFor("sai", hash)).toBe(false);
});

test("every application entry point wires before it can need the port", () => {
  const src = readFileSync("src/lib/page-data.ts", "utf8");
  for (const fn of [
    "loadPage",
    "loadPublicPage",
    "submitCommand",
    "submitAdminCommand",
  ]) {
    expect(src, `${fn} calls ensureCryptoWired`).toMatch(
      new RegExp(`function ${fn}[\\s\\S]{0,600}?ensureCryptoWired\\(`),
    );
  }
});
