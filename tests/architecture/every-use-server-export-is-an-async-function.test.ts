import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  filesUnder,
  isServerActionModule,
  stripComments,
  stripCommentsAndStrings,
} from "../support/source-text";

/**
 * PO feedback round 1, Task 13's second fix round. `src/app/quan-tri/
 * admin-actions.ts` exported `contactsFromForm`, a plain synchronous
 * form-parsing helper, from a file whose first line was `"use server"`. Next
 * treats every top-level export of such a file as a Server Action, and SWC's
 * own `action-validate.js` refuses to compile one that is not `async` — which
 * means the file did not build under Turbopack at all. `bun run check` never
 * noticed: to `tsc` the directive is an inert string-expression statement, no
 * `eslint-config-next` rule covers it, and Vitest loads the module as plain
 * ESM with no bundler-level validation in between. Worse, `tests/lib/
 * admin-actions.test.ts` imported `contactsFromForm` directly and asserted on
 * it twice, green both times, because a test importing a function has no way
 * to notice the enclosing file's directive.
 *
 * This is source-text, not a build. It cannot run SWC's real validator
 * without a `next build`, so it re-derives the same rule directly from what
 * `action-validate.js` actually checks — every export of a `"use server"`
 * module must be an async function — and applies it to plain text, the same
 * trade every other file in this directory already makes for a check that
 * must run inside `bun run check` rather than `bun run build`.
 *
 * **Discovery, not a list.** `isServerActionModule` (`../support/
 * source-text.ts`) is the same directive-position regex `tests/architecture/
 * pages-reading-the-database-are-dynamic.test.ts` already used to decide
 * where its own database-reach walk should stop — moved to shared support
 * once this file needed the identical question asked of every route file
 * rather than just the ones a page happens to import. A hard-coded file list
 * would go stale the moment a tenth action module is added; this walks
 * `src/` itself and asks each file the question fresh.
 */
const DIRECTIVE_FILES = filesUnder("src").filter((f) =>
  isServerActionModule(readFileSync(f, "utf8")),
);

/**
 * Every export SWC's own validator would see, read off `stripCommentsAndStrings`
 * so a mention of `export const` inside a docstring cannot be mistaken for a
 * real one — matched at column zero, because every export in this codebase's
 * Prettier formatting starts a line unindented, and an export nested inside a
 * function body (which `action-validate.js` does not treat as a top-level
 * binding either) never does.
 *
 * Classification, not detection: every branch below is a **verdict**, not
 * merely a match, because a line this function does not recognise at all is
 * exactly the shape of export a future TypeScript syntax could introduce
 * without this file's author noticing — `unrecognised` fails loudly rather
 * than silently passing the file through.
 */
type Verdict =
  "ok" | "type-only" | "not-async-function" | "re-export" | "unrecognised";

function classify(exportLine: string): Verdict {
  const line = exportLine.trim();
  // Type-only exports are erased before SWC ever asks whether a binding is a
  // function — `export type Foo = …`, `export interface Foo { … }`, and
  // `export type { Foo }` (a type-only re-export) all vanish at compile time
  // and carry no runtime value for the Server Actions rule to apply to.
  if (/^export\s+type\b/.test(line)) return "type-only";
  if (/^export\s+interface\b/.test(line)) return "type-only";
  if (/^export\s+default\b/.test(line)) return "not-async-function";
  if (/^export\s+async\s+function\b/.test(line)) return "ok";
  if (/^export\s+function\b/.test(line)) return "not-async-function";
  if (/^export\s+(?:const|let|var|class)\b/.test(line)) return "not-async-function";
  // `export { … }` (with or without `from`) and `export * from …` are
  // re-export forms: whatever they name was already a binding somewhere
  // else, so this line itself declares no function at all, async or not.
  if (/^export\s*\{/.test(line)) return "re-export";
  if (/^export\s*\*/.test(line)) return "re-export";
  return "unrecognised";
}

/** Every top-level `export …` line, exactly as it starts — one per statement. */
function topLevelExportLines(source: string): string[] {
  return stripCommentsAndStrings(source)
    .split("\n")
    .filter((line) => /^export\b/.test(line));
}

test('at least one module in src/ carries a "use server" directive', () => {
  // A regex that matches nothing still passes every test below vacuously —
  // this is what stops that. Nine files carry the directive as of this
  // writing (nine `actions.ts`/`profile-actions.ts`/`reader-actions.ts`/
  // `community-actions.ts` siblings under src/app); five is a floor with
  // headroom, not a pin to the exact count, so adding or consolidating an
  // action file does not itself break this test.
  expect(DIRECTIVE_FILES.length).toBeGreaterThanOrEqual(5);
});

test("the contacts-from-form extraction actually removed the directive, not just the export", () => {
  // Task 13's fix moved `contactsFromForm` out of `admin-actions.ts` into
  // this file specifically so it would stop being a "use server" export.
  // Pinning that the file is not discovered is what actually verifies the
  // directive is gone — verifying only that `contactsFromForm` is async
  // elsewhere would pass even if this file had accidentally kept (or
  // regained) a stray "use server" prologue of its own.
  const path = DIRECTIVE_FILES.find((f) =>
    f.endsWith("quan-tri/contacts-from-form.ts"),
  );
  expect(path).toBeUndefined();
});

test('every top-level export of a "use server" module is an async function', () => {
  const offenders: string[] = [];
  for (const file of DIRECTIVE_FILES) {
    const source = readFileSync(file, "utf8");
    for (const line of topLevelExportLines(source)) {
      const verdict = classify(line);
      if (verdict === "ok" || verdict === "type-only") continue;
      offenders.push(`${file}: ${line.trim()}  (${verdict})`);
    }
  }
  expect(offenders).toEqual([]);
});

test('a "use server" string outside directive position is a defect, not a no-op', () => {
  // The opposite failure to the one above: a developer who *means* to declare
  // a directive but writes it after another statement, or inside a function
  // body meant to gate one call rather than the whole module, gets a file
  // that silently is not a Server Actions module at all — no compile error,
  // just every export in it failing at the call site with a runtime message
  // instead. `stripComments` (not `stripCommentsAndStrings`) removes comments
  // only, leaving quoted strings intact, so a real `"use server"` statement
  // sitting in the wrong place is still visible to search for — the same
  // search a docstring merely *mentioning* the directive (this repository has
  // one, in `contacts-from-form.ts`'s own header comment) must not trip,
  // which is exactly what stripping comments first guarantees.
  const stray: string[] = [];
  for (const file of filesUnder("src")) {
    const raw = readFileSync(file, "utf8");
    if (isServerActionModule(raw)) continue; // already correctly a directive
    if (/["']use server["']/.test(stripComments(raw))) stray.push(file);
  }
  expect(stray).toEqual([]);
});
