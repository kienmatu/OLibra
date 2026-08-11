import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/** Block and line comments out; string literals kept, since those are the subject. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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

/**
 * Task 11 (QA remediation) extracted the condition picker out of
 * `RETURN_PAGE` into its own component (`condition-picker.tsx`'s own
 * docstring has the reasoning: `nhan-tra` renders exactly one, the book
 * detail page renders one per copy row, and an `id`-based selector cannot
 * serve both). The cue this file guards moved with it — checked here rather
 * than left pointing at `RETURN_PAGE`, which would have this test keep
 * passing for the wrong reason the moment the markup it is actually reading
 * is gone from that file, the same failure mode its own docstring warns
 * against for "a guard that reads the reasoning instead of the code".
 */
const CONDITION_PICKER = "src/components/condition-picker.tsx";

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
  const source = readFileSync(CONDITION_PICKER, "utf8");

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

const BOOK_PAGE = "src/app/tu-sach/[shelf]/sach/[slug]/page.tsx";

test("the dead borrow button says why nothing happened, and says it to the button", () => {
  // IMPORTANT 7 (fix-report, 2026-08-09-u2-shelf-and-portal). "Xin mượn" is the
  // book page's dominant action — full-width terracotta, `size="lg"`,
  // `min-w-80`, the "One primary action per screen, visually dominant" BR:603
  // asks for — and it is dead until C2 wires borrow requests. Natively
  // `disabled`, so it is out of the tab order: a keyboard or switch user never
  // lands on it. It shipped with nothing under it at all, and two comments in
  // the same block disagreeing about whether there was.
  //
  // The same shape as the two cues above: BR names the audience ("children who
  // may have been reading fluently for only a few years", BR:601), the cue was
  // absent rather than wrong, and its absence is invisible in a diff that is
  // mostly about wiring a query. C2 removes the note and the `disabled`
  // attribute together; until then the pairing has to hold.
  const source = readFileSync(BOOK_PAGE, "utf8");

  // The `id` and the `aria-describedby` come from one constant, so the
  // attribute cannot end up pointing at nothing — which looks identical, to
  // everyone who can see the page, to pointing at something.
  expect(source).toMatch(/const BORROW_NOTE_ID = "[^"]+"/);
  expect(source).toMatch(/aria-describedby=\{BORROW_NOTE_ID\}/);
  expect(source).toMatch(/id=\{BORROW_NOTE_ID\}/);
  // And the note is real text under the button rather than an empty element
  // satisfying the two above.
  expect(source).toMatch(/id=\{BORROW_NOTE_ID\}[^>]*>\s*\n?\s*\S/);
});

test("an overdue loan is shown as overdue, not as an ordinary loan with a past date", () => {
  // Minor 9. `getBookDetail` returns `daysRemaining` off `loans_current`, where
  // it is signed and derived against `olibra_now()` on every read (BR §8). The
  // page already branched on its sign to decide whether to print "còn N ngày";
  // past the due date it printed nothing, so a book twenty-four days overdue
  // showed only "Hạn trả Thứ Năm, 16/07/2026." — a date in the past and no cue.
  //
  // `src/lib/status.ts` is explicit that this is allowed and where: "a screen
  // showing an overdue badge must have a *loan* in hand — never a copy row
  // alone." This page has the loan.
  const source = readFileSync(BOOK_PAGE, "utf8");

  // The badge, taken from the loan rather than from the title's aggregate copy
  // state — `statusForAvailability` cannot return "overdue" by construction.
  expect(source).toMatch(/isOverdue\s*\?\s*"overdue"\s*:\s*statusForAvailability/);
  // The word is `STATUS.overdue.label`, not a string typed here: BR:628 and
  // DESIGN.md both pair "Quá hạn" with the red alert-triangle, and a second
  // spelling on this page is how the two drift.
  expect(source).toMatch(/STATUS\.overdue\.label/);
  // Comments stripped first: the docstrings above and below discuss the word in
  // prose, and a guard that reads the reasoning instead of the code is the
  // failure mode this whole directory exists to avoid — the same correction the
  // condition-picker check above already carries.
  expect(withoutComments(source)).not.toMatch(/Quá hạn/);
});
