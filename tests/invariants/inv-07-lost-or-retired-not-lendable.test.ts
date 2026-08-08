import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import {
  copyStateTransition,
  type CopyState,
} from "../../src/domain/catalogue/policy";
import { copyLendable } from "../../src/domain/circulation/policy";
import { reportCopyLost } from "../../src/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../src/domain/catalogue/commands/retire-copy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-7 — "A copy that is lost or retired cannot be lent or held."
 *
 * DATABASE.md §7 files this as "Application + partial index". B1 owns two of
 * its three halves and C1 owns the third:
 *
 *  1. the predicate — `copyStateTransition` refuses `lost|retired → on_loan`
 *     and `→ held`;
 *  2. the access path — such a copy is absent from `copies_borrowable`, which
 *     is the view every lending decision reads (DB §6);
 *  3. the command — `LendCopy` and `ApproveBorrowRequest` refuse it. Those
 *     commands do not exist until C1, which extends this file rather than
 *     starting a second one.
 *
 * Halves 1 and 2 are asserted here. A test that only checked the predicate
 * would pass against an implementation where the view still offered the copy
 * up, which is the failure that actually reaches a reader.
 *
 * **C1 has landed a third test below, and the third half is still not
 * complete.** Both statements are true and it is worth being exact about
 * which is which. C1's Task 1 shipped `copyLendable`, the predicate `LendCopy`
 * will consult, and the test at the foot of this file closes the loop between
 * it and the database: a copy taken to `lost` and to `retired` by the real
 * commands, with the state read back out of `book_copies` and fed to the
 * predicate. That is the seam the first test above cannot cover, because it
 * spells the states as literals rather than taking what the `copy_state` enum
 * produced.
 *
 * What is still outstanding is `LendCopy` and `ApproveBorrowRequest`
 * themselves. C1 shipped its Tasks 1 and 2 ahead of Task 3, so neither command
 * exists in this branch yet; see the closing note.
 */

const clock = fixedClock("2026-08-08T03:00:00Z");

test("INV-7: a lost or retired copy is refused by the transition table", async () => {
  for (const from of ["lost", "retired"] as const) {
    for (const to of ["on_loan", "held"] as const) {
      expect(copyStateTransition(from, to).allowed).toBe(false);
    }
  }
});

test("INV-7: a lost or retired copy disappears from copies_borrowable", async () => {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 3);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  const borrowable = () =>
    runQuery(
      sql,
      ctx,
      (tx) =>
        tx<
          { id: string }[]
        >`select id from copies_borrowable where book_id = ${bookId}`,
    );

  expect(await borrowable()).toHaveLength(3);

  const borrower = await makeMember(sql, shelf.id);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${borrower.userId}, ${manager.userId},
            date '2026-08-22')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "Mục nát" });

  const left = await borrowable();
  expect(left.map((c) => c.id)).toEqual([copyIds[2]]);
});

test("INV-7: the state a real lost or retired copy carries is the state the predicate refuses", async () => {
  // The seam between the two halves above, which neither of them covers.
  //
  // `copyLendable` (C1, `src/domain/circulation/policy.ts`) tests
  // `copy.state === "lost" || copy.state === "retired"` against string
  // literals it declares itself. The first test in this file does the same.
  // So both would stay green if the `copy_state` enum ever gained a different
  // spelling for either state, or if `reportCopyLost` started writing
  // something else — and the predicate would silently fall through to
  // `copy_not_available`, which tells a volunteer the book is out with a
  // reader when it is in fact gone. This test takes the state the database
  // actually holds after the real commands have run, and asserts the predicate
  // refuses *that*.
  //
  // Reaching `lost` needs `on_loan → lost` (`catalogue/policy.ts:46-60`), so
  // the fixture lends first — the same shape the test above already uses.
  const shelf = await makeShelf(sql, { slug: "can-tho" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 2);
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  const borrower = await makeMember(sql, shelf.id);
  await sql`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${borrower.userId},
            ${manager.userId}, date '2026-08-22')
  `;
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[0]}`;

  await runCommand(sql, ctx, reportCopyLost, { copyId: copyIds[0] });
  await runCommand(sql, ctx, retireCopy, { copyId: copyIds[1], reason: "Mục nát" });

  const rows = await sql<{ id: string; state: CopyState }[]>`
    select id, state from book_copies where id in ${sql(copyIds)} order by id
  `;
  expect(rows.map((r) => r.state).sort()).toEqual(["lost", "retired"]);

  for (const row of rows) {
    // Refused with INV-7's own reason, not INV-3's. The distinction reaches a
    // volunteer: "đã mất hoặc ngừng dùng" sends them to the manager, while
    // "đang được mượn hoặc đang giữ chỗ" sends them to look for a book nobody
    // has. A predicate that stopped recognising these two states would still
    // refuse the lend — it would just refuse it for the wrong reason, which is
    // why the assertion is on the code and not merely on `blocked`.
    expect(
      copyLendable({ state: row.state, heldForUserId: null }, borrower.userId),
    ).toEqual({ blocked: true, reason: "copy_lost_or_retired" });
  }
});
