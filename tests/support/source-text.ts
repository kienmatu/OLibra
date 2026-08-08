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
 * - An expression embedded in a template literal (`` `${Bun.file()}` ``) is
 *   stripped along with the surrounding backticks, so usage written that way is
 *   missed.
 *
 * Callers that check for a specific token should say which further evasions
 * they knowingly do not catch; see `storage-speaks-s3.test.ts`.
 */
export function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals
    .replace(/\/\/.*$/gm, ""); // line comments (after strings, so a "//"
  // inside a string — e.g. a URL — has already been replaced and can't be
  // mistaken for a comment marker)
}
