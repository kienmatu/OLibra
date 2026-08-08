import type { Sql } from "postgres";
import {
  books,
  donations,
  loans,
  lostCopies,
  readers,
  shelf as primaryShelf,
  shelves,
} from "../lib/fixtures";

/**
 * Reproduces `src/lib/fixtures.ts` in a real database (DATABASE.md §9). The
 * point of this function is the equivalence, not the mechanism: every
 * screen in the application currently renders from the fixtures module, and
 * pointing the same screens at Postgres instead must change nothing visible
 * — see `tests/db/seed.test.ts`, which is the test that keeps that promise
 * honest as both sides evolve.
 *
 * Runs the whole thing inside one transaction with `set local role
 * olibra_admin`. RLS (0010_rls.sql) forces the tenant policy onto every
 * scoped table, this shelf included, and the seed genuinely needs to write
 * across all four fixture shelves in one pass — the alternative would be
 * `set_config('olibra.bookshelf_id', ...)` before every single insert,
 * re-set every time the shelf being written changes as the id maps below
 * are threaded through. `olibra_admin` is the role 0010 built for exactly
 * this ("cross-shelf super-admin queries run as that role, deliberately and
 * explicitly"); `set local` keeps the bypass scoped to this transaction, so
 * it never leaks onto a connection some other caller reuses afterwards.
 *
 * Idempotent: every insert that a later step depends on by id uses
 * `on conflict ... do update ... returning id`, never `do nothing` — a
 * `do nothing` that hits its conflict returns no row, which breaks the next
 * step's id map on a second run. `loans` is the one table with a natural
 * arbiter for a bare `on conflict do nothing` (INV-1's
 * `loans_one_active_per_copy`, 0009): rerunning the seed re-attempts the
 * same (copy_id, 'active') row, which collides with that partial unique
 * index and is silently skipped, correctly. `book_donations` has no unique
 * index at all — nothing on that table would ever collide, so a bare
 * `on conflict do nothing` there would silently double the rows on every
 * rerun, exactly the "idempotent-looking but isn't" trap. It gets an
 * explicit `insert ... select ... where not exists (...)` keyed on
 * `(donor_membership_id, description)` instead, which is unique across
 * every donation in the fixture.
 */
