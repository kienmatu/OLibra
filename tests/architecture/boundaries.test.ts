import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/**
 * Crude removal of block comments, line comments, and string literals.
 *
 * Not a parser — just enough to keep the Bun-usage check below from tripping
 * on a comment or string that merely contains the text "Bun.". Known gaps:
 * block comments are stripped *before* strings, so a string literal
 * containing a slash-star sequence is read as the start of a block comment,
 * and everything up to the next comment-close marker — including real code —
 * is deleted as if it were a comment. That is a false negative (code that
 * should have tripped the check silently vanishes instead), not a crash, and
 * it does not happen anywhere in this codebase today. An expression embedded
 * in a template literal
 * (`` `${Bun.file()}` ``) is stripped along with the surrounding backticks,
 * so usage written that way would also be missed. Good enough for a
 * same-repo architecture test; it is deliberately not a parser and makes no
 * claim to be one.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, "``") // template literals
    .replace(/\/\/.*$/gm, ""); // line comments (after strings, so a "//"
  // inside a string — e.g. a URL — has already been replaced and can't be
  // mistaken for a comment marker)
}

test("the domain imports no framework", () => {
  // G1 / SDD §3.1. This is what keeps the backend's location (SDD §3.4) a
  // reversible decision: the moment the domain imports `next/*`, moving it to
  // a separate service stops being a packaging change.
  //
  // Catches every form the specifier can arrive in: a static import/export
  // (`from "next/x"`), a side-effect import (`import "next/x"`), a dynamic
  // import (`import("next/x")`), and `require("next/x")`. The last
  // alternative catches a relative reach into src/app (`../../app/layout`)
  // as well as the `@/app/*` alias form — G1 forbids reaching into src/app
  // regardless of how the specifier is spelled, and a relative reach-up is
  // exactly what an editor autocompletes.
  const forbidden =
    /\b(?:from|import|require)\s*\(?\s*["'](?:next(?:\/|["'])|react|@\/app\/|\.\.\/(?:\.\.\/)*app\/)/;
  const offenders = filesUnder("src/domain")
    .filter((f) => forbidden.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});

test("the domain does not use Bun-specific APIs", () => {
  // G9. The runtime is Bun, but the build and the tests run on Node, and the
  // domain must stay runnable under both. Comments and strings are stripped
  // first so a comment like `// avoids Bun.file()` doesn't fail the test for
  // zero actual API usage.
  //
  // This is not the only backstop: eslint.config.mjs also restricts the
  // `Bun` global for src/domain/**/*.ts via `no-restricted-globals`. That
  // rule is new — this comment used to (incorrectly) point to "the ESLint
  // rule, which parses a real AST" as if it already covered this, but
  // no-restricted-imports only ever restricted import specifiers, never a
  // bare global reference like `Bun.file()`. Before the no-restricted-globals
  // rule was added, the only thing actually catching a stray `Bun.*` call was
  // `tsc` failing with TS2867 ("Cannot find name 'Bun'") — which holds only
  // because `@types/bun` is not installed; installing it would silently
  // remove that protection.
  const offenders = filesUnder("src/domain")
    .filter((f) => /\bBun\./.test(stripCommentsAndStrings(readFileSync(f, "utf8"))))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
