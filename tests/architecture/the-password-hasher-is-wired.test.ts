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
 * 3. Every function `src/lib/page-data.ts` exports either calls
 *    `ensureCryptoWired()` inside its own body, or is named in
 *    `DOES_NOT_WIRE` with the reason it genuinely should not.
 *
 * **Point 3 used to be a hard-coded list of four names, and that list drifted
 * twice (QA remediation's final fix wave found it).** `page-data.ts` now
 * exports eight functions, not four: `loadFrontDoorViewer` (Task 6) and
 * `submitPublicCommand` (Task 17) both wire `ensureCryptoWired()` correctly
 * and were simply never added here, so a broken wiring in either would have
 * passed this test silently. The docstring this replaced even promised "a
 * future edit that adds a fifth entry point … fails this test immediately" —
 * falsified twice over by the time anyone reread it. Fixed at the root:
 * `pageDataExports()` reads the list from the module itself
 * (`export async function NAME`, source order), so a ninth export is checked
 * automatically instead of needing a human to remember to add its name here.
 *
 * `loadAdminPage` and `loadFile` genuinely do not call `ensureCryptoWired()`
 * and are not a second instance of the same drift — they are inert today,
 * on purpose: `loadAdminPage` only *reads* the administration surface (no
 * page behind it sets a password), and `loadFile` is a read-only CSV export
 * (P1, §3.5(c)). Deriving the export list does not mean pretending these two
 * wire when they do not — `DOES_NOT_WIRE` names them explicitly, with this
 * reason, and a second test below pins that the exemption is honest: both
 * names are still real exports, and neither's body actually contains the
 * call. If a future edit adds a real credential path to either, deleting its
 * `DOES_NOT_WIRE` entry is what re-enables the check on it — the same
 * remove-your-own-exemption pattern `every-domain-command-has-a-caller
 * .test.ts`'s `EXEMPT` already uses.
 *
 * This is still a source-text check, and it inherits the same limit the
 * original one had: it cannot prove a call actually runs before the port is
 * needed, only that it is written in the function's own body. It stays
 * anyway, as the cheap regression guard for exactly this defect's shape — a
 * future entry point that forgets to wire, or a refactor that moves the call
 * out of one of the wired functions, fails this test immediately rather than
 * waiting for `registration-over-http.test.ts` (or a QA sweep) to notice a
 * specific request path stopped wiring itself.
 */

const PAGE_DATA_PATH = "src/lib/page-data.ts";
const PAGE_DATA_SRC = readFileSync(PAGE_DATA_PATH, "utf8");

/** Every function `src/lib/page-data.ts` exports, in source order. */
function pageDataExports(): string[] {
  return [
    ...PAGE_DATA_SRC.matchAll(/^export async function ([A-Za-z0-9_]+)/gm),
  ].map((m) => m[1]);
}

/**
 * The source text from `fn`'s own declaration up to the next exported
 * function's declaration (or the end of the file) — a stand-in for "`fn`'s
 * body" that does not need to track braces, because every private helper in
 * this file is declared *before* the first export (verified by reading the
 * file — `contextForRequest`, `viewerFor`, `signInPathForRequest` all sit
 * above `loadPage`), so no other function's real code can land inside this
 * slice.
 */
function bodyOf(fn: string, allExports: string[]): string {
  const start = PAGE_DATA_SRC.indexOf(`export async function ${fn}`);
  const next = allExports[allExports.indexOf(fn) + 1];
  const end = next
    ? PAGE_DATA_SRC.indexOf(`export async function ${next}`, start + 1)
    : PAGE_DATA_SRC.length;
  return PAGE_DATA_SRC.slice(start, end);
}

/** See the docstring above for why these two are named rather than checked. */
const DOES_NOT_WIRE = new Set(["loadAdminPage", "loadFile"]);

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

test("every application entry point src/lib/page-data.ts exports wires before it can need the port", () => {
  const exportsFound = pageDataExports();
  // If this fails, page-data.ts's export shape changed — the regex above
  // expects `export async function NAME`, the only shape this file uses
  // today.
  expect(exportsFound.length).toBeGreaterThan(0);

  for (const fn of exportsFound) {
    if (DOES_NOT_WIRE.has(fn)) continue;
    expect(bodyOf(fn, exportsFound), `${fn} calls ensureCryptoWired`).toContain(
      "ensureCryptoWired(",
    );
  }
});

test("DOES_NOT_WIRE names only functions that are real exports and genuinely do not wire", () => {
  const exportsFound = pageDataExports();
  for (const fn of DOES_NOT_WIRE) {
    expect(exportsFound, `${fn} is still exported by page-data.ts`).toContain(fn);
    expect(
      bodyOf(fn, exportsFound),
      `${fn} does not call ensureCryptoWired`,
    ).not.toContain("ensureCryptoWired(");
  }
});