export async function seed(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`set local role olibra_admin`;

    // ── 1. Shelves ──────────────────────────────────────────────────────
    // Each shelf's own `parishTaxonomy` goes into `settings.parish_taxonomy`
    // (§4.2) — not left on the database default, which is what
    // "each shelf keeps its own parish taxonomy" in the seed test checks.
    const bookshelfIdBySlug = new Map<string, string>();
    for (const s of shelves) {
      const settings = {
        parish_taxonomy: {
          levels: s.parishTaxonomy.levels,
          nested: s.parishTaxonomy.nested,
          level1_label: s.parishTaxonomy.level1Label,
          level2_label: s.parishTaxonomy.level2Label,
        },
      };
      const [row] = await tx<{ id: string }[]>`
        insert into bookshelves (
          slug, name, location, opening_hours, keeper_name, keeper_phone, settings
        )
        values (
          ${s.slug}, ${s.name}, ${s.location}, ${s.hours}, ${s.keeper}, ${s.phone},
          ${tx.json(settings)}
        )
        on conflict (slug) do update set
          name          = excluded.name,
          location      = excluded.location,
          opening_hours = excluded.opening_hours,
          keeper_name   = excluded.keeper_name,
          keeper_phone  = excluded.keeper_phone,
          settings      = excluded.settings
        returning id
      `;
      bookshelfIdBySlug.set(s.slug, row.id);
    }
    const dongThapId = bookshelfIdBySlug.get(primaryShelf.slug)!;

    // ── 2. Categories ───────────────────────────────────────────────────
    // The fixed twelve-row list from DATABASE.md §4.3. Deliberately seeded
    // here rather than in 0012_indexes.sql — see that migration's own
    // header comment for why a migration cannot carry data that
    // resetDatabase() truncates.
    const categoryIdBySlug = new Map<string, string>();
    for (const c of CATEGORIES) {
      const [row] = await tx<{ id: string }[]>`
        insert into categories (slug, name, sort_order)
        values (${c.slug}, ${c.name}, ${c.sortOrder})
        on conflict (slug) do update set
          name = excluded.name, sort_order = excluded.sort_order
        returning id
      `;
      categoryIdBySlug.set(c.slug, row.id);
    }

    // ── 3. Parish units, two passes ─────────────────────────────────────
    // Every fixture unit's `id` ("dt-gh-thanh-tam") is a stable string for
    // cross-referencing within fixtures.ts, not a real uuid — remember
    // which real row each fixture id became, and which shelf owns it (the
    // latter is what lets step 5 place a reader on the right shelf below).
    const unitIdByFixtureId = new Map<string, string>();
    const shelfSlugByUnitFixtureId = new Map<string, string>();

    for (const s of shelves) {
      const bookshelfId = bookshelfIdBySlug.get(s.slug)!;
      const level1 = s.parishUnits.filter((u) => u.level === 1);
      const level2 = s.parishUnits.filter((u) => u.level === 2);

      // Pass 1: every level-1 unit has parent_id null
      // (parish_units_l1_has_no_parent), so none of these depend on
      // anything inserted in this loop.
      for (const u of level1) {
        const [row] = await tx<{ id: string }[]>`
          insert into parish_units (
            bookshelf_id, level, parent_id, name, sort_order, deleted_at
          )
          values (${bookshelfId}, 1, null, ${u.name}, ${u.sortOrder}, ${u.deletedAt})
          on conflict (bookshelf_id, level, parent_id, name)
          do update set sort_order = excluded.sort_order
          returning id
        `;
        unitIdByFixtureId.set(u.id, row.id);
        shelfSlugByUnitFixtureId.set(u.id, s.slug);
      }

      // Pass 2: a nested level-2 unit's parent_id resolves through the map
      // pass 1 just built. An unnested shelf's level-2 units carry
      // parentId: null in the fixture already, so this same insert handles
      // both without branching on shelf.parishTaxonomy.nested.
      for (const u of level2) {
        const parentId = u.parentId ? unitIdByFixtureId.get(u.parentId)! : null;
        const [row] = await tx<{ id: string }[]>`
          insert into parish_units (
            bookshelf_id, level, parent_id, name, sort_order, deleted_at
          )
          values (${bookshelfId}, 2, ${parentId}, ${u.name}, ${u.sortOrder}, ${u.deletedAt})
          on conflict (bookshelf_id, level, parent_id, name)
          do update set sort_order = excluded.sort_order
          returning id
        `;
        unitIdByFixtureId.set(u.id, row.id);
        shelfSlugByUnitFixtureId.set(u.id, s.slug);
      }
    }

    // ── 4. Books and copies ─────────────────────────────────────────────
    // Every book in the fixture is Tủ sách Đồng Tháp stock — none of the
    // `books` / `loans` / `lostCopies` fixtures carry a shelf of their own,
    // and DB §9 names Đồng Tháp specifically as the shelf the seed matches.
    const bookIdBySlug = new Map<string, string>();
    for (const b of books) {
      const categoryId = categoryIdForBookCategory(b.category, categoryIdBySlug);
      const description = b.description.join("\n\n");
      const [row] = await tx<{ id: string }[]>`
        insert into books (
          bookshelf_id, category_id, title, slug, author, publisher,
          published_year, page_count, description, is_published
        )
        values (
          ${dongThapId}, ${categoryId}, ${b.title}, ${b.slug}, ${b.author},
          ${b.publisher}, ${b.year}, ${b.pages}, ${description}, true
        )
        on conflict (bookshelf_id, slug) do update set
          title          = excluded.title,
          category_id    = excluded.category_id,
          author         = excluded.author,
          publisher      = excluded.publisher,
          published_year = excluded.published_year,
          page_count     = excluded.page_count,
          description    = excluded.description
        returning id
      `;
      bookIdBySlug.set(b.slug, row.id);
    }

    // A copy's state is worked out by hand in fixtures.ts's own comments:
    // every code in `loans` is on_loan, every code in `lostCopies` is lost,
    // DT-0112 is the one held copy (reserved via the borrow-request queue,
    // which this seed does not otherwise populate), a `retired` book's
    // remaining codes are retired, and everything left over is available.
    const onLoanCodes = new Set(loans.map((l) => l.code));
    const lostByCode = new Map(lostCopies.map((c) => [c.code, c]));
    const HELD_CODES = new Set(["DT-0112"]);

    const copyIdByCode = new Map<string, string>();
    for (const b of books) {
      const bookId = bookIdBySlug.get(b.slug)!;
      const codes = expandCopyCodes(b.codes, b.copiesTotal);
      for (const code of codes) {
        let state: string = "available";
        let lostReportedAt: string | null = null;
        let retiredAt: string | null = null;
        let retiredReason: string | null = null;

        const lost = lostByCode.get(code);
        if (onLoanCodes.has(code)) {
          state = "on_loan";
        } else if (lost) {
          state = "lost";
          lostReportedAt = parseShortDate(lost.reportedOn);
        } else if (HELD_CODES.has(code)) {
          state = "held";
        } else if (b.status === "retired") {
          // fixtures.ts carries no date for when this happened, only the
          // fact that it did (`status: "retired"`) — `retired_at` stays
          // unset, `retired_reason` is required by
          // book_copies_retired_has_reason and gets a generic one.
          state = "retired";
          retiredReason = "Ngừng lưu hành";
        }

        const [row] = await tx<{ id: string }[]>`
          insert into book_copies (
            bookshelf_id, book_id, code, state,
            lost_reported_at, retired_at, retired_reason
          )
          values (
            ${dongThapId}, ${bookId}, ${code}, ${state},
            ${lostReportedAt}, ${retiredAt}, ${retiredReason}
          )
          on conflict (bookshelf_id, code) do update set
            state             = excluded.state,
            lost_reported_at  = excluded.lost_reported_at,
            retired_at        = excluded.retired_at,
            retired_reason    = excluded.retired_reason
          returning id
        `;
        copyIdByCode.set(code, row.id);
      }
    }

    // ── 5. Members ───────────────────────────────────────────────────────
    // fixtures.ts: "Most readers below carry ids from `shelf`" (Đồng Tháp);
    // three ("đức", "hoà", "tuấn") carry ids from the other three shelves
    // specifically so those shelves describe a real reader too. A reader's
    // shelf is therefore derived from which shelf owns their level-1 unit,
    // defaulting to Đồng Tháp for a reader with no unit set at all (Phanxicô
    // Nguyễn Văn Lộc) — he is one of the primary list, not one of the three.
    const SEED_PASSWORD_HASH = "seed$not-a-real-hash$replace-once-real-auth-lands";

    const userIdByReaderId = new Map<string, string>();
    const membershipIdByReaderId = new Map<string, string>();

    for (const r of readers) {
      const [userRow] = await tx<{ id: string }[]>`
        insert into users (
          username, password_hash, saint_name, full_name,
          date_of_birth, father_name, mother_name, phone
        )
        values (
          ${r.username}, ${SEED_PASSWORD_HASH}, ${r.saintName}, ${r.fullName},
          ${parseFullDate(r.born)}, ${r.father}, ${r.mother}, ${r.phone}
        )
        on conflict ((lower(username))) where deleted_at is null and username is not null
        do update set
          saint_name    = excluded.saint_name,
          full_name     = excluded.full_name,
          date_of_birth = excluded.date_of_birth,
          father_name   = excluded.father_name,
          mother_name   = excluded.mother_name,
          phone         = excluded.phone
        returning id
      `;
      userIdByReaderId.set(r.id, userRow.id);

      const shelfSlug = r.parishUnitL1Id
        ? (shelfSlugByUnitFixtureId.get(r.parishUnitL1Id) ?? primaryShelf.slug)
        : primaryShelf.slug;
      const bookshelfId = bookshelfIdBySlug.get(shelfSlug)!;
      const l1 = r.parishUnitL1Id ? unitIdByFixtureId.get(r.parishUnitL1Id)! : null;
      const l2 = r.parishUnitL2Id ? unitIdByFixtureId.get(r.parishUnitL2Id)! : null;

      const [memberRow] = await tx<{ id: string }[]>`
        insert into memberships (
          bookshelf_id, user_id, role, status, parish_unit_l1_id, parish_unit_l2_id
        )
        values (${bookshelfId}, ${userRow.id}, 'reader', ${r.membership}, ${l1}, ${l2})
        on conflict (bookshelf_id, user_id) do update set
          status            = excluded.status,
          parish_unit_l1_id = excluded.parish_unit_l1_id,
          parish_unit_l2_id = excluded.parish_unit_l2_id
        returning id
      `;
      membershipIdByReaderId.set(r.id, memberRow.id);
    }

    // The keeper named on the shelf ("Maria Nguyễn Thị Lan") is reader
    // "lan" — the activity log fixture's "Bạn đã cho ... mượn" entries are
    // narrated from her point of view, so her user id stands in for
    // `lent_by` on every loan the seed writes.
    const lenderId = userIdByReaderId.get("lan")!;

    // ── 6. Loans ─────────────────────────────────────────────────────────
    // `loans.status` is UI shorthand for "onloan" vs "overdue" — in the
    // database both are simply 'active' (DATABASE.md §6: overdue is
    // computed on read from `due_on`, never stored).
    for (const l of loans) {
      const bookId = bookIdBySlug.get(l.bookSlug)!;
      const copyId = copyIdByCode.get(l.code)!;
      const borrowerId = userIdByReaderId.get(l.readerId)!;
      await tx`
        insert into loans (
          bookshelf_id, copy_id, book_id, borrower_id, lent_by, lent_at, due_on, status
        )
        values (
          ${dongThapId}, ${copyId}, ${bookId}, ${borrowerId}, ${lenderId},
          ${parseShortDate(l.borrowedOn)}, ${parseShortDate(l.dueOn)}, 'active'
        )
        on conflict do nothing
      `;
    }

    // ── 7. Donations ─────────────────────────────────────────────────────
    // `donations` carries every status (pending, received, declined), not
    // only the manager's pending queue — all of it round-trips into
    // book_donations. There is no unique index on this table (unlike
    // loans), so idempotency is explicit: skip a donation that already
    // matches the same donor and description rather than relying on a
    // conflict that can never fire.
    for (const d of donations) {
      const donorMembershipId = membershipIdByReaderId.get(d.readerId)!;
      const photoUrl = d.hasPhoto ? `/donations/${d.id}.jpg` : null;
      const decidedAt = d.decidedOn ? parseShortDate(d.decidedOn) : null;
      const decidedBy: string | null = d.status === "pending" ? null : lenderId;
      const createdAt = parseShortDate(d.submittedOn);

      await tx`
        insert into book_donations (
          bookshelf_id, donor_membership_id, description, photo_url, estimated_count,
          status, decided_by, decided_at, decision_note, created_at
        )
        select
          ${dongThapId}, ${donorMembershipId}, ${d.description}, ${photoUrl},
          ${d.estimatedCount ?? null}, ${d.status}, ${decidedBy}, ${decidedAt},
          ${d.decisionNote ?? null}, ${createdAt}
        where not exists (
          select 1 from book_donations
          where donor_membership_id = ${donorMembershipId}
            and description = ${d.description}
        )
      `;
    }
  });
}

