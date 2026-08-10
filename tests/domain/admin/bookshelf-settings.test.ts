import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { updateBookshelfSettings } from "../../../src/domain/admin/commands/bookshelves";
import { updateSystemDefaults } from "../../../src/domain/admin/commands/system-settings";
import {
  checkPolicyBound,
  type PolicyField,
} from "../../../src/domain/admin/policy";
import { ValidationFailed } from "../../../src/domain/kernel/errors";
import {
  runAdminCommand,
  runAdminQuery,
  runQuery,
} from "../../../src/domain/kernel/unit-of-work";
import { getSystemSettings } from "../../../src/domain/admin/queries/get-admin-overview";
import { getShelfSettings } from "../../../src/domain/shelf/queries/get-shelf-settings";
import { migrate } from "../../../src/db/migrate";
import { makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { superAdminContext } from "../../support/scenarios";

/**
 * Task 15 (QA remediation, 2026-08-10): "Số ngày cho mượn" took `0` at
 * `/quan-tri/tu-sach?tu-sach=<id>` and the database kept it —
 * `settings ->> 'loan_days'` came back `"0"`, no error, no confirmation, and
 * every loan from that shelf would fall due the day it was made.
 * `max_concurrent_loans = 0` stops all borrowing the same way. The inputs
 * carried `min="0"` and no `max`; nothing downstream of the browser checked
 * anything.
 *
 * **This file exercises the shared table (`src/domain/admin/policy.ts`)
 * directly, and then each of the two commands that write through it** —
 * `updateBookshelfSettings` (five of the six fields, per-shelf) and
 * `updateSystemDefaults` (three of the six, the new-shelf defaults). Direct
 * coverage of the table is the exhaustive part: every field's floor, one
 * below it, its ceiling, and one above it. The command-level tests are
 * narrower on purpose — they exist to prove each command is actually wired to
 * the shared check, not to re-derive the whole bound table a second time
 * through a slower path.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const NOW = "2026-08-14T03:00:00Z";

async function admin() {
  const { ctx } = await superAdminContext(sql, NOW);
  return ctx;
}

async function codeThrownBy(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

// ── The shared bound table ───────────────────────────────────────────────────
//
// The brief's own six ranges: `loan_days` 1-365, `max_concurrent_loans` 1-50,
// `max_renewals` 0-10, `renewal_days` 1-365, `hold_days` 1-30, `due_soon_days`
// 0-30. `max_renewals` and `due_soon_days` are the two whose floor is 0 rather
// than 1 — BR §5.5 lets a shelf configure "no renewals", and OPS's sweep
// window is a count of days that may legitimately be "warn on the due date
// itself". Both are tested for that floor explicitly below rather than folded
// into the "refuses one below the floor" loop, which would assert the wrong
// thing for exactly these two.

const RANGES: Record<PolicyField, { min: number; max: number }> = {
  loan_days: { min: 1, max: 365 },
  max_concurrent_loans: { min: 1, max: 50 },
  max_renewals: { min: 0, max: 10 },
  renewal_days: { min: 1, max: 365 },
  hold_days: { min: 1, max: 30 },
  due_soon_days: { min: 0, max: 30 },
};

for (const [field, { min, max }] of Object.entries(RANGES) as [
  PolicyField,
  { min: number; max: number },
][]) {
  test(`${field} accepts its own floor and its own ceiling`, () => {
    expect(() => checkPolicyBound(field, min)).not.toThrow();
    expect(() => checkPolicyBound(field, max)).not.toThrow();
  });

  test(`${field} refuses one above its ceiling, by a code naming it`, () => {
    expect(() => checkPolicyBound(field, max + 1)).toThrow(ValidationFailed);
    try {
      checkPolicyBound(field, max + 1);
      throw new Error("expected checkPolicyBound to throw");
    } catch (err) {
      expect((err as ValidationFailed).code).toBe(`${field}_out_of_range`);
    }
  });

  // `max_renewals` and `due_soon_days` both already sit at `min: 0` above, so
  // "one below the floor" for them is `-1`, not `0` — `0` is the case the next
  // two tests assert is accepted, not refused. Every other field's floor is 1,
  // so `0` is where the QA sweep's own defect lived, and this is written to
  // match the brief's own wording ("each of … rejected at 0 (except
  // max_renewals …")).
  if (min === 0) {
    test(`${field} refuses one below its floor (${min - 1})`, () => {
      expect(() => checkPolicyBound(field, min - 1)).toThrow(ValidationFailed);
    });
  } else {
    test(`${field} refuses zero — the QA sweep's own defect`, () => {
      expect(() => checkPolicyBound(field, 0)).toThrow(ValidationFailed);
      try {
        checkPolicyBound(field, 0);
        throw new Error("expected checkPolicyBound to throw");
      } catch (err) {
        expect((err as ValidationFailed).code).toBe(`${field}_out_of_range`);
      }
    });
  }
}

test("max_renewals at zero is accepted — zero renewals is a real policy, not a refusal", () => {
  expect(() => checkPolicyBound("max_renewals", 0)).not.toThrow();
});

test("due_soon_days at zero is accepted — warn on the due date itself is a real policy", () => {
  expect(() => checkPolicyBound("due_soon_days", 0)).not.toThrow();
});

test("a value that is not a safe integer never reaches the range check", () => {
  // 1.5 and NaN sit inside every field's numeric range by ordinary comparison
  // (`0 <= 1.5 <= 365`), so a bound check written as two `<`/`>` comparisons
  // alone would wave both through. `count`/`wholeNumber` at the two admin
  // forms already turn a malformed box into `undefined` before a command ever
  // sees it, so this is the backstop OPS §2 asks for — pinned here so it stays
  // true even if a future caller skips that surface-level parse.
  expect(() => checkPolicyBound("loan_days", 1.5)).toThrow(ValidationFailed);
  expect(() => checkPolicyBound("loan_days", Number.NaN)).toThrow(ValidationFailed);
});

// ── Wired into the two commands that actually write these numbers ───────────

test("updateBookshelfSettings refuses loan_days at zero — the QA sweep's own case", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  expect(
    await codeThrownBy(() =>
      runAdminCommand(
        sql,
        { ...ctx, bookshelfId: shelf.id },
        updateBookshelfSettings,
        { bookshelfId: shelf.id, loanDays: 0 },
      ),
    ),
  ).toBe("loan_days_out_of_range");
});

test("updateBookshelfSettings refuses max_concurrent_loans at zero — it would stop all borrowing", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  expect(
    await codeThrownBy(() =>
      runAdminCommand(
        sql,
        { ...ctx, bookshelfId: shelf.id },
        updateBookshelfSettings,
        { bookshelfId: shelf.id, maxConcurrentLoans: 0 },
      ),
    ),
  ).toBe("max_concurrent_loans_out_of_range");
});

test("updateBookshelfSettings refuses each field above its own ceiling, by its own code", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        loanDays: 366,
      }),
    ),
  ).toBe("loan_days_out_of_range");

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        maxConcurrentLoans: 51,
      }),
    ),
  ).toBe("max_concurrent_loans_out_of_range");

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        maxRenewals: 11,
      }),
    ),
  ).toBe("max_renewals_out_of_range");

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        renewalDays: 366,
      }),
    ),
  ).toBe("renewal_days_out_of_range");

  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        holdDays: 31,
      }),
    ),
  ).toBe("hold_days_out_of_range");

  // QA remediation Task 23: `dueSoonDays` joined the other five fields this
  // command already wrote — the field the QA brief measured as displayed at
  // `/quan-ly/cai-dat` ("Báo sắp đến hạn trước") with no editor anywhere.
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
        bookshelfId: shelf.id,
        dueSoonDays: 31,
      }),
    ),
  ).toBe("due_soon_days_out_of_range");
});

test("updateBookshelfSettings accepts the ceiling of every field it writes, and saves it", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  await runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
    bookshelfId: shelf.id,
    loanDays: 365,
    maxConcurrentLoans: 50,
    maxRenewals: 10,
    renewalDays: 365,
    holdDays: 30,
    dueSoonDays: 30,
  });

  const settings = await runQuery(sql, shelfCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(settings.policy.loanDays).toBe(365);
  expect(settings.policy.maxConcurrentLoans).toBe(50);
  expect(settings.policy.maxRenewals).toBe(10);
  expect(settings.policy.renewalDays).toBe(365);
  expect(settings.policy.holdDays).toBe(30);
  expect(settings.policy.dueSoonDays).toBe(30);
});

test("updateBookshelfSettings keeps max_renewals at zero as a real save, not a refusal", async () => {
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  await runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
    bookshelfId: shelf.id,
    maxRenewals: 0,
  });

  const settings = await runQuery(sql, shelfCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(settings.policy.maxRenewals).toBe(0);
});

test("updateBookshelfSettings keeps due_soon_days at zero as a real save, not a refusal", async () => {
  // The same shape as `max_renewals` above — both fields sit at `min: 0` in
  // `checkPolicyBound`'s table, and a `coalesce` that could not distinguish
  // "explicitly zero" from "never set" would turn this into 3, silently.
  const ctx = await admin();
  const shelf = await makeShelf(sql);
  const shelfCtx = { ...ctx, bookshelfId: shelf.id };

  await runAdminCommand(sql, shelfCtx, updateBookshelfSettings, {
    bookshelfId: shelf.id,
    dueSoonDays: 0,
  });

  const settings = await runQuery(sql, shelfCtx, (tx, c) =>
    getShelfSettings(tx, c),
  );
  expect(settings.policy.dueSoonDays).toBe(0);
});

test("updateSystemDefaults refuses maxConcurrentLoans at zero, by name — not the generic validation_failed", async () => {
  // Pins the QA-remediation controller's own instruction: "validation_failed
  // alone is not enough for six different numbers." Before this task,
  // `updateSystemDefaults`'s own inline check threw exactly that generic code
  // for every one of its three fields — this asserts the specific one instead.
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 14,
        maxConcurrentLoans: 0,
        maxRenewals: 1,
        renewalDays: 7,
        holdDays: 3,
        dueSoonDays: 3,
      }),
    ),
  ).toBe("max_concurrent_loans_out_of_range");
});

test("updateSystemDefaults refuses holdDays above its ceiling", async () => {
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 14,
        maxConcurrentLoans: 3,
        maxRenewals: 1,
        renewalDays: 7,
        holdDays: 31,
        dueSoonDays: 3,
      }),
    ),
  ).toBe("hold_days_out_of_range");
});

// QA remediation Task 23: the three fields below joined the three above —
// same wiring proof, for the three fields that used to have nowhere in
// `system_settings` to be checked against at all.

test("updateSystemDefaults refuses maxRenewals above its ceiling, by name", async () => {
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 14,
        maxConcurrentLoans: 3,
        maxRenewals: 11,
        renewalDays: 7,
        holdDays: 3,
        dueSoonDays: 3,
      }),
    ),
  ).toBe("max_renewals_out_of_range");
});

test("updateSystemDefaults refuses renewalDays at zero — its floor is 1, unlike maxRenewals and dueSoonDays", async () => {
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 14,
        maxConcurrentLoans: 3,
        maxRenewals: 1,
        renewalDays: 0,
        holdDays: 3,
        dueSoonDays: 3,
      }),
    ),
  ).toBe("renewal_days_out_of_range");
});

test("updateSystemDefaults refuses dueSoonDays above its ceiling", async () => {
  const ctx = await admin();
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, ctx, updateSystemDefaults, {
        loanDays: 14,
        maxConcurrentLoans: 3,
        maxRenewals: 1,
        renewalDays: 7,
        holdDays: 3,
        dueSoonDays: 31,
      }),
    ),
  ).toBe("due_soon_days_out_of_range");
});

test("updateSystemDefaults accepts dueSoonDays at zero — real policy, not a refusal", async () => {
  const ctx = await admin();
  await runAdminCommand(sql, ctx, updateSystemDefaults, {
    loanDays: 14,
    maxConcurrentLoans: 3,
    maxRenewals: 1,
    renewalDays: 7,
    holdDays: 3,
    dueSoonDays: 0,
  });

  const settings = await runAdminQuery(sql, ctx, (tx, c) =>
    getSystemSettings(tx, c),
  );
  expect(settings.defaultDueSoonDays).toBe(0);
});

test("updateSystemDefaults accepts the ceiling of every field it writes, and saves it", async () => {
  const ctx = await admin();
  await runAdminCommand(sql, ctx, updateSystemDefaults, {
    loanDays: 365,
    maxConcurrentLoans: 50,
    maxRenewals: 10,
    renewalDays: 365,
    holdDays: 30,
    dueSoonDays: 30,
  });

  const settings = await runAdminQuery(sql, ctx, (tx, c) =>
    getSystemSettings(tx, c),
  );
  expect(settings.defaultLoanDays).toBe(365);
  expect(settings.defaultMaxConcurrentLoans).toBe(50);
  expect(settings.defaultMaxRenewals).toBe(10);
  expect(settings.defaultRenewalDays).toBe(365);
  expect(settings.defaultHoldDays).toBe(30);
  expect(settings.defaultDueSoonDays).toBe(30);
});
