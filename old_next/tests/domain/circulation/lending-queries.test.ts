import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../src/domain/circulation/commands/receive-return";
import { searchLoansForReturn } from "../../../src/domain/circulation/queries/search-loans-for-return";
import { searchBooksForLending } from "../../../src/domain/catalogue/queries/search-books-for-lending";
import { searchReadersForLending } from "../../../src/domain/members/queries/search-readers-for-lending";
import { reportCopyLost } from "../../../src/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../../src/domain/catalogue/commands/retire-copy";
import type { CopyState } from "../../../src/domain/catalogue/policy";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember } from "../../support/factories";
import {
  lentOut,
  managerContext,
  managerContextFor,
  SCENARIO_CLOCK,
} from "../../support/scenarios";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * The lending screens' three searches, from C1's side.
 *
 * `searchBooksForLending` and `searchReadersForLending` shipped with B1 and
 * B2a and are already covered where they live —
 * `tests/domain/catalogue/manager-queries.test.ts` and
 * `tests/domain/members/manager-queries.test.ts` between them pin
 * every-copy-out, one-copy-free, diacritic-insensitivity, the garbage query,
 * blocked-readers-listed-rather-than-filtered, and the per-shelf limit. None
 * of that is repeated here.
 *
 * What could not be written until `lendCopy` existed is the *agreement*: that
 * the reason a search shows a manager is the very code the command throws when
 * they press the button anyway. That is the first two tests. The rest belong to
 * `searchLoansForReturn`, which has no shipped counterpart.
 */

// — the agreement between the screen and the command —

test("the reader search's block reason is the code lendCopy throws", async () => {
  // BR §16.3: "Blocking conditions (reader at loan limit, copy already lent,
  // membership not active) surface as a clear message *before* the confirm
  // step, never as an error afterwards." The failure this catches is
  // not a wrong message — it is the screen and the command disagreeing, so a
  // volunteer is told yes and then no with the book already in a child's
  // hands, or told no about a reader who was never blocked at all.
  //
  // Both sides route through `memberMayBorrow`, so this asserts the wiring.
  // The assertion is deliberately `thrown`, not the literal
  // "loan_limit_reached": a test naming the string on both sides would stay
  // green while the two implementations drifted to a third value together, and
  // would say nothing about whether they were ever the same predicate.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  for (let i = 0; i < 3; i++) {
    const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
    await runCommand(sql, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: reader.id,
    });
  }

  // `q: "nguoi doc"`, never `q: ""` — a blank query returns [] by design
  // (search-readers-for-lending.ts:67). `makeUser` names readers "Người đọc N".
  const rows = await runQuery(sql, ctx, (tx, c) =>
    searchReadersForLending(tx, c, { q: "nguoi doc", maxConcurrentLoans: 3 }),
  );
  const queried = rows.find((r) => r.membershipId === reader.id)!.block;

  // A fourth copy, free, so the only thing left to refuse is the reader.
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const thrown = await runCommand(sql, ctx, lendCopy, {
    copyId: copyIds[0],
    membershipId: reader.id,
  }).then(
    () => null,
    (e: { code: string }) => e.code,
  );

  expect(thrown).not.toBeNull(); // the command really did refuse
  // The whole Block, not just its reason: asserting the object is what catches
  // a `blocked: false` row still carrying a stale reason from an earlier branch.
  expect(queried).toEqual({ blocked: true, reason: thrown });
});