// ── Reference data ──────────────────────────────────────────────────────

/** DATABASE.md §4.3's fixed twelve-row list. */
const CATEGORIES = [
  { slug: "van-hoc-thieu-nhi", name: "Văn học thiếu nhi", sortOrder: 10 },
  { slug: "van-hoc-viet-nam", name: "Văn học Việt Nam", sortOrder: 20 },
  { slug: "van-hoc-nuoc-ngoai", name: "Văn học nước ngoài", sortOrder: 30 },
  { slug: "truyen-tranh", name: "Truyện tranh", sortOrder: 40 },
  { slug: "tho", name: "Thơ", sortOrder: 50 },
  { slug: "lich-su", name: "Lịch sử", sortOrder: 60 },
  { slug: "dia-ly", name: "Địa lý", sortOrder: 70 },
  { slug: "khoa-hoc-thuong-thuc", name: "Khoa học thường thức", sortOrder: 80 },
  { slug: "ky-nang-song", name: "Kỹ năng sống", sortOrder: 90 },
  { slug: "sach-dao", name: "Sách đạo", sortOrder: 100 },
  { slug: "tu-dien-tra-cuu", name: "Từ điển, tra cứu", sortOrder: 110 },
  { slug: "khac", name: "Khác", sortOrder: 999 },
] as const;

