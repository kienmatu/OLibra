import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/**
 * IMPORTANT 4. `bookshelves_public_read` (20260808_12_bookshelves_public_read
 * .sql) widens `select` on `bookshelves` to any active, undeleted row for
 * *any* caller — Row Level Security is row-level, so once a policy admits a
 * shelf's row, every column on it is readable through that same query, not
 * only the two the portal is specified to show. DATABASE.md §4.2 names the
 * consequence directly: "What this policy stops protecting, and what has to
 * protect it instead" — the column surface is now entirely the query's job.
 * BR §16.1 withholds keeper contact, and OPERATIONS.md §3.1 already forbids
 * the tempting shortcut of joining the full row in and trimming it
 * client-side, since that still puts it on the wire.
 *
 * Chosen over the reviewer's other suggestion (a `security_invoker`
 * directory view the portal query must go through): there is no portal
 * query yet to route through one — `src/app/tu-sach/page.tsx` still renders
 * from `src/lib/fixtures.ts` (README's "Status" table: no database behind
 * the UI yet outside identity/session). A view with nothing calling it
 * would be unverifiable scaffolding. This test, by contrast, runs today,
 * costs nothing while there is no caller, and fails the moment a future
 * portal (or any other unauthenticated-reachable) query does the thing BR
 * §16.1 forbids — the same "grep the diff for a known-dangerous shape"
 * approach `tests/architecture/boundaries.test.ts` already uses and this
 * codebase already trusts.
 *
 * `src/auth/guards.ts` is exempt: `resolveShelfId` already selects only
 * `id`, and it is the one place resolving a slug *before* any session or
 * membership is known — the reason `bookshelves_public_read` exists at all.
 * `src/db/seed.ts` is exempt too: it runs as `olibra_admin`, writing the
 * fixture shelves in the first place, not serving a request.
 *
 * `src/domain/catalogue/copy-codes.ts` (B1) is exempt for a different
 * reason: it reads `settings` deliberately, to resolve a shelf's
 * `copy_code_prefix` override (`policy.ts`'s `copyCodePrefix`), and it only
 * ever runs inside `allocateCopyCodes`, itself only reachable from a
 * `Command` already past `requireManager` — never from an unauthenticated
 * path `bookshelves_public_read` was written for. `settings` is read into a
 * local variable and never appears in a command's `result` or `audit`; only
 * the two-or-three-letter prefix derived from it does.
 */

const EXEMPT_FILES = new Set([
  "src/auth/guards.ts",
  "src/db/seed.ts",
  "src/domain/catalogue/copy-codes.ts",
]);

// The whole point of §16.1: a person with no membership has no business
// knowing these. Not exhaustive of every column on the table — just the
// ones the finding's own live reproduction named — but that is the same
// "known-dangerous shape" scope boundaries.test.ts already accepts.
const WITHHELD_COLUMNS = ["keeper_phone", "keeper_name", "settings", "created_by"];

function filesUnder(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(filesUnder(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

test("no non-exempt code path selects every column, or a withheld one, from bookshelves", () => {
  const offenders: string[] = [];

  for (const file of filesUnder("src")) {
    const relative = file.replace(process.cwd() + "/", "");
    if (EXEMPT_FILES.has(relative)) continue;

    const source = readFileSync(file, "utf8");
    if (!/from\s+bookshelves\b/i.test(source)) continue;

    if (/select\s+\*\s+from\s+bookshelves\b/i.test(source)) {
      offenders.push(`${relative}: "select *" against bookshelves`);
      continue;
    }

    for (const column of WITHHELD_COLUMNS) {
      // A loose same-file check, not a per-statement parser (same trade-off
      // stripCommentsAndStrings's own comment in boundaries.test.ts makes):
      // good enough to catch the shape the live reproduction found, not a
      // guarantee against every way SQL could be assembled.
      const mentionsColumn = new RegExp(`\\b${column}\\b`).test(source);
      if (mentionsColumn) {
        offenders.push(
          `${relative}: selects withheld column "${column}" in a file that also queries bookshelves`,
        );
      }
    }
  }

  expect(offenders).toEqual([]);
});