test("the book search's block reason is the code lendCopy throws, in every copy state", async () => {
  // The same agreement on the copy side, and the one that had a hole in it.
  //
  // `searchBooksForLending` aggregates a title where `lendCopy` judges one
  // copy, so the two cannot share `copyLendable` and the agreement has to be
  // asserted rather than inherited. The version of this test that shipped
  // exercised `on_loan` only — the single state where both sides already
  // agreed — while claiming to keep the aggregate honest. They disagreed on
  // `lost` and on `retired`: the query said `copy_not_available` ("đang được
  // mượn hoặc đang giữ chỗ" — *go and wait for it*) about a title whose only
  // copy nobody has. `inv-07-lost-or-retired-not-lendable.test.ts` asserts
  // twice that this distinction is what reaches the volunteer.
  //
  // So every state a single-copy title can be in, in one loop, with both sides
  // measured from the same fixture. The expected code is never written down
  // here: `thrown` is whatever the command really did, so the two
  // implementations cannot drift to a third value together and stay green.
  const { shelf, ctx } = await managerContext(sql);

  // Each entry leaves its one copy in the named state and returns the title's
  // book id. The states are reached the way the product reaches them wherever
  // a command exists for it — `lost` and `retired` are `reportCopyLost` and
  // `retireCopy`, not an UPDATE — so a change to those commands cannot leave
  // this file passing against a state nothing produces.
  const inState = async (state: CopyState) => {
    const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
    const copyId = copyIds[0];
    if (state === "on_loan" || state === "lost") {
      const holder = await makeMember(sql, shelf.id);
      const { loanId } = await runCommand(sql, ctx, lendCopy, {
        copyId,
        membershipId: holder.id,
      });
      if (state === "lost") {
        await runCommand(sql, ctx, reportCopyLost, { copyId });
      } else {
        void loanId;
      }
    } else if (state === "retired") {
      await runCommand(sql, ctx, retireCopy, { copyId, reason: "Mục nát" });
    } else if (state === "held") {
      // No C1 command puts a copy aside for a reader without a loan coming
      // back first, and `receiveReturn`'s hold is already covered elsewhere;
      // what this row needs is the *state*, so the hold is written the way
      // `inv-03-only-available-or-own-hold.test.ts` writes its own.
      const holder = await makeMember(sql, shelf.id);
      await sql`
        insert into borrow_requests
          (bookshelf_id, book_id, copy_id, member_id, status, requested_at,
           hold_expires_at)
        values
          (${shelf.id}, ${bookId}, ${copyId}, ${holder.userId}, 'approved',
           ${SCENARIO_CLOCK}::timestamptz, timestamptz '2026-08-10T10:00:00Z')
      `;
      await sql`update book_copies set state = 'held' where id = ${copyId}`;
    }
    return { bookId, copyId };
  };

  for (const state of [
    "available",
    "on_loan",
    "held",
    "lost",
    "retired",
  ] as const) {
    const { bookId, copyId } = await inState(state);

    const rows = await runQuery(
      sql,
      ctx,
      (tx, c) => searchBooksForLending(tx, c, { q: "sach" }), // titles are "Sách N"
    );
    const row = rows.find((r) => r.bookId === bookId)!;
    expect(row, `${state}: the title is missing from the search`).toBeDefined();

    // A fresh reader each time, unblocked, so the command's refusal — or its
    // success — can only be about the copy.
    const reader = await makeMember(sql, shelf.id);
    const thrown = await runCommand(sql, ctx, lendCopy, {
      copyId,
      membershipId: reader.id,
    }).then(
      () => null,
      (e: { code: string }) => e.code,
    );

    expect(
      { blocked: row.blocked, reason: row.reason },
      `state ${state}: the screen and the command disagree`,
    ).toEqual(
      thrown === null
        ? { blocked: false, reason: undefined }
        : { blocked: true, reason: thrown },
    );
  }
});

// — SearchLoansForReturn —

test("a loan out is findable by title, by reader and by the code on the copy", async () => {
  // OPS §3.3: "Find the loan to receive back, by book or reader", returning
  // "borrower, due date, copy code". The copy code is the third key and the
  // one OPS §5's shorter runway depends on: the volunteer is holding the copy,
  // and its label identifies exactly one loan where a title identifies as many
  // as there are copies out.
  const { ctx, loanId, copyId, bookId, reader, dueOn } = await lentOut(sql);
  const [{ code }] = await sql<{ code: string }[]>`
    select code from book_copies where id = ${copyId}
  `;

  const find = (q: string) =>
    runQuery(sql, ctx, (tx, c) => searchLoansForReturn(tx, c, { q }));

  for (const q of ["sach", "nguoi doc", code]) {
    const rows = await find(q);
    expect(rows.map((r) => r.loanId)).toEqual([loanId]);
  }

  // The code, folded: a hyphen is not allowed to be the reason a search
  // misses the label in the volunteer's hand.
  expect(
    (await find(code.toLowerCase().replace("-", " "))).map((r) => r.loanId),
  ).toEqual([loanId]);

  const [row] = await find(code);
  expect(row).toMatchObject({
    loanId,
    copyId,
    copyCode: code,
    bookId,
    // A users(id), never a memberships(id) — 0005_circulation.sql:20.
    borrowerUserId: reader.userId,
    dueOn,
    isOverdue: false,
  });
  expect(row.borrowerName).toMatch(/^Người đọc /);
});

test("a loan already received back is not offered again", async () => {
  // The screen does not offer what the command would refuse. `receiveReturn`
  // throws `loan_not_active` on a second submit (OPS §4.2), and this is the
  // half of that guard that keeps the manager from ever aiming at it — the
  // `status = 'active'` filter, which `loans_current` does not apply for us
  // because it is every loan plus two derived columns, never pre-filtered.
  const { ctx, loanId, copyId } = await lentOut(sql);
  const [{ code }] = await sql<{ code: string }[]>`
    select code from book_copies where id = ${copyId}
  `;

  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  const rows = await runQuery(sql, ctx, (tx, c) =>
    searchLoansForReturn(tx, c, { q: code }),
  );
  expect(rows).toEqual([]);
});

