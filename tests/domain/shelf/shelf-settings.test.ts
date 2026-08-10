import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery } from "../../../src/domain/kernel/unit-of-work";
import {
  holdDaysFor,
  loanDaysFor,
  renewalSettingsFor,
} from "../../../src/domain/circulation/settings";
import {
  commentsEnabled,
  commentsRequireApproval,
} from "../../../src/domain/community/policy";
import { getShelfSettings } from "../../../src/domain/shelf/queries/get-shelf-settings";
import { migrate } from "../../../src/db/migrate";
import { makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const NOW = "2026-08-14T03:00:00Z";

async function managerOf(slug = "dong-thap") {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock(NOW),
  };
  return { shelf, manager, ctx };
}

test("a shelf that has set nothing reads the same defaults the commands use", async () => {
  // The property that matters and the one this query most easily gets wrong.
  // `bookshelves.settings` is a schemaless `jsonb` bag, so every value has a
  // default *in the code that reads it* — and a settings screen showing a
  // different number from the one `lendCopy` applies is worse than no screen:
  // a manager reads "14 ngày", the software lends for 21, and nothing anywhere
  // disagrees out loud.
  //
  // So this compares against the shipped readers rather than against literals.
  // Changing a default in one place fails here instead of drifting.
  const { ctx } = await managerOf();

  const [settings, loanDays, holdDays, renewal, comments, approval] =
    await runQuery(
      sql,
      ctx,
      async (tx, c) =>
        [
          await getShelfSettings(tx, c),
          await loanDaysFor(tx, c.bookshelfId),
          await holdDaysFor(tx, c.bookshelfId),
          await renewalSettingsFor(tx, c.bookshelfId),
          await commentsEnabled(tx, c.bookshelfId),
          await commentsRequireApproval(tx, c.bookshelfId),
        ] as const,
    );

  expect(settings.policy.loanDays).toBe(loanDays);
  expect(settings.policy.holdDays).toBe(holdDays);
  expect(settings.policy.maxRenewals).toBe(renewal.maxRenewals);
  expect(settings.policy.renewalDays).toBe(renewal.renewalDays);
  expect(settings.policy.commentsEnabled).toBe(comments);
  expect(settings.policy.commentsRequireApproval).toBe(approval);

  // And they really are the documented values, so the agreement above is not
  // two functions being wrong together.
  expect(settings.policy).toMatchObject({
    loanDays: 14,
    maxConcurrentLoans: 3,
    maxRenewals: 1,
    renewalDays: 7,
    holdDays: 3,
    dueSoonDays: 3,
    commentsEnabled: true,
    commentsRequireApproval: true,
  });
});

test("a shelf that overrides one value reads the override, not the default", async () => {
  // The falsification for the test above: `coalesce` with a hard-coded literal
  // and no column read would pass every assertion there.
  const { shelf, ctx } = await managerOf();
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ loan_days: 21, max_renewals: 0 })}
     where id = ${shelf.id}
  `;

  const [settings, loanDays] = await runQuery(
    sql,
    ctx,
    async (tx, c) =>
      [
        await getShelfSettings(tx, c),
        await loanDaysFor(tx, c.bookshelfId),
      ] as const,
  );

  expect(settings.policy.loanDays).toBe(21);
  expect(loanDays).toBe(21);
  // `0` is a real value and not an absent one — a `coalesce` on the *JavaScript*
  // side would turn "no renewals allowed" into the default of one.
  expect(settings.policy.maxRenewals).toBe(0);
  // Untouched keys keep their defaults.
  expect(settings.policy.holdDays).toBe(3);
});

test("it reads this shelf's row and not another active shelf's", async () => {
  // Worth its own test because `bookshelves` carries *two* permissive select
  // policies: the tenant one, and `bookshelves_public_read`, which admits every
  // active shelf. Postgres ORs them — so an unqualified read here would return
  // a row per shelf and this query would answer with whichever came first.
  const a = await managerOf("dong-thap");
  await makeShelf(sql, { slug: "vinh-long" });

  const settings = await runQuery(sql, a.ctx, (tx, c) => getShelfSettings(tx, c));
  expect(settings.profile.slug).toBe("dong-thap");
});

test("a reader is refused, by the domain and not by the page", async () => {
  const { shelf, ctx } = await managerOf();
  const reader = await makeMember(sql, shelf.id);
  const asReader: TenantContext = {
    ...ctx,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
  };

  await expect(
    runQuery(sql, asReader, (tx, c) => getShelfSettings(tx, c)),
  ).rejects.toMatchObject({ code: "not_permitted" });
});
