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
 * **A second, related shape, added after a review round caught it live on
 * this same task.** `quan-ly/sach/[id]/page.tsx`'s "Thêm bản" disclosure was
 * a `<form>` with a submit control and **no `action`** — lexically inside a
 * form, so the first version of this check passed it, and functionally worse
 * than the twelve above: submitting it triggers the browser's default GET,
 * which serialises every field into a query string on the current URL and
 * discards it. The manager sees a page reload that looks like it worked. A
 * form is not "wired" merely by existing; it has to have somewhere to send
 * the submission. So this file now also asserts every `<form>` containing a
 * submit-shaped control declares an `action` — a server action reference
 * (`action={someAction}`) or a route (`action="/path"` or a template
 * literal); this check only tests for the *attribute's presence*, not where
 * it points, matching the "crude but sufficient" mandate the rest of this
 * file already accepts.
 *
 * **The check, restated precisely.** For every `.tsx` file under `src/app`,
 * walk the source left to right, tracking a stack of booleans — one per
 * currently-open `<form>`, recording whether *that* form's own opening tag
 * contains `action=`. Five token shapes matter:
 *
 * - `<form …>` (read up to its first `>`, same caveat as the button tags
 *   below) pushes `true` or `false` onto the stack, depending on whether its
 *   own attribute text contains `action=`.
 * - `</form>` pops the stack (never below empty — a stray extra `</form>` is
 *   not this test's problem to diagnose).
 * - `<SubmitButton` — this codebase's client-side wrapper
 *   (`src/components/ui/submit-button.tsx`) — always renders `type="submit"`
 *   internally, so an occurrence with an empty stack, or whose nearest
 *   enclosing form's `action` flag is `false`, is a violation.
 * - A `<button …>` or `<Button …>` tag is the same violation under the same
 *   condition, *unless* its own attribute text contains `disabled` or an
 *   explicit `type="button"`/`type="reset"`.
 *
 * A file where every submit-shaped control is inside a `<form>` that itself
 * declares an `action` passes.
 *
 * **One named exemption, for a form that legitimately has neither.**
 * `/quan-tri/quan-ly-vien`'s shelf picker is `<form method="get">` with no
 * `action` at all — the browser's own default for an omitted `action` is "GET
 * to the current URL", which is exactly the "reload this page carrying
 * `?tu-sach=`" behaviour that form's own comment describes; spelling
 * `action={pathname}` out by hand would be the identical behaviour with more
 * code. Exempted by the exact `file:line` of the submit control it contains
 * — the same granularity every reported violation uses — so a *different*
 * violation in that same file still fails, the way
 * `every-domain-command-has-a-caller.test.ts`'s `EXEMPT` names individual
 * files rather than turning a blind eye to a whole directory.
 *
 * **Known, accepted gaps — crude but sufficient, matching this file's own
 * mandate.** The tag-matching regex reads from `<form`/`<button`/`<Button` to
 * the *first* `>`, which would misfire on a tag containing an arrow function
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
 * test below reintroduces both a form-less submit control and a form with a
 * submit control and no `action`, and asserts the main test goes red on each,
 * so a future rewrite of this codebase's button or form shapes cannot
 * silently return this check to "passing because it matches nothing".
 */

/**
 * Block and line comments removed, string literals left untouched — the
 * opposite of `stripCommentsAndStrings` in `../support/source-text.ts`,
 * which this check cannot use: it has to read literal attribute text like
 * `type="submit"`, which that helper replaces with `""`. Copied in shape
 * from `a-wired-page-renders-no-fixtures.test.ts`'s own `withoutComments`
 * (a docstring discussing `<button>` in prose must not read as a real tag),
 * and not extracted to `../support/` for the same reason that file gives for
 * not sharing with `stripCommentsAndStrings`: two helpers one word apart on
 * a shared name would be a hazard, and two callers is not yet enough to
 * justify it.
 *
 * **One deliberate divergence from the file it was copied from, found in
 * review.** That version collapses a whole block comment to a single space,
 * which is fine when nothing downstream counts lines — but this file reports
 * violations as `file:line`, and this codebase's docstrings routinely run to
 * forty or fifty lines. Collapsing one to a single space shifts every line
 * number after it earlier by however many lines the comment had, silently:
 * the first version of this file did exactly that, and its reported
 * `file:line`s for the RED run against the pre-fix page pointed at the wrong
 * lines (verified by diffing against `git show`, after the fact). So this
 * blanks a block comment's *content* character-by-character but keeps every
 * `\n` inside it — same visual shape stripped, same line count preserved,
 * still nothing left that could match a tag.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** One `<form …>`/`</form>`/`<button …>`/`<Button …>`/`<SubmitButton` token,
 *  in source order. The tag-shaped alternatives read up to their first `>`,
 *  which this file's own docstring records the one known limitation of. */
const TOKEN =
  /<form\b[^]*?>|<\/form>|<button\b[^]*?>|<Button\b[^]*?>|<SubmitButton\b/g;

const DISABLED_OR_NON_SUBMIT = /\bdisabled\b|\btype\s*=\s*(["'])(?:button|reset)\1/;
const HAS_ANY_TYPE_ATTR = /\btype\s*=/;
const HAS_ACTION_ATTR = /\baction\s*=/;

/** 1-indexed line number of `index` in `text`. */
function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/**
 * Every `file:line` where a submit-shaped control sits outside any
 * enclosing `<form>`, or inside one that declares no `action`.
 */
function formlessSubmitControls(source: string): string[] {
  const text = withoutComments(source);
  // One entry per currently-open <form>: whether *that* form's own tag has
  // an `action=`. Forms do not nest in valid HTML/JSX, so this is never
  // more than one deep in practice, but a stack rather than a single
  // boolean costs nothing and does not assume that.
  const formHasAction: boolean[] = [];
  const violations: number[] = [];

  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];

    if (token === "</form>") {
      formHasAction.pop();
      continue;
    }
    if (token.startsWith("<form")) {
      formHasAction.push(HAS_ACTION_ATTR.test(token));
      continue;
    }

    const isSubmitButtonWrapper = token.startsWith("<SubmitButton");
    const isSubmitShaped =
      isSubmitButtonWrapper ||
      (!DISABLED_OR_NON_SUBMIT.test(token) &&
        (HAS_ANY_TYPE_ATTR.test(token)
          ? /\btype\s*=\s*(["'])submit\1/.test(token)
          : true));
    if (!isSubmitShaped) continue;

    // No enclosing form at all, or the nearest enclosing one has no
    // `action` — either is the same outcome for a manager: nothing happens,
    // or a discarded reload that looks like something did.
    const enclosingForm = formHasAction.at(-1);
    if (enclosingForm === undefined || enclosingForm === false) {
      violations.push(match.index);
    }
  }

  return violations.map((index) => String(lineAt(text, index)));
}

/**
 * `/quan-tri/quan-ly-vien`'s shelf picker — see this file's own header for
 * why `<form method="get">` with no `action` is the correct, deliberate
 * shape here rather than an oversight. Keyed to the exact submit control's
 * `file:line`, matching what `formlessSubmitControls` reports, so a
 * different, real violation added to this same file later still fails.
 */
const EXEMPT_NO_ACTION = new Set<string>([
  "src/app/quan-tri/quan-ly-vien/page.tsx:198", // "Xem bạn đọc" — GET-to-self shelf picker.
]);

test("every submit control under src/app is lexically inside a <form> with an action", () => {
  const files = filesUnder("src/app").filter((f) => f.endsWith(".tsx"));

  const violations = files.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return formlessSubmitControls(source)
      .map((line) => `${file}:${line}`)
      .filter((entry) => !EXEMPT_NO_ACTION.has(entry));
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

  // The same three, now each inside its own `<form>` with a real `action` —
  // the shape every one of the twelve took after this task's fix — must be
  // silent.
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

test("the check can fail: a form with a submit control and no action is caught", () => {
  // The second falsification, added after a review round caught this exact
  // shape live on `quan-ly/sach/[id]/page.tsx`'s "Thêm bản" — see this
  // file's own header. Lexically inside a `<form>`, which is why the first
  // version of this check missed it; the form itself has nowhere to send
  // the submission.
  const noAction = `
    export default function NoAction() {
      return (
        <form className="mt-4">
          <SubmitButton>Lưu bản mới</SubmitButton>
        </form>
      );
    }
  `;
  expect(formlessSubmitControls(noAction)).toEqual(["5"]);

  // The same form, given somewhere to go, is silent.
  const withAction = `
    export default function WithAction() {
      return (
        <form action={addCopiesAction} className="mt-4">
          <SubmitButton>Lưu bản mới</SubmitButton>
        </form>
      );
    }
  `;
  expect(formlessSubmitControls(withAction)).toEqual([]);

  // A GET-to-self form is a real, exempted shape — see `EXEMPT_NO_ACTION` —
  // but the exemption is by `file:line`, not blanket permission for the
  // shape: this inline fixture (not the real file) is still caught.
  const getToSelf = `<form method="get"><SubmitButton>Xem</SubmitButton></form>`;
  expect(formlessSubmitControls(getToSelf)).toEqual(["1"]);
});