/**
 * `books[].category` is free text in the fixture ("Thơ thiếu nhi" for
 * Góc Sân Và Khoảng Trời), and one value — that one — has no exact match
 * among the twelve seeded categories, only a prefix match against "Thơ".
 * Exact match first, then a "starts with the category name" fallback, then
 * null rather than guessing further.
 */
function categoryIdForBookCategory(
  name: string,
  categoryIdBySlug: Map<string, string>,
): string | null {
  const exact = CATEGORIES.find((c) => c.name === name);
  if (exact) return categoryIdBySlug.get(exact.slug) ?? null;
  const prefix = CATEGORIES.find((c) => name.startsWith(`${c.name} `));
  if (prefix) return categoryIdBySlug.get(prefix.slug) ?? null;
  return null;
}

// ── Parsing helpers ─────────────────────────────────────────────────────

/** "12/05/2015" (dd/mm/yyyy) -> "2015-05-12". */
function parseFullDate(input: string): string {
  const [d, m, y] = input.split("/");
  return `${y}-${m}-${d}`;
}

/**
 * Every other date in the fixture is "dd/mm", sometimes with leading text
 * ("Chúa nhật 20/08"), and carries no year — the fixture's own dates
 * (loans, donations, announcements) are all written as though the current
 * year is 2026, matching the environment this seed is written against.
 */
