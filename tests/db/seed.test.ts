import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { books, donations, shelves } from "../../src/lib/fixtures";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("the seed reproduces the UI fixtures exactly", async () => {
  // G11 / DB §9. This equivalence is what makes swapping fixtures for the
  // database a configuration change rather than a rewrite — and this test is
  // what keeps it true as both sides evolve.
  await seed(sql);

  const seeded = await sql<{ slug: string }[]>`
    select slug from books order by slug
  `;
  expect(seeded.map((b) => b.slug)).toEqual([...books].map((b) => b.slug).sort());

  const seededShelves = await sql<{ slug: string }[]>`
    select slug from bookshelves order by slug
  `;
  expect(seededShelves.map((s) => s.slug)).toEqual(
    [...shelves].map((s) => s.slug).sort(),
  );
});

test("each shelf keeps its own parish taxonomy, not a shared default", async () => {
  // fixtures.ts is explicit about why: the four shelves are deliberately
  // shaped differently — one flat level, two nested, two flat (parish-
  // taxonomy design §2) — because a seed that flattened them to one shape
  // would hide exactly the bugs parish_units exists to catch. bookshelves
  // .settings is jsonb (DB §4.2); the seed writes each shelf's own
  // parishTaxonomy into it rather than leaving every shelf on the default.
  await seed(sql);

  for (const s of shelves) {
    const [row] = await sql<{ taxonomy: Record<string, unknown> }[]>`
      select settings -> 'parish_taxonomy' as taxonomy
      from bookshelves where slug = ${s.slug}
    `;
    expect(row.taxonomy).toEqual({
      levels: s.parishTaxonomy.levels,
      nested: s.parishTaxonomy.nested,
      level1_label: s.parishTaxonomy.level1Label,
      level2_label: s.parishTaxonomy.level2Label,
    });
  }
});

test("every shelf's parish units are seeded, including the one soft-deleted unit", async () => {
  // Counting deleted_at and all: DB §4.1 says a soft-deleted unit stops
  // being offered but is never removed, and the one deliberately
  // soft-deleted fixture unit (dt-to-mc-3, Tổ 3 under Giáo họ Mân Côi on
  // Đồng Tháp) must survive the seed the same way a live one does.
  await seed(sql);

  for (const s of shelves) {
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*) from parish_units pu
      join bookshelves b on b.id = pu.bookshelf_id
      where b.slug = ${s.slug}
    `;
    expect(Number(count)).toBe(s.parishUnits.length);
  }
});

test("a reader's parish_unit ids resolve to the right units, nested and unassigned alike", async () => {
  // fixtures.ts assigns each reader a fixture-local id like "dt-gh-thanh-tam"
  // — not a real uuid. The seed must map every one of those to the row it
  // actually inserted; a broken mapping would either insert nothing (nulls
  // where the fixture has a value) or throw (a foreign key to nothing).
  // Maria Nguyễn Thị Lan is nested two levels deep; Phanxicô Nguyễn Văn Lộc
  // has neither set at all (design §5: both stay optional, permanently).
  await seed(sql);

  const [lan] = await sql<{ l1: string | null; l2: string | null }[]>`
    select l1.name as l1, l2.name as l2
    from memberships m
    join users u on u.id = m.user_id
    left join parish_units l1 on l1.id = m.parish_unit_l1_id
    left join parish_units l2 on l2.id = m.parish_unit_l2_id
    where u.full_name = 'Maria Nguyễn Thị Lan'
  `;
  expect(lan).toEqual({ l1: "Giáo họ Thánh Tâm", l2: "Tổ 3" });

  const [loc] = await sql<{ l1: string | null; l2: string | null }[]>`
    select m.parish_unit_l1_id as l1, m.parish_unit_l2_id as l2
    from memberships m
    join users u on u.id = m.user_id
    where u.full_name = 'Phanxicô Nguyễn Văn Lộc'
  `;
  expect(loc).toEqual({ l1: null, l2: null });
});

test("lost copies are seeded in the lost state, not just available and on_loan ones", async () => {
  // The refinements design added ReportCopyLost's third path and
  // fixtures.lostCopies. A seed that only knew about `loans` would leave
  // these three copies `available` — silently contradicting
  // books.copiesAvailable, which fixtures.ts's own comments work out by
  // hand precisely so this can't drift.
  await seed(sql);

  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from book_copies where state = 'lost'
  `;
  expect(Number(count)).toBe(3);
});

test("the reader's donation offers are seeded as book_donations, every status", async () => {
  // Refinements design §3: BookDonation is the offer, not the provenance —
  // and fixtures.donations carries pending, received and declined examples,
  // not only the manager's pending queue. All of them must round-trip.
  await seed(sql);

  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from book_donations
  `;
  expect(Number(count)).toBe(donations.length);

  const declined = await sql<{ decision_note: string | null }[]>`
    select decision_note from book_donations where status = 'declined'
  `;
  // book_donations_declined_has_reason (DB §4.8): every one of these must be
  // non-null, or the migration's own constraint would already have rejected
  // the insert — this asserts the fixture's decisionNote actually made it
  // across the mapping.
  for (const row of declined) expect(row.decision_note).not.toBeNull();
});

test("the seed is idempotent", async () => {
  await seed(sql);
  await seed(sql);
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from books
  `;
  expect(Number(count)).toBe(books.length);
});
