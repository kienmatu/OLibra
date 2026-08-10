import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { filesUnder } from "../support/source-text";

/**
 * Task 11 (QA remediation): a DOM audit of `/tu-sach/<slug>/quan-ly/sach/<slug>`
 * on 2026-08-10 found twelve `<button type="submit">` elements with
 * `inForm: false` — "Đánh giá", "Báo mất", "Ngừng dùng" on every non-lost
 * copy row, twice over (once in the desktop table, once in the mobile card).
 * Clicking any of them did nothing, silently. This is the guard against that
 * recurring anywhere else under `src/app`.
 *
 * **Why the twelve did not say `type="submit"` anywhere in the source, and
 * what that means for this check.** The offending elements were
 * `<Button variant="quiet" size="sm">…</Button>` — the styled component from
 * `src/components/ui/button.tsx`, wrapping a plain `<button>` with no `type`
 * prop at all. HTML's own default for a `<button>`'s `type` is **`submit`**
 * whether or not the attribute is written — that is exactly how the DOM audit
 * above measured `type="submit"` on an element whose JSX never spells the
 * word. A check that only looked for the literal text `type="submit"` (or
 * `<SubmitButton>`, this codebase's client-side wrapper that always renders
 * one) would therefore have found *none* of the twelve — the actual failure
 * mode this test exists to catch. So a `<button>` or `<Button>` tag with no
 * `type=` attribute at all counts as a submit control here too, unless it
 * carries `disabled` — a statically-disabled control (the pagination edges on
 * `quan-ly/sach`, `quan-ly/nguoi-doc`, `danh-muc`; the deliberately-inert "Xin
 * mượn" placeholder on the reader-facing book page) cannot be clicked at all,
 * which is a different, intentional thing from a live-looking button that
 * silently does nothing, and is not what this test is for.
 *
 * **The check, restated precisely.** For every `.tsx` file under `src/app`,
 * walk the source left to right and track whether the cursor is currently
 * inside an opened-but-unclosed `<form>`. Four token shapes matter:
 *
 * - `<form` opens one level, `</form>` closes one level (never below zero —
 *   an extra stray `</form>` is not this test's problem to diagnose).
 * - `<SubmitButton` — this codebase's client-side wrapper
 *   (`src/components/ui/submit-button.tsx`) — always renders `type="submit"`
 *   internally, so any occurrence at form depth zero is a violation.
 * - A `<button …>` or `<Button …>` tag (matched up to its first `>`, which is
 *   safe here — see the note on that below) is a violation at form depth zero
 *   *unless* its own attribute text contains `disabled` or an explicit
 *   `type="button"`/`type="reset"`.
 *
 * A file whose every submit-shaped control is inside a `<form>` passes.
 *
 * **Known, accepted gaps — crude but sufficient, matching this file's own
 * mandate.** The tag-matching regex reads from `<button`/`<Button` to the
 * *first* `>`, which would misfire on a tag containing an arrow function
 * (`=>`) in an inline prop before that point. No tag in this codebase's
 * `src/app` does that today — checked directly — and the failure mode if one
 * ever did would be a false *negative* (the scan resumes mid-attribute-list),
 * not a crash. Comments are stripped before scanning (block and line, not
 * strings) so a docstring's own prose about `<button>` cannot trip the check
 * — several files in this app discuss the very defect this test guards
 * against, in comments, by name.
 *
 * **The regex-extraction lesson this branch already learned once.**
 * `tests/architecture/every-domain-command-has-a-caller.test.ts` shipped
 * matching `export (async )?function NAME`, a pattern that matched nothing in
 * fifty files this codebase actually writes as `export const NAME: Command<`
 * — so its first run was green for the wrong reason, on every one of the five
 * command families it was built to catch. This file's own extraction pattern
 * is exercised the same way that one now pins its own: the "falsification"
 * test below reintroduces a form-less submit control and asserts the main
 * test goes red, so a future rewrite of this codebase's button shapes cannot
 * silently return this check to "passing because it matches nothing".
 */

