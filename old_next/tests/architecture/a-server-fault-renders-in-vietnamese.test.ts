import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { ERROR_STATES, SERVER_FAULT } from "../../src/lib/error-states";

/**
 * BR §17.7: error pages "carry plain-language Vietnamese explanations and a
 * route back to safety", server failure among the five it names.
 *
 * **This became reachable in U1.** Before this slice no page touched Postgres,
 * so no page could 500 and the requirement had nothing to bind to;
 * `src/app/loi/page.tsx` drew the panel and nothing routed to it. Measured in
 * production at `af55e95`: a fault rendered Next.js's own default, "This page
 * couldn't load / A server error occurred.", in English, with a black Reload
 * button.
 *
 * Read as source text, like every other test in this directory, and for the
 * same reason: there is no React renderer in this suite (`vitest` runs in
 * `node`, and nothing here pulls in a DOM). What can be checked is that the
 * files exist, that they are the shape Next requires of a boundary, and that
 * the words on them are the project's own rather than a second draft.
 */

const BOUNDARIES = ["src/app/error.tsx", "src/app/global-error.tsx"];

test("a server fault has a boundary to render into", () => {
  // The defect verbatim: neither of these files existed, so the framework's
  // English fallback was the shipped answer for the first slice whose pages
  // could fail.
  expect(BOUNDARIES.filter((f) => !existsSync(f))).toEqual([]);
});

test("each boundary is a client component, which is what makes it a boundary", () => {
  // Next only treats these as error boundaries when they are client
  // components — `reset` is a function the framework passes in and React
  // recovers by re-rendering. A `"use server"` or a plain server component here
  // is a build error in some versions and a silently inert file in others, and
  // "silently inert" is precisely the state this file is about.
  for (const file of BOUNDARIES) {
    expect(readFileSync(file, "utf8").trimStart(), file).toMatch(
      /^["']use client["']/,
    );
  }
});

test("global-error.tsx supplies the html and body its layout no longer will", () => {
  // It replaces the root layout rather than rendering inside it, so the
  // document element and body are its own to provide. Without them the page
  // renders as nothing at all — the failure mode of the file that exists to
  // catch a failure.
  const source = readFileSync("src/app/global-error.tsx", "utf8");
  expect(source).toMatch(/<html\b/);
  expect(source).toMatch(/<body\b/);
});

test("the boundary and the reference sheet say the same thing, not two versions of it", () => {
  // `loi/page.tsx` drew a server-failure panel for months before anything could
  // trigger one. The point of `src/lib/error-states.ts` is that the boundary
  // renders *that* panel — identity, not a copy that starts out equal.
  expect(ERROR_STATES).toContain(SERVER_FAULT);
  expect(SERVER_FAULT.heading).toBe("Tủ sách đang gặp trục trặc");

  // And every sentence a volunteer reads there is Vietnamese. The English
  // default this replaced is the exact string being ruled out.
  const words = `${SERVER_FAULT.heading} ${SERVER_FAULT.body} ${SERVER_FAULT.action}`;
  expect(words).not.toMatch(/server error|couldn't load|Reload/i);
  // A diacritic is the cheapest evidence the copy was not quietly replaced with
  // an English draft that happens to avoid those three phrases.
  expect(words).toMatch(/[ăâđêôơưÁ-ỹ]/);
});
