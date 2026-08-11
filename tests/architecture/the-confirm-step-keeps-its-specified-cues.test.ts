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

const BOOK_PAGE = "src/app/tu-sach/[shelf]/(doc-gia)/sach/[slug]/page.tsx";

test("the borrow button is alive, and cannot be double-tapped into two requests", () => {
  // **The successor to "the dead borrow button says why nothing happened".**
  // That test pinned a pairing — a natively `disabled` "Xin mượn" and the
  // sentence under it apologising — and named its own end condition in as many
  // words: "C2 removes the note and the `disabled` attribute together; until
  // then the pairing has to hold." U8 is where that happened, so the pairing is
  // replaced by the property that matters now.
  //
  // What it guards is a regression with a very quiet diff: re-adding `disabled`
  // (or dropping the form back to a bare `<Button>`) leaves a page that renders
  // identically in a screenshot and writes nothing.
  const source = readFileSync(BOOK_PAGE, "utf8");

  // The button posts, and posts to the borrow-request action specifically —
  // `createBorrowRequest` had no caller at all for two slices, and the
  // architecture test that catches *that* only checks the command is named
  // somewhere in `src/app`.
  expect(source).toMatch(/<form action=\{requestBorrowAction\}/);
  // Through `SubmitButton`, which is BR §17.7's rule and not decoration here:
  // `createBorrowRequest`'s own docstring records that there is no unique index
  // behind `duplicate_request`, so two taps in the same second really do write
  // two pending rows and put one child twice in one queue. The in-flight
  // disable is what closes the case the screen can actually produce.
  // Anchored to the form rather than to a character count: the button carries
  // an `icon={...}` block between the two, and a distance threshold is a test
  // that fails the day somebody reformats.
  expect(source).toMatch(
    /<form action=\{requestBorrowAction\}[\s\S]*?<SubmitButton/,
  );
  expect(source).toMatch(/\{isAvailable \? "Xin mượn" : "Đăng ký chờ mượn"\}/);
  // And the apology is gone with the `disabled` attribute it explained.
  //
  // **Against `withoutComments`, not the raw file**, because the page's own
  // docstring recounts what was removed and quotes the sentence by name —
  // documentation this test would otherwise forbid anyone from writing. It is
  // the same blind spot `every-domain-command-has-a-caller.test.ts` describes
  // at length, pointed the other way: there a prose mention made an unused
  // command look called, here it would make a removed one look present. The
  // JSX text these assertions are really about is not a string literal, so it
  // survives the strip and the check still bites.
  const code = withoutComments(source);
  expect(code).not.toMatch(/BORROW_NOTE_ID/);
  expect(code).not.toMatch(/Nút này chưa dùng được/);
  expect(code).not.toMatch(/<Button[^>]*\bdisabled\b/);
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