/** Block and line comments removed, string literals left untouched — the
 *  opposite of `stripCommentsAndStrings` in `../support/source-text.ts`,
 *  which this check cannot use: it has to read literal attribute text like
 *  `type="submit"`, which that helper replaces with `""`. Copied in shape
 *  from `a-wired-page-renders-no-fixtures.test.ts`'s own `withoutComments`,
 *  which needs the identical treatment for the identical reason (a docstring
 *  discussing `<button>` in prose must not read as a real tag) and is not
 *  extracted to `../support/` for the same reason that file gives for not
 *  sharing with `stripCommentsAndStrings`: two helpers one word apart on a
 *  shared name would be a hazard, and two callers is not yet enough to
 *  justify it. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** One `<form`/`</form>`/`<button …>`/`<Button …>`/`<SubmitButton` token, in
 *  source order. The tag-shaped alternatives read up to their first `>`,
 *  which this file's own docstring records the one known limitation of. */
const TOKEN = /<form\b|<\/form>|<button\b[^]*?>|<Button\b[^]*?>|<SubmitButton\b/g;

const DISABLED_OR_NON_SUBMIT = /\bdisabled\b|\btype\s*=\s*(["'])(?:button|reset)\1/;
const HAS_ANY_TYPE_ATTR = /\btype\s*=/;

/** 1-indexed line number of `index` in `text`. */
function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Every `file:line` where a submit-shaped control sits outside any
 *  enclosing `<form>`. */
function formlessSubmitControls(source: string): string[] {
  const text = withoutComments(source);
  let depth = 0;
  const violations: number[] = [];

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];

    if (token === "</form>") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (token.startsWith("<form")) {
      depth += 1;
      continue;
    }

    const isSubmitButtonWrapper = token.startsWith("<SubmitButton");
    const isSubmitShaped =
      isSubmitButtonWrapper ||
      (!DISABLED_OR_NON_SUBMIT.test(token) &&
        (HAS_ANY_TYPE_ATTR.test(token)
          ? /\btype\s*=\s*(["'])submit\1/.test(token)
          : true));

    if (isSubmitShaped && depth === 0) violations.push(match.index);
  }

  return violations.map((index) => String(lineAt(text, index)));
}

test("every submit control under src/app is lexically inside a <form>", () => {
  const files = filesUnder("src/app").filter((f) => f.endsWith(".tsx"));

  const violations = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return formlessSubmitControls(source).map((line) => `${file}:${line}`);
  });

  expect(violations).toEqual([]);
});

test("the check can fail: a reintroduced form-less submit control is caught", () => {
  // The falsification this file's own docstring promises, run inline rather
  // than by editing a real page and reverting it by hand. Three shapes, one
  // each: a bare `<button>` (no `type=`, HTML's own default is `submit`), an
  // explicit `<Button type="submit">`, and `<SubmitButton>` — none of them
  // inside a `<form>`. All three are exactly what shipped on
  // `quan-ly/sach/[id]/page.tsx` before this task, restated as a fixture
  // instead of a citation.
  const stillDead = `
    export default function Dead() {
      return (
        <div>
          <button>Đánh giá</button>
          <Button type="submit" variant="quiet" size="sm">Báo mất</Button>
          <SubmitButton>Ngừng dùng</SubmitButton>
        </div>
      );
    }
  `;
  expect(formlessSubmitControls(stillDead)).toEqual(["5", "6", "7"]);

  // The same three, now each inside its own `<form>` — the shape every one of
  // the twelve took after this task's fix — must be silent.
  const fixed = `
    export default function Fixed() {
      return (
        <div>
          <form action={a}><button type="submit">Đánh giá</button></form>
          <form action={b}><Button type="submit" variant="quiet" size="sm">Báo mất</Button></form>
          <form action={c}><SubmitButton>Ngừng dùng</SubmitButton></form>
        </div>
      );
    }
  `;
  expect(formlessSubmitControls(fixed)).toEqual([]);

  // A statically-disabled control is deliberately not a violation — see this
  // file's header for the pagination-edge and "Xin mượn" cases this exempts.
  const disabled = `<Button size="sm" disabled>Trước</Button>`;
  expect(formlessSubmitControls(disabled)).toEqual([]);

  // Nor is a `<button>` whose author opted out explicitly.
  const explicitlyNotSubmit = `<button type="button" onClick={go}>Đóng</button>`;
  expect(formlessSubmitControls(explicitlyNotSubmit)).toEqual([]);
});
