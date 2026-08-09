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
 * `src/domain/circulation/commands/lend-copy.ts` (C1 Task 3) is exempt on the
 * narrowest version of the `copy-codes.ts` argument. It reads `settings` twice,
 * for BR §5.5's `max_concurrent_loans` and `loan_days`, and both reads are
 * `coalesce((settings->>'…')::int, n)` — an integer leaves the query, never
 * the JSON. It is a `Command`, so it is unreachable except through
 * `runCommand`, and its first statement is `requireManager`: there is no
 * unauthenticated path to it at all, which is the situation
 * `bookshelves_public_read` was widened for. Neither integer, nor anything
 * derived from `settings`, appears in its `result` or its `audit` beyond the
 * `due_on` the loan row itself already carries.
 *
 * `src/domain/circulation/commands/receive-return.ts` (C1 Task 4) is exempt on
 * exactly that argument, one step narrower still: it reads `settings` only for
 * BR §5.5's `hold_days`, only inside the branch where the manager asked to hold
 * the copy for a queued reader, and only as `coalesce((settings->>'hold_days')
 * ::int, 3)`. Same `requireManager`, same integer.
 *
 * Its absence from the command's output needs the same precision `lend-copy.ts`
 * uses above, and for the same reason: the integer never leaves, but something
 * *derived* from it does. `ReceiveReturnResult` carries only `loanId` and
 * `queuedRequestId`, neither of which touches `settings` — but `hold_expires_at`
 * is `clock.now() + hold_days` and it reaches both the `borrow_requests` row and
 * the `request.approved` audit entry. That is the same shape as `due_on` under
 * `lend-copy.ts`: a date computed from a shelf setting, not the setting, and not
 * `keeper_phone`, `keeper_name` or `created_by`, which are what BR §16.1
 * withholds and what this guard exists for.
 *
 * `src/lib/shelf.ts` (U1 Task 3) is the first exemption on the *surface* side
 * of the boundary rather than inside `src/domain`, and it is worth saying why
 * the argument still holds there. `readShelf` reads the shelf's name for the
 * manager chrome and BR §5.5's `max_concurrent_loans` for the lending screens,
 * the second as `coalesce((settings->>'max_concurrent_loans')::int, 3)` — the
 * identical read `lend-copy.ts` is already exempted for, producing the
 * identical integer. `ShelfPageData` carries that integer and the name;
 * `settings` itself never leaves the function, and nothing derived from it
 * beyond the integer does.
 *
 * The difference from the five entries above is real and does not rescue
 * itself: `readShelf` runs on the `Tx` `loadPage` hands a page, *before* any
 * `requireManager` in the query beside it, so unlike a `Command` body it is
 * genuinely reachable from a request with no session. What makes that
 * harmless is that it is reachable only with the *shelf's own id already
 * resolved* and only through `runQuery`'s scoped transaction — and, more to
 * the point, that nothing it returns reaches a response a stranger sees:
 * every page calling it also calls a manager-gated query, whose
 * `RuleViolated("not_permitted")` `loadPage` turns into a 404 before a byte
 * of HTML is rendered. The column list is what this guard protects, and this
 * one names two columns: `name`, which BR §16.1 publishes to the portal
 * anyway, and `settings`, which is exempted here and nowhere else on the
 * surface.
 *
 * `src/lib/shelf.ts` gains `keeper_name` and `keeper_phone` at U2 Task 4, for
 * `readShelfIdentity`, and those two are the columns this whole guard was
 * written about — so the entry needs a stronger argument than the `settings`
 * one above, not the same one again.
 *
 * It has one, and it is structural rather than circumstantial: unlike
 * `readShelf` beside it, `readShelfIdentity` calls `requireReader(ctx)` as its
 * first statement. The columns are therefore unreachable without an active
 * membership of *this* shelf, which is precisely the condition BR §16.1
 * attaches to them — §16.1 does not withhold keeper contact from everybody, it
 * puts it on the shelf's own page ("who holds the key with a tappable phone
 * number") and off the portal, and BR:179 calls the pair "shown publicly" in
 * the sense of "not a manager-only field". A member reading it is the specified
 * behaviour; a stranger reading it is what `list-public-shelves.ts` refuses by
 * naming three columns and taking no exemption at all.
 *
 * The exemption stays per-column: `settings` for `readShelf`, plus these two
 * for `readShelfIdentity`, and `created_by` is deliberately still not on the
 * list — it is a `users` id no shelf page has any use for, and a `select` of it
 * here should fail exactly as it would in any other file.
 *
 * `tests/lib/shelf-pages.test.ts` is the other half: it asserts a reader gets
 * the keeper's details and a guest is refused, so this file's argument ("it is
 * gated") is a fact about running code rather than a claim about a line
 * somebody could delete.
 *
 * Deliberately **not** solved by defaulting to 3 on the page. A shelf that
 * overrides `max_concurrent_loans` would then have its reader search block at
 * three while `lendCopy` allowed four — BR §16.3's screen-and-command
 * disagreement, in the direction that turns a child away from a book that is
 * actually there.
 *
 * `src/domain/portal/queries/list-public-shelves.ts` (U2 Task 1) is the query
 * this guard was written in anticipation of — the portal read that did not
 * exist when the note above said "there is no portal query yet to route
 * through one" — and it takes **no exemption at all**. That is the point
 * rather than an omission: it selects `slug`, `name` and `location`, none of
 * which is withheld, and it is the one code path in this project reachable by
 * a caller with no session and no membership anywhere. Every other entry in
 * the map below argues that its file is unreachable from an unauthenticated
 * path, or that nothing derived from the column leaves the function; neither
 * argument is available here, and neither is needed. An exemption on this file
 * would be an exemption on exactly the query where the withheld columns
 * matter.
 *
 * That has one consequence worth stating, because it looks like an evasion
 * otherwise: the check below is a regex over the whole file, comments
 * included, so that query's docstring discusses the keeper's contact details
 * in prose rather than by column name. It could have named them and claimed an
 * exemption for the mention — but the exemption is per column, not per
 * mention, and it would then be silent about a `select` of the same column one
 * edit later. Prose costs nothing and leaves the guard at full strength on the
 * file that most needs it.
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
 *
 * **IMPORTANT 2 (fix-report, 2026-08-09-u2-shelf-and-portal): the sentence
 * above was true and the check under it was not.** The regex read
 * `/select\s+\*\s+from\s+bookshelves\b/i`, which requires the wildcard and the
 * `from` clause to be adjacent and the table to be unaliased — and *every*
 * real query in this codebase aliases the table (`from bookshelves b`) and
 * writes its column list across several lines. So the one spelling a person
 * actually types was the one spelling the guard could not see. Verified live:
 * adding `loadPublicPage((tx) => tx`select b.* from bookshelves b`)` to the
 * portal page — a guest-callable read of `keeper_name`, `keeper_phone`,
 * `settings` and `created_by` on the front door — left this test green.
 *
 * `selectsWildcardFromBookshelves` below replaces it, and it looks at the
 * select *list* rather than at a fixed string: for each `from bookshelves`,
 * the text back to the nearest preceding `select` is the list, and a list
 * containing a bare `*` or an `alias.*` as one of its items is a wildcard
 * select however it is spaced or aliased. Every named-column form the old
 * regex caught is still caught, because that half was never the gap.
 *
 * The database now refuses the same thing independently:
 * `20260809_01_public_role.sql` grants `olibra_public` a *column-level*
 * `select` on five columns of `bookshelves`, so `select b.*` through
 * `runPublicQuery` raises `42501` at runtime whatever this file matches
 * (`tests/db/public-role-privileges.test.ts`). That is the stronger guarantee
 * and it does not make this one redundant: this fails when somebody types the
 * query, on *every* path including the tenant-scoped ones the public role
 * never touches, and it names the file in the failure.
 */

const EXEMPT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "src/domain/catalogue/copy-codes.ts": ["settings"],
  "src/domain/catalogue/queries/get-book-detail.ts": ["settings"],
  "src/domain/members/parish-context.ts": ["settings"],
  "src/domain/circulation/commands/lend-copy.ts": ["settings"],
  "src/domain/circulation/commands/receive-return.ts": ["settings"],
  "src/lib/shelf.ts": ["settings", "keeper_name", "keeper_phone"],
};

