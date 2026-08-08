import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Two cues BR §17 specifies by name, both of which this project has now lost
 * once each in a rewrite that was otherwise an improvement.
 *
 * That is the pattern worth a guard rather than either cue on its own. The
 * condition picker's check mark survived from the fixture era until the
 * CSS-only radio rewrite dropped it while keeping the fill and the border; the
 * in-flight disable was unmeetable while the buttons submitted nothing and was
 * simply not added on the day they started to. Neither loss is visible in a
 * diff that is mostly about wiring a query.
 *
 * Source text, like the rest of this directory: there is no React renderer in
 * this suite. So these assert the mechanism a person types, and they are
 * deliberately about *which* mechanism — a check drawn with client JavaScript,
 * or a pending state hand-rolled with `useState`, would be a different
 * decision and should have to be made deliberately.
 */

const RETURN_PAGE = "src/app/tu-sach/[shelf]/quan-ly/nhan-tra/page.tsx";

const CONFIRM_FORMS = [
  "src/app/tu-sach/[shelf]/quan-ly/cho-muon/xac-nhan/page.tsx",
  RETURN_PAGE,
  "src/app/tu-sach/[shelf]/quan-ly/nhan-tra/bao-mat/page.tsx",
];

test("the condition picker shows selection with a check, not with colour alone", () => {
  // BR §17.4:648, verbatim: "Selection is shown by a filled background **and a
  // check**, not by colour alone." The fill (`has-checked:bg-terracotta/10`)
  // was never lost; the check was. Colour on its own is what the requirement
  // rules out, which is why the fill passing is not evidence.
  const source = readFileSync(RETURN_PAGE, "utf8");

  // Anchored to a `className`, not to the bare token. Written the loose way
  // first, this passed against a page whose only remaining `peer-checked:flex`
  // was in a comment explaining why it was there — a guard that reads the
  // reasoning instead of the code, which is the failure mode this whole
  // directory is meant to avoid.
  expect(source).toMatch(/className="[^"]*peer-checked:flex/);
  expect(source).toMatch(/<Check\b/);
  // And still no client JavaScript on this screen for it. The `peer` sibling
  // selector is what makes that possible, and it only works because the radio
  // precedes the badge in the DOM — a fact a reorder would silently break.
  expect(source).toMatch(/className="peer sr-only"/);
  expect(source).not.toMatch(/^\s*["']use client["']/m);
});

test("every confirm button in the lending flow disables itself while in flight", () => {
  // BR §17.7: "Every button that triggers a change disables itself and shows a
  // spinner while in flight, which also prevents the double-submit that would
  // otherwise create duplicate loans." These are the three buttons it names.
  //
  // Checked as "goes through `SubmitButton`" rather than as "mentions
  // pending", because the property that matters is that all three share one
  // implementation of it — three private readings of `useFormStatus` is how
  // two of them end up correct.
  for (const file of CONFIRM_FORMS) {
    const source = readFileSync(file, "utf8");
    expect(source, file).toMatch(/<SubmitButton\b/);
    // A plain submit `<Button>` left behind in the same file would be one of
    // these buttons that quietly still double-submits.
    expect(source, file).not.toMatch(/<Button\b[\s\S]*?type="submit"/);
  }
});