test("overdue is derived on read and moves with the clock, with no command in between", async () => {
  // G5 and BR §8: "Overdue status ... computed on read, from stored data and
  // the current clock." Nothing is written between the three reads below — the
  // only thing that changes is `ctx.clock`, which `runQuery` puts into the
  // `olibra.now` GUC that `loans_current` reads (20260808_14_olibra_now.sql).
  // A query that recomputed overdue in TypeScript from `ctx.clock` would also
  // pass this; one that read a stored flag, or the database's own wall clock,
  // could not.
  const { shelf, manager, loanId, copyId, dueOn } = await lentOut(sql);
  expect(dueOn).toBe("2026-08-21"); // SCENARIO_CLOCK + BR §5.5's default 14 days
  const [{ code }] = await sql<{ code: string }[]>`
    select code from book_copies where id = ${copyId}
  `;

  const at = async (instant: string) => {
    const ctx = managerContextFor(shelf.id, manager, instant);
    const [row] = await runQuery(sql, ctx, (tx, c) =>
      searchLoansForReturn(tx, c, { q: code }),
    );
    expect(row.loanId).toBe(loanId);
    return row;
  };

  // G6: `due_on` is a date in Asia/Ho_Chi_Minh and a book is due at the *end*
  // of that day. 10:00Z on the 21st is 17:00 on the 21st locally — the day it
  // is due, so not yet late.
  expect(await at("2026-08-21T10:00:00Z")).toMatchObject({
    isOverdue: false,
    daysRemaining: 0,
  });
  expect(await at("2026-08-22T10:00:00Z")).toMatchObject({
    isOverdue: true,
    daysRemaining: -1,
  });
  expect(await at("2026-08-25T10:00:00Z")).toMatchObject({
    isOverdue: true,
    daysRemaining: -4,
  });
});

test("M7: a garbage return query returns nothing, not every loan on the shelf", async () => {
  // fix-report, 2026-08-08-b1-catalogue. Same mechanism as the twin guards on
  // searchCatalogue, getBooksList and searchBooksForLending: a query of pure
  // punctuation folds to '', and without the guard every LIKE degenerates to
  // '%%' — here revealing which child is holding which book to anyone who
  // types a stray character.
  const { ctx } = await lentOut(sql);
  for (const q of ["%", "!!!", "   "]) {
    expect(
      await runQuery(sql, ctx, (tx, c) => searchLoansForReturn(tx, c, { q })),
    ).toEqual([]);
  }
});

test("only a manager may search the loans out", async () => {
  // BR §13.3: "the interface hiding an action is never the security control."
  // These rows say which named child is holding which book — the same
  // manager-only fact `getReaderDetail` is gated for.
  const { ctx, shelf } = await lentOut(sql);
  const reader = await makeMember(sql, shelf.id);
  const asReader: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };
  await expect(
    runQuery(sql, asReader, (tx, c) => searchLoansForReturn(tx, c, { q: "sach" })),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("INV-10: a manager of one shelf finds none of another shelf's loans", async () => {
  // This query carries no tenant clause of its own — deliberately. Isolation
  // is `runQuery`'s `set local role olibra_app` plus the `<table>_tenant` RLS
  // policies, and the test is here to prove that is *enough* for a search box,
  // which is the one shape where "no rows" and "the wrong shelf's rows" look
  // alike to a reviewer.
  //
  // Measured while falsifying this test, and recorded because it is the
  // opposite of what the file first claimed: stripping `with (security_invoker
  // = true)` off `loans_current` in both migrations that build it does **not**
  // turn this red. The three joins below it — `book_copies`, `books`, `users`
  // — are base tables read directly, so RLS filters them for `olibra_app`
  // whatever the view does, and shelf A's loan has no shelf-B copy to join to.
  // The reloption still matters, and `tests/db/derived-state.test.ts` is where
  // it is pinned; this test is not a second copy of that one. What does turn
  // this red is deleting the role switch in `unit-of-work.ts:runQuery`, which
  // is the mechanism it actually asserts.
  const a = await lentOut(sql, { slug: "dong-thap" });
  const b = await managerContext(sql, { slug: "can-tho" });
  const [{ code }] = await sql<{ code: string }[]>`
    select code from book_copies where id = ${a.copyId}
  `;

  for (const q of ["sach", "nguoi doc", code]) {
    expect(
      await runQuery(sql, b.ctx, (tx, c) => searchLoansForReturn(tx, c, { q })),
    ).toEqual([]);
  }
});
