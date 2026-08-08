import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { runCommand, runQuery } from "../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { copyStateTransition } from "../../src/domain/catalogue/policy";
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
 * **Deferred to C1, and said plainly rather than silently skipped:** nothing
 * here exercises `LendCopy` or `ApproveBorrowRequest` refusing a lost/retired
 * copy at the command level, because neither command exists yet. This file
 * proves the two halves that already exist today — the transition table and
 * the borrowable view — leave no way for such a copy to be lent through this
 * slice's own machinery. It does not yet prove the third half; C1 must add
 * that case to this same file when `LendCopy` lands, not assume the first two
 * halves are enough on their own.
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
