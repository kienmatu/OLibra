import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import {
  closeAll,
  resetDatabase,
  sql,
  withDelayedQuery,
  withTwoConnections,
} from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/**
 * INV-1, through the command — the half `inv-01-one-active-loan-per-copy.test.ts`
 * deliberately does not cover.
 *
 * That file proves the mechanism: `loans_one_active_per_copy` (`unique
 * (copy_id) where status = 'active'`, `0009_invariant_constraints.sql:21`)
 * rejects the second active loan with a raw `23505`, and does so partially, so
 * a returned loan frees the copy again. Every assertion in it is at the level
 * of `sql\`insert into loans ...\``.
 *
 * What it cannot prove is that anybody translates that `23505`. `lendCopy`
 * deliberately does not pre-check the race — a pre-check reads as more careful
 * and re-opens the window it appears to close — so the losing insert is caught
 * and turned into `copy_not_available` (BR §2: the loser "must fail cleanly and
 * see a plain message, never a silently corrupted record"). That translation is
 * the difference between a volunteer reading "Bản sách này đang được mượn hoặc
 * đang giữ chỗ." and reading a 500, and B1 shipped `CreateBook` letting a bare
 * `23505` escape, so this is a defect this project has actually made.
 */

async function managerContext(bookshelfId: string): Promise<TenantContext> {
  const manager = await makeMember(sql, bookshelfId, { role: "manager" });
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock("2026-08-08T03:00:00Z"),
  };
}

test("INV-1: the loser of a real two-manager race sees copy_not_available, not a 23505", async () => {
  // BR §2, stated as the scenario it is: two managers, two phones, one
  // physical shelf, the same second.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const ctx = await managerContext(shelf.id);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const readerA = await makeMember(sql, shelf.id);
  const readerB = await makeMember(sql, shelf.id);

  const outcomes = await withTwoConnections(async (a, b) =>
    Promise.allSettled([
      runCommand(a, ctx, lendCopy, {
        copyId: copyIds[0],
        membershipId: readerA.id,
      }),
      runCommand(b, ctx, lendCopy, {
        copyId: copyIds[0],
        membershipId: readerB.id,
      }),
    ]),
  );

  const won = outcomes.filter((o) => o.status === "fulfilled");
  const lost = outcomes.filter((o) => o.status === "rejected");
  expect(won).toHaveLength(1);
  expect(lost).toHaveLength(1);
  expect(lost[0].reason).toMatchObject({ code: "copy_not_available" });

  // One loan, and the copy is out exactly once.
  const active = await sql`
    select 1 from loans where copy_id = ${copyIds[0]} and status = 'active'
  `;
  expect(active).toHaveLength(1);
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("on_loan");
});

test("INV-1: the index, not the predicate, is what refuses the loser", async () => {
  // The test above is honest about the race and cannot say *which* refusal
  // fired. Whichever transaction loses the coin flip may well have started
  // after the winner committed, in which case its own `select ... from
  // book_copies` already sees `on_loan` and `copyLendable` refuses it — the
  // same code, from a completely different line.
  //
  // The comment that stood here went further and said a `lendCopy` with no
  // `catch` at all "would still pass it most runs". Measured, on this
  // machine, against exactly that edit (the `isUniqueViolation` translation
  // deleted, `throw e` left): the test above failed 5 runs out of 5, so on
  // this hardware the two transactions really do overlap and the index really
  // does arbitrate. That is a property of one machine's scheduling, not a
  // guarantee — nothing in `Promise.allSettled` forces the interleaving, and
  // a slower or busier host can serialise them — which is why the test below
  // exists. The honest claim is "cannot say which refusal fired", not "would
  // usually pass".
  //
  // So this one forces the interleaving that only the index can survive.
  // `withDelayedQuery` (tests/support/db.ts) holds the *first* transaction
  // open right after its copy select resolves — the read has really happened
  // and returned `available` — while the second command runs to completion and
  // commits. The gate then releases, and the first command walks past both
  // predicates on a snapshot that is now stale and attempts the insert. There
  // is no ordering of reads and writes in application code that closes that
  // window; only `loans_one_active_per_copy` does.
  //
  // Matching on the command's own SQL text is the price of forcing the window,
  // and it is why the string below is a distinctive fragment of `lendCopy`'s
  // copy select rather than something generic like "select". If that statement
  // is ever reworded this test fails to *delay* rather than failing to assert
  // — the gate simply never matches and both commands run sequentially — so
  // the fragment is deliberately one that would have to be edited on purpose.
  const shelf = await makeShelf(sql, { slug: "an-giang" });
  const ctx = await managerContext(shelf.id);
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const first = await makeMember(sql, shelf.id);
  const second = await makeMember(sql, shelf.id);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const outcome = await withTwoConnections(async (a, b) => {
    const held = withDelayedQuery(
      a,
      // Updated by P1, which added `b.title` to this select so `loan.created`
      // could *store* the title BR §14's sentence names (plan §3.2a). That is
      // the "edited on purpose" the paragraph above anticipates: the fragment
      // did not match any more, the gate stopped firing, and the two commands
      // ran sequentially — so the winner lost. A silent pass was never
      // possible, which is what that paragraph was buying.
      (chunk) => chunk.includes("select c.id, c.book_id, b.title, c.state"),
      gate,
    );

    const loser = runCommand(held, ctx, lendCopy, {
      copyId: copyIds[0],
      membershipId: first.id,
    }).catch((e: { code?: string }) => e);

    // The winner commits entirely inside the loser's open transaction.
    await expect(
      runCommand(b, ctx, lendCopy, {
        copyId: copyIds[0],
        membershipId: second.id,
      }),
    ).resolves.toMatchObject({ loanId: expect.any(String) });

    release();
    return loser;
  });

  expect(outcome).toMatchObject({ code: "copy_not_available" });
  // A `DomainError`, so a caller can branch on the shape as well as the code —
  // and specifically not the driver's `PostgresError`, whose own `code` would
  // have been the string "23505".
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).name).toBe("RuleViolated");

  // And the losing transaction wrote nothing at all: OPS §6 requires it to
  // "not have written a `Loan` row at all", which the rollback guarantees but
  // which is worth asserting, because a `lendCopy` that caught the 23505 and
  // carried on would satisfy every assertion above.
  const loans = await sql<{ borrower_id: string }[]>`select borrower_id from loans`;
  expect(loans).toHaveLength(1);
  expect(loans[0].borrower_id).toBe(second.userId);
});
