import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

// INV-9 is not a write-time rejection like the others in this directory —
// DATABASE.md §7 marks it "Database (access path)": visibility is a property
// of which index answers the public query, not a filter someone remembered
// to add. So the assertion that can actually fail before the index exists
// is structural (the index is there, with the exact predicate that defines
// "public"), backed by a functional check that the predicate the index
// answers really does draw the line DATABASE.md says it draws.

test("INV-9: comments_public is a partial index scoped to approved, non-deleted rows", async () => {
  const [row] = await sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'comments_public'
  `;
  expect(row).toBeDefined();
  expect(row.indexdef).toMatch(/WHERE/i);
  expect(row.indexdef).toMatch(/status = 'approved'/);
  expect(row.indexdef).toMatch(/deleted_at IS NULL/);
});

test("INV-9: only the approved, non-deleted comment is visible through the public access path, and the index is what answers it", async () => {
  // M1: the original version of this test hand-wrote the same predicate the
  // index carries and asserted the result — true regardless of whether the
  // index above exists at all, since a matching seq scan returns the exact
  // same rows. That is SQL correctness, not the "structural... not a filter
  // someone remembered to add" guarantee the file's header comment claims.
  // Forcing the planner off both seq scan and bitmap scan, then asserting
  // via EXPLAIN that `comments_public` itself is in the plan, ties the
  // result to the index actually being the thing that produced it.
  const shelf = await makeShelf(sql);
  const author = await makeUser(sql);
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${shelf.id}, 'Sách', 'Tô Hoài', 'sach-inv9', true)
    returning id
  `;

  const statuses = ["pending", "approved", "rejected", "hidden"] as const;
  for (const status of statuses) {
    await sql`
      insert into comments (bookshelf_id, book_id, author_id, body, status)
      values (${shelf.id}, ${book.id}, ${author.id}, ${`bình luận ${status}`}, ${status})
    `;
  }
  // An approved comment that was later soft-deleted must not surface either —
  // the index's second predicate, not merely its first.
  const [deleted] = await sql<{ id: string }[]>`
    insert into comments (bookshelf_id, book_id, author_id, body, status)
    values (${shelf.id}, ${book.id}, ${author.id}, 'bình luận đã xoá', 'approved')
    returning id
  `;
  await sql`update comments set deleted_at = now() where id = ${deleted.id}`;

  await sql.begin(async (tx) => {
    // Forces the planner's hand: with seq scan and bitmap scan both off,
    // an index-satisfiable query can only be answered by an index scan —
    // and comments_public is the only index that satisfies this predicate
    // without a recheck, so its name appearing in the plan is proof it was
    // used, not merely available.
    await tx`set local enable_seqscan = off`;
    await tx`set local enable_bitmapscan = off`;

    const plan = await tx<{ "QUERY PLAN": string }[]>`
      explain select body from comments
      where book_id = ${book.id} and status = 'approved' and deleted_at is null
      order by created_at desc
    `;
    const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(planText).toMatch(/comments_public/);
    expect(planText).toMatch(/Index Scan/i);

    // The exact predicate the index answers (DATABASE.md §4.8 /
    // 0006_community.sql), now confirmed to be running through the index.
    const visible = await tx<{ body: string }[]>`
      select body from comments
      where book_id = ${book.id} and status = 'approved' and deleted_at is null
      order by created_at desc
    `;
    expect(visible).toHaveLength(1);
    expect(visible[0].body).toBe("bình luận approved");
  });
});
