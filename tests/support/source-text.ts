import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading source as text, for the architecture tests.
 *
 * These two helpers were copied byte-for-byte between
 * `tests/architecture/boundaries.test.ts` and `storage-speaks-s3.test.ts`, and
 * the copy carried a disclaimer pointing at a description of the gaps that
 * existed only in the other file. One definition, one disclaimer.
 */

/** Every `.ts`/`.tsx` file under `dir`, recursively, as repo-relative paths. */
export function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/**
 * Crude removal of block comments, line comments, and string literals.
 *
 * The architecture checks need it more than they might appear to. They look for
 * things like `Bun.` and `process.env.`, and the modules being checked
 * *document* those things — `src/storage/s3.ts` explains at length why it reads
 * the environment from exactly one place, naming `process.env` several times in
 * prose above the function. Counting raw occurrences would fail a module for
 * explaining itself, which is the wrong incentive to build into a suite.
 *
 * Not a parser, and it does not claim to be one. Known gaps:
 *
 * - Block comments are stripped *before* strings, so a string literal
 *   containing a slash-star sequence is read as the start of a block comment
 *   and everything up to the next comment-close marker — including real code —
 *   is deleted as if it were a comment. That is a false negative rather than a
 *   crash, and it happens nowhere in this repository today.
 * - Line comments are stripped before strings too, now (see below), and are
 *   guarded against a `:` immediately before the `//` so `"http://…"` and
 *   `"postgres://…"` survive — but a string containing `//` with no `:`
 *   before it (`"a//b"`) would still be misread as a comment start and
 *   truncate the rest of its line. Also nowhere in this repository today.
 * - An expression embedded in a template literal (`` `${Bun.file()}` ``) is
 *   stripped along with the surrounding backticks, so usage written that way is
 *   missed.
 *
 * Callers that check for a specific token should say which further evasions
 * they knowingly do not catch; see `storage-speaks-s3.test.ts`.
 *
 * **Line comments run right after block comments, before any string is
 * touched — moved there by QA remediation Task 26's code review, and not
 * where this function shipped.** The order used to be block comments, then
 * every kind of string, then line comments last — deliberately, "so a `//`
 * inside a string … has already been replaced and can't be mistaken for a
 * comment marker". That protected strings from line comments, but left line
 * comments exposed to strings in the other direction: this codebase's own
 * `//` docstrings are prose thick with English contractions ("shelf's",
 * "editor's", "form's"), and the double/single-quote regexes below run before
 * comments are gone, so an apostrophe inside a comment reads as an opening
 * quote and pairs with the next unrelated `'` anywhere later in the file —
 * deleting every real line between them, silently, as if the whole span were
 * one string literal.
 *
 * Measured against `src/app/quan-tri/tu-sach/page.tsx` on this branch
 * (Task 25, 2026-08-10 QA remediation): a `//`-comment containing "shelf's"
 * paired with a quote deep inside a later JSX comment and ate roughly 170
 * real lines in between, including a legitimate `export const metadata`
 * line — confirmed by walking the five `.replace()` calls one at a time and
 * watching `metadata` disappear exactly at the single-quote step. A second,
 * independent instance shipped in the same diff:
 * `src/app/tu-sach/[shelf]/ho-so/tong-quan/page.tsx`'s own `export const
 * metadata` line was equally swallowed. Neither was caught by
 * `tests/architecture/every-page-has-a-title.test.ts` itself, which used a
 * local, differently-ordered `withoutComments` rather than this function —
 * but any future caller of *this* function, searching for a token that
 * happens to land inside one of those two files' swallowed spans, would have
 * been silently wrong.
 *
 * Re-ordering closes the bug at its root instead of asking every caller to
 * route around it: once line comments are gone, no apostrophe inside one is
 * still there for the string-stripping passes to misread. The guard against
 * `:`-prefixed `//` is the same one `pages-reading-the-database-are-
 * dynamic.test.ts`'s own local `withoutComments` already uses for the
 * identical reason, so this function and that one now agree rather than
 * disagreeing about which of two defensible orderings is correct.
 *
 * Checked against the full suite after reordering, per QA remediation
 * Task 26's controller notes: every test that calls this function
 * (`boundaries.test.ts`, `storage-speaks-s3.test.ts`, `the-front-door-shows-
 * no-keeper-contact.test.ts`, `every-page-has-a-title.test.ts`,
 * `tests/domain/kernel/audit-actions.test.ts`) still passes, unchanged.
 *
 * **The list above named three for a while (QA remediation T27).** The
 * first omission was this function's own fourth caller at the moment that
 * sentence was written: `every-page-has-a-title.test.ts` switched from a
 * local `withoutComments` to this shared helper in the identical commit
 * that added the sentence, so it was already part of the "148 files, 1363
 * tests" the commit message counts — named nowhere in the parenthetical all
 * the same. The second is `audit-actions.test.ts`, a caller for an
 * unrelated reason: it keeps its own local `withoutComments` for its actual
 * comparison (that file matches string literals, which this function
 * deliberately erases) but imports this one specifically to demonstrate why
 * — `test("stripCommentsAndStrings is not what this file uses, and why")`
 * calls it directly on a one-line sample. A caller proving a helper is the
 * wrong tool is still a caller.
 */
export function stripCommentsAndStrings(source: string): string {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
      .replace(/(^|[^:])\/\/.*$/gm, "$1") // line comments — before any string
      // is stripped, so an apostrophe inside one is gone before the quote
      // passes below can misread it as an opening quote. Guarded against a `:`
      // immediately before the `//`, so a still-quoted `"http://…"` or
      // `"postgres://…"` is not itself mistaken for a comment start.
      .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
      .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
      .replace(/`(?:[^`\\]|\\.)*`/g, "``")
  ); // template literals
}