// The whole point of §16.1: a person with no membership has no business
// knowing these. Not exhaustive of every column on the table — just the
// ones the finding's own live reproduction named — but that is the same
// "known-dangerous shape" scope boundaries.test.ts already accepts.
const WITHHELD_COLUMNS = ["keeper_phone", "keeper_name", "settings", "created_by"];

/**
 * One item of a select list that is a wildcard: `*`, or `b.*`.
 *
 * Anchored on a comma or the start of the list on one side and a comma or the
 * end of it on the other, so `count(*)` — where the `*` is inside a call and
 * neither anchor holds — is not a wildcard select. That distinction is the
 * whole reason this looks at list *items* rather than for a `*` anywhere.
 */
const WILDCARD_ITEM = /(^|,)\s*(?:[a-z_][a-z0-9_$]*\s*\.\s*)?\*\s*(,|$)/i;

/**
 * Whether `source` contains a `select` whose list is (or includes) a wildcard
 * and whose `from` names `bookshelves`.
 *
 * Not a SQL parser, and the same trade-off `stripCommentsAndStrings` states
 * for itself in `boundaries.test.ts`: the select list is taken to be the text
 * between a `from bookshelves` and the nearest `select` before it. A subquery
 * between the two would make that the wrong span — there is none in this
 * codebase today, and the failure direction is a false positive (a wildcard in
 * the *outer* list counted against an inner `from bookshelves`), which is a
 * test somebody has to look at rather than a leak nobody sees.
 *
 * Comments are deliberately not stripped, exactly as the per-column check
 * below leaves them in: a docstring that spells out a wildcard select against
 * this table should trip the guard, and prose can always say it another way.
 * `list-public-shelves.ts`'s docstring already discusses the keeper's contact
 * details without naming the columns, for this same reason.
 */