function parseShortDate(input: string, year = 2026): string {
  const match = input.match(/(\d{2})\/(\d{2})\s*$/);
  if (!match) throw new Error(`seed: cannot parse date "${input}"`);
  const [, d, m] = match;
  return `${year}-${m}-${d}`;
}

/**
 * "DT-0140 – DT-0142" (a range) or "DT-0087" (one code) or "DT-0033" with
 * `copiesTotal: 2` (one code standing in for the start of a short run) —
 * fixtures.ts is not literal about enumerating every code for a book with
 * more than one copy, so a single code plus a total greater than one is
 * treated as the start of a sequential run of that length.
 */
function expandCopyCodes(codes: string, total: number): string[] {
  const range = codes.match(/^([A-Za-z]+-)(\d+)\s*–\s*(?:[A-Za-z]+-)?(\d+)$/);
  if (range) {
    const [, prefix, startStr, endStr] = range;
    const width = startStr.length;
    const start = Number(startStr);
    const end = Number(endStr);
    const result: string[] = [];
    for (let n = start; n <= end; n++) {
      result.push(`${prefix}${String(n).padStart(width, "0")}`);
    }
    return result;
  }

  const single = codes.match(/^([A-Za-z]+-)(\d+)$/);
  if (!single) throw new Error(`seed: cannot parse copy codes "${codes}"`);
  const [, prefix, numStr] = single;
  const width = numStr.length;
  const start = Number(numStr);
  const result: string[] = [];
  for (let i = 0; i < total; i++) {
    result.push(`${prefix}${String(start + i).padStart(width, "0")}`);
  }
  return result;
}
