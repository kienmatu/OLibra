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
 * `src/auth/guards.ts` needs no exemption at all: `resolveShelfId` selects
 * only `id`, so it never mentions a withheld column, and it is the one place
 * resolving a slug *before* any session or membership is known — the reason
 * `bookshelves_public_read` exists at all. `src/db/seed.ts` needs none
 * either: it writes fixture rows with `insert into bookshelves`, never
 * `... from bookshelves`, so the guard's own trigger condition never fires
 * for it — it runs as `olibra_admin`, seeding data, not serving a request.
 * Neither appears in `EXEMPT_COLUMNS` below; if either one ever grows a
 * `select ... from bookshelves` that names a withheld column, it should be
 * caught like anything else, not waved through by a leftover entry.
 *
 * `src/domain/catalogue/copy-codes.ts` (B1) is exempt for a different
 * reason: it reads `settings` deliberately, to resolve a shelf's
 * `copy_code_prefix` override (`policy.ts`'s `copyCodePrefix`), and it only
 * ever runs inside `allocateCopyCodes`, itself only reachable from a
 * `Command` already past `requireManager` — never from an unauthenticated
 * path `bookshelves_public_read` was written for. `settings` is read into a
 * local variable and never appears in a command's `result` or `audit`; only
 * the two-or-three-letter prefix derived from it does.
 *
 * `src/domain/catalogue/queries/get-book-detail.ts` (B1 Task 5) is exempt for
 * the same shape of reason: it reads `settings` to resolve BR §5.5's
 * `public_show_current_borrower` and `public_name_display` overrides, and it
 * only ever runs past `requireReader` — a membership of *this* shelf, never
 * the unauthenticated portal path `bookshelves_public_read` protects against.
 * `settings` itself never appears in the returned `BookDetail`; only the two
 * booleans/strings derived from it (whether `currentLoan` is null, and which
 * of the borrower's names to show) do.
 *
 * `src/domain/members/parish-context.ts` (B2a Task 2) is exempt for the same
 * shape of reason, with one difference worth naming: `loadParishContext` is
 * *not* gated behind `requireReader` itself (its caller `getParishUnits` is,
 * but the B2a plan is explicit that `RegisterMembership` calls
 * `loadParishContext` directly, inside its own transaction, precisely so a
 * guest filling out the registration form can have their selection validated
 * without ever being handed the unit list through a reader-gated query). So
 * this file's `settings` read genuinely is reachable from an unauthenticated
 * path — but what BR §16.1 withholds is `keeper_phone`, `keeper_name` and
 * `created_by`; a shelf's parish taxonomy (how many levels, what they are
 * called) is not the fact this guard exists to protect, and `toTaxonomy`
 * never returns the `settings` value itself, only the four derived fields
 * (`levels`, `nested`, `level1Label`, `level2Label`) it reads out of it.
 *
 * **IMPORTANT 4 (fix-report, 2026-08-08-b1-catalogue): the exemption below is
 * per-column, not per-file.** All three justifications above are for reading
 * `settings`, and only `settings`, out of these files — none of them are a
 * blanket "trust this whole file" pass. A whole-file exemption skipped the
 * `select *` check and the *other* withheld columns too, in a file that
 * genuinely earns an exemption for exactly one of them: changing
 * `get-book-detail.ts` to select `keeper_phone`, `keeper_name` and
 * `created_by` alongside `settings` left the guard green — verified live.
 * `select *` is never exempt, for any file, regardless of this map.
 */

const EXEMPT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "src/domain/catalogue/copy-codes.ts": ["settings"],
  "src/domain/catalogue/queries/get-book-detail.ts": ["settings"],
  "src/domain/members/parish-context.ts": ["settings"],
};

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

test("no code path selects every column, or a withheld one it is not individually exempted for, from bookshelves", () => {
  const offenders: string[] = [];

  for (const file of filesUnder("src")) {
    const relative = file.replace(process.cwd() + "/", "");

    const source = readFileSync(file, "utf8");
    if (!/from\s+bookshelves\b/i.test(source)) continue;

    // IMPORTANT 4: "select *" is never exempt, for any file — unlike the
    // per-column check below, there is no column list that could make a
    // wildcard select safe.
    if (/select\s+\*\s+from\s+bookshelves\b/i.test(source)) {
      offenders.push(`${relative}: "select *" against bookshelves`);
      continue;
    }

    // Per-file, per-column — not a whole-file `continue` the way this used
    // to read. A file earning an exemption for `settings` still has every
    // other withheld column, and its own `select *`, checked normally.
    const allowedColumns = new Set(EXEMPT_COLUMNS[relative] ?? []);

    for (const column of WITHHELD_COLUMNS) {
      if (allowedColumns.has(column)) continue;
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