function selectsWildcardFromBookshelves(source: string): boolean {
  const lower = source.toLowerCase();
  for (const match of lower.matchAll(/\bfrom\s+bookshelves\b/g)) {
    const before = lower.slice(0, match.index);
    const select = before.lastIndexOf("select");
    if (select === -1) continue;
    if (WILDCARD_ITEM.test(before.slice(select + "select".length))) return true;
  }
  return false;
}

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

    // IMPORTANT 4: a wildcard select is never exempt, for any file — unlike
    // the per-column check below, there is no column list that could make one
    // safe. IMPORTANT 2: `b.*` counts, and it is the spelling every query in
    // this codebase actually uses.
    if (selectsWildcardFromBookshelves(source)) {
      offenders.push(`${relative}: wildcard select against bookshelves`);
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

/**
 * IMPORTANT 2's own regression test.
 *
 * The sweep above is `toEqual([])` over a tree that currently contains no
 * wildcard select, so it passes identically against a detector that recognises
 * nothing at all — which is exactly the state this file shipped in, and how
 * `select b.*` on the front door went unnoticed. These cases are the detector's
 * two halves stated directly: the shapes it must catch, and the shapes it must
 * not, including the real column lists this codebase actually contains.
 */
test("the wildcard detector sees every spelling of a wildcard, and no false ones", () => {
  const caught = [
    "tx`select * from bookshelves`",
    // The live reproduction: aliased, and invisible to the old regex.
    "tx`select b.* from bookshelves b`",
    "tx`select b .* from bookshelves b`",
    // Across lines, which is how every query in this codebase is written.
    "tx`\n  select b.*\n  from bookshelves b\n  where b.slug = ${slug}\n`",
    // A wildcard mixed into a named list is still a wildcard.
    "tx`select b.*, c.name from bookshelves b join categories c on true`",
    "tx`select c.name, b.* from bookshelves b join categories c on true`",
    // Upper case, and irregular spacing.
    "tx`SELECT   B.*   FROM   BOOKSHELVES B`",
  ];
  for (const source of caught) {
    expect(selectsWildcardFromBookshelves(source), source).toBe(true);
  }

  const passed = [
    // `list-public-shelves.ts`, verbatim in shape.
    "tx`select b.slug, b.name, b.location from bookshelves b, term where b.status = 'active'`",
    // `readShelf`, verbatim in shape — a `*` nowhere, across lines.
    "tx`\n  select\n    name,\n    coalesce((settings->>'loan_days')::int, 14) as loan_days\n  from bookshelves\n  where id = ${id}\n`",
    // `count(*)` is not a wildcard select: the `*` is inside a call, so
    // neither of the detector's list-item anchors holds.
    "tx`select count(*) from bookshelves`",
    "tx`select count(*) as n, b.name from bookshelves b group by b.name`",
    // A wildcard over something that is not this table.
    "tx`select * from counted`",
    // Arithmetic, not a select list.
    "tx`select b.name from bookshelves b where b.id = ${a * b}`",
  ];
  for (const source of passed) {
    expect(selectsWildcardFromBookshelves(source), source).toBe(false);
  }
});
