import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { voidLoan } from "../../../src/domain/circulation/commands/void-loan";
import {
  getStatistics,
  statsPeriodFrom,
} from "../../../src/domain/shelf/queries/get-statistics";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** Mid-August, well inside every window this file opens. */
const NOW = "2026-08-14T03:00:00Z";

function managerAt(
  bookshelfId: string,
  manager: { id: string; userId: string },
  instant = NOW,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock(instant),
  };
}

async function shelf(slug = "dong-thap") {
  const s = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, s.id, { role: "manager" });
  return { shelf: s, manager, ctx: managerAt(s.id, manager) };
}

/** A loan written at `instant`, through the real command so the state is real. */
async function lendAt(
  ctx: TenantContext,
  copyId: string,
  membershipId: string,
  instant: string,
) {
  return runCommand(sql, { ...ctx, clock: fixedClock(instant) }, lendCopy, {
    copyId,
    membershipId,
  });
}

test("the period window follows the injected clock, not wall time", async () => {
  // The property a statistics screen most easily loses: every figure stays
  // plausible while none of them can be moved. One loan in July, one in August;
  // `month` sees the August one only, and `all` sees both — with the clock
  // fixed in August and nothing else different between the two reads.
  const { shelf: s, ctx } = await shelf();
  const { copyIds } = await makeBookWithCopies(sql, s.id, 2);
  const reader = await makeMember(sql, s.id);

  await lendAt(ctx, copyIds[0], reader.id, "2026-07-20T03:00:00Z");
  await lendAt(ctx, copyIds[1], reader.id, "2026-08-10T03:00:00Z");

  const month = await runQuery(sql, ctx, (tx, c) =>
    getStatistics(tx, c, { period: "month" }),
  );
  const all = await runQuery(sql, ctx, (tx, c) =>
    getStatistics(tx, c, { period: "all" }),
  );

  expect(month.loans).toBe(1);
  expect(all.loans).toBe(2);
});

test("a week is this parish's week, and July's loan is outside it", async () => {
  const { shelf: s, ctx } = await shelf();
  const { copyIds } = await makeBookWithCopies(sql, s.id, 2);
  const reader = await makeMember(sql, s.id);

  // 2026-08-14 is a Friday; the week begins on Monday the 10th.
  await lendAt(ctx, copyIds[0], reader.id, "2026-08-10T03:00:00Z");
  await lendAt(ctx, copyIds[1], reader.id, "2026-08-09T03:00:00Z");

  const week = await runQuery(sql, ctx, (tx, c) =>
    getStatistics(tx, c, { period: "week" }),
  );
  expect(week.loans).toBe(1);
});

test("a voided loan stops being counted, with nothing decremented", async () => {
  // The reason nothing here is a materialised counter. No write touches a
  // statistics row; the number changes because the aggregate is recomputed.
  const { shelf: s, ctx } = await shelf();
  const { copyIds } = await makeBookWithCopies(sql, s.id, 1);
  const reader = await makeMember(sql, s.id);
  const { loanId } = await lendAt(ctx, copyIds[0], reader.id, NOW);

  expect((await runQuery(sql, ctx, (tx, c) => getStatistics(tx, c))).loans).toBe(1);

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "ghi nhầm" });

  const after = await runQuery(sql, ctx, (tx, c) => getStatistics(tx, c));
  expect(after.loans).toBe(0);
  expect(after.borrowers).toBe(0);
  expect(after.topBooks).toEqual([]);
});

test("borrowers counts people, not loans", async () => {
  const { shelf: s, ctx } = await shelf();
  const { copyIds } = await makeBookWithCopies(sql, s.id, 3);
  const one = await makeMember(sql, s.id);
  const two = await makeMember(sql, s.id);

  await lendAt(ctx, copyIds[0], one.id, NOW);
  await lendAt(ctx, copyIds[1], two.id, NOW);
  // The same reader again, on a second copy: two loans, still two borrowers.
  await lendAt(ctx, copyIds[2], one.id, NOW);

  const stats = await runQuery(sql, ctx, (tx, c) => getStatistics(tx, c));
  expect(stats.loans).toBe(3);
  expect(stats.borrowers).toBe(2);
});

test("every borrower appears in the leaderboard", async () => {
  // §13 of the PO-feedback spec: the opt-in toggle is gone, and the list now
  // counts every borrower — no reader is absent from it.
  const { shelf: s, ctx } = await shelf();
  const { copyIds } = await makeBookWithCopies(sql, s.id, 3);
  const shy = await makeMember(sql, s.id);
  const willing = await makeMember(sql, s.id);
  await sql`
    update users set full_name = 'Bạn kín đáo' where id = ${shy.userId}
  `;
  await sql`
    update users set full_name = 'Bạn cởi mở' where id = ${willing.userId}
  `;

  await lendAt(ctx, copyIds[0], shy.id, NOW);
  await lendAt(ctx, copyIds[1], shy.id, NOW);
  await lendAt(ctx, copyIds[2], willing.id, NOW);

  const stats = await runQuery(sql, ctx, (tx, c) => getStatistics(tx, c));
  expect(stats.topReaders.map((r) => r.name)).toEqual([
    "Bạn kín đáo",
    "Bạn cởi mở",
  ]);
});

test("it is RLS doing the scoping, not a where clause", async () => {
  // The same property `manager-dashboard.test.ts` asserts for its badges, and
  // for the same reason: a count is exactly the shape of query where a missing
  // predicate looks like a working feature.
  const a = await shelf("dong-thap");
  const b = await shelf("vinh-long");
  for (const s of [a, b]) {
    const { copyIds } = await makeBookWithCopies(sql, s.shelf.id, 1);
    const reader = await makeMember(sql, s.shelf.id);
    await lendAt(s.ctx, copyIds[0], reader.id, NOW);
  }

  const scoped = await runQuery(sql, a.ctx, (tx, c) => getStatistics(tx, c));
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${a.shelf.id}, true)`;
    await tx`select set_config('olibra.now', ${NOW}, true)`;
    await tx`set local role olibra_admin`;
    return getStatistics(tx as never, a.ctx);
  });

  expect(scoped.loans).toBe(1);
  expect(unpoliced.loans).toBe(2);
});

test("a reader is refused, by the domain and not by the page", async () => {
  const { shelf: s, manager } = await shelf();
  const reader = await makeMember(sql, s.id);
  const asReader: TenantContext = {
    ...managerAt(s.id, manager),
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };

  await expect(
    runQuery(sql, asReader, (tx, c) => getStatistics(tx, c)),
  ).rejects.toMatchObject({ code: "not_permitted" });
});

test("an unrecognised period is the month, never an empty screen", () => {
  // `?ky=constructor` must not narrow to a window that matches nothing — the
  // shape of bug this project has shipped twice, where an empty page reads as
  // "there is no data" rather than as a bad parameter.
  expect(statsPeriodFrom("constructor")).toBe("month");
  expect(statsPeriodFrom(null)).toBe("month");
  expect(statsPeriodFrom("week")).toBe("week");
  expect(statsPeriodFrom("all")).toBe("all");
});
