import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { ValidationFailed } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import { managerRegisterReader } from "../../../src/domain/members/commands/manager-register-reader";
import { updateReaderProfile } from "../../../src/domain/members/commands/update-reader-profile";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { makeMember, makeShelf } from "../../support/factories";

/**
 * A date of birth is either the day a volunteer meant or a refusal — never a
 * different day, stored quietly.
 *
 * Three things this file holds, all found by review after the slice shipped:
 *
 * 1. **`register()` was not guarded at all.** The DateStyle check closed
 *    `UpdateReaderProfile`, `ApproveProfileChange` and `ProposeProfileChange`
 *    and missed the one screen where a child's date of birth is *first* typed.
 *    `blank()` was the whole of its validation.
 * 2. **The regex accepted impossible ISO dates.** `2015-02-30` is
 *    `YYYY-MM-DD`-shaped and rolls silently over into `2015-03-02`.
 * 3. **Identity matching is keyed on the same string.**
 *    `findExistingPerson`'s no-username branch matches on
 *    `date_of_birth = ${input.dateOfBirth}::date`, so a mis-read date asks the
 *    wrong question about who this person *is*, not merely about their
 *    birthday.
 *
 * Every case below is a real refusal through a real command, because the whole
 * failure being guarded against is that nothing raises.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

async function shelfWithManager() {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  return { shelf, manager, ctx };
}

const registration = (over: Record<string, string> = {}) => ({
  saintName: "Maria",
  fullName: "Nguyễn Thị Mai",
  dateOfBirth: "2015-04-02",
  fatherName: "Giuse Nguyễn Văn C",
  motherName: "Anna Lê Thị D",
  phone: "0912345678",
  ...over,
});

// — register(), the screen the guard used to miss —

test("registering with a Vietnamese-written date is refused, not silently re-read", async () => {
  // `02/04/2015` is 2 April 2015 here. Through this driver against an
  // `ISO, MDY` server it was stored as `2015-02-03` — the wrong month and the
  // wrong day, with nothing raised. The date a volunteer typed and the date on
  // the record were different, on the one record BR §5.3 exists to make
  // trustworthy.
  const { ctx } = await shelfWithManager();

  await expect(
    runCommand(
      sql,
      ctx,
      managerRegisterReader,
      registration({
        dateOfBirth: "02/04/2015",
      }),
    ),
  ).rejects.toThrow(ValidationFailed);

  expect(
    await sql`select id from users where full_name = 'Nguyễn Thị Mai'`,
  ).toHaveLength(0);
});

test("registering with an ISO-shaped impossible date is refused", async () => {
  // `2015-02-30` passes any `\d{4}-\d{2}-\d{2}` regex and rolls over into
  // `2015-03-02`. February has never had thirty days; a record saying it does
  // is a typo the software agreed with.
  const { ctx } = await shelfWithManager();

  await expect(
    runCommand(
      sql,
      ctx,
      managerRegisterReader,
      registration({
        dateOfBirth: "2015-02-30",
      }),
    ),
  ).rejects.toThrow(ValidationFailed);
});

test("registering with prose where a date belongs is a sentence, not a RangeError", async () => {
  // `'hôm qua'` came back as `RangeError: Invalid Date` out of the driver —
  // not the `22007` a `psql` session gives, because `postgres.js` turns the
  // string into a JavaScript `Date` before it is ever sent. Either way OPS §2
  // forbids it reaching a caller.
  const { ctx } = await shelfWithManager();

  await expect(
    runCommand(
      sql,
      ctx,
      managerRegisterReader,
      registration({
        dateOfBirth: "hôm qua",
      }),
    ),
  ).rejects.toThrow(ValidationFailed);
});

test("a real date registers, and is stored as the day that was typed", async () => {
  // The guard has to let the ordinary case through, and the assertion is on the
  // stored value rather than on the absence of a throw: a check that refused
  // everything would pass the three tests above and fail every volunteer.
  const { ctx } = await shelfWithManager();

  await runCommand(sql, ctx, managerRegisterReader, registration());

  const [person] = await sql<{ date_of_birth: string }[]>`
    select date_of_birth::text as date_of_birth from users
     where full_name = 'Nguyễn Thị Mai'
  `;
  expect(person.date_of_birth).toBe("2015-04-02");
});

// — the impossible-but-ISO case on the paths the guard already covered —

test("UpdateReaderProfile refuses 2015-02-30 rather than storing 2015-03-02", async () => {
  // The half of the original guard that the regex let through. The reader's
  // existing date of birth must be untouched afterwards: a refusal that
  // half-wrote would be worse than the bug.
  const { shelf, ctx } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const before = await sql<{ date_of_birth: string | null }[]>`
    select date_of_birth::text as date_of_birth from users where id = ${reader.userId}
  `;

  await expect(
    runCommand(sql, ctx, updateReaderProfile, {
      membershipId: reader.id,
      fields: { date_of_birth: "2015-02-30" },
    }),
  ).rejects.toThrow(ValidationFailed);

  const after = await sql<{ date_of_birth: string | null }[]>`
    select date_of_birth::text as date_of_birth from users where id = ${reader.userId}
  `;
  expect(after[0].date_of_birth).toBe(before[0].date_of_birth);
});

test("UpdateReaderProfile stores a leap day, which is a real date", async () => {
  // 2016 was a leap year and `2016-02-29` must survive — the cheapest way to
  // get the round-trip check wrong is to reject every 29 February.
  const { shelf, ctx } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id, { status: "active" });

  await runCommand(sql, ctx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { date_of_birth: "2016-02-29" },
  });

  const [row] = await sql<{ date_of_birth: string }[]>`
    select date_of_birth::text as date_of_birth from users where id = ${reader.userId}
  `;
  expect(row.date_of_birth).toBe("2016-02-29");
});
