import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import {
  copyStateTransition,
  type CopyState,
} from "../../src/domain/catalogue/policy";
import { copyLendable } from "../../src/domain/circulation/policy";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
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
 *  3. the command — `LendCopy` and `ApproveBorrowRequest` refuse it. `LendCopy`
 *     landed with C1's Task 3 and its case is the last test in this file;
 *     `ApproveBorrowRequest` is C2's and belongs here too when it lands.
 *
 * Halves 1 and 2 are asserted here. A test that only checked the predicate
 * would pass against an implementation where the view still offered the copy
 * up, which is the failure that actually reaches a reader.
 *
 * **C1 landed two tests below, and they are not the same test.** The third
 * closes the loop between `copyLendable` and the database: a copy taken to
 * `lost` and to `retired` by the real commands, with the state read back out
 * of `book_copies` and fed to the predicate. That is the seam the first test
 * above cannot cover, because it spells the states as literals rather than
 * taking what the `copy_state` enum produced. The fourth is the third half
 * proper — `lendCopy` itself refusing both, with the reason a volunteer reads.
 * A predicate that is right and a command that never consults it would leave
 * the third green and the fourth red.
 *
 * What is still outstanding is `ApproveBorrowRequest`, which is C2's; see the
 * closing note.
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

test("INV-7: lendCopy itself refuses a lost or a retired copy, with INV-7's reason", async () => {
  // The third half, landed by C1's Task 3. Not a restatement of the test
  // above: that one proves the *predicate* refuses the state the database
  // holds, this one proves the *command* asks the predicate at all. A
  // `lendCopy` that skipped `copyLendable` and leaned on `copies_borrowable`
  // instead would leave the test above green and fail here — and would also
  // refuse a held copy to its own holder, which is INV-3's business.
  //
  // Reaching `lost` needs `on_loan → lost` (`catalogue/policy.ts:46-60`), so
  // the fixture lends first — the same shape both tests above already use.
  const shelf = await makeShelf(sql, { slug: "tra-vinh" });
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

  const reader = await makeMember(sql, shelf.id);
  for (const copyId of copyIds) {
    // `copy_lost_or_retired`, not `copy_not_available`. The distinction
    // reaches a volunteer: "đã mất hoặc ngừng dùng" sends them to the manager,
    // while "đang được mượn hoặc đang giữ chỗ" sends them to look for a book
    // nobody has. A command that refused for the wrong reason would still
    // refuse, which is why the assertion is on the code.
    await expect(
      runCommand(sql, ctx, lendCopy, { copyId, membershipId: reader.id }),
    ).rejects.toMatchObject({ code: "copy_lost_or_retired" });
  }

  // Refused before any write: the lost copy's own closed loan is the only one
  // in the table, and neither copy moved.
  const [{ n }] = await sql<{ n: string }[]>`select count(*) as n from loans`;
  expect(Number(n)).toBe(1);
  const states = await sql<{ state: string }[]>`
    select state from book_copies where id in ${sql(copyIds)} order by id
  `;
  expect(states.map((s) => s.state).sort()).toEqual(["lost", "retired"]);
});

// **Still outstanding, and named rather than skipped silently.**
//
// `ApproveBorrowRequest` — the other command half of INV-7's third half — does
// not exist in any branch: it is C2's, not C1's, and OPS §4.2 already gives it
// its own `copy_lost_or_retired` refusal with a *different* sentence ("Bản
// sách đã chọn đã mất hoặc ngừng dùng.", OPERATIONS.md:305) from the one this
// file's tests assert. That is the same one-code-two-sentences collision B1,
// B2a and C1 each had to split; C2 will have to split it too, and the test
// that closes this file out belongs here when it does.
