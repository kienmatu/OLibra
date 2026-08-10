import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `submitSiteFeedbackAction` (`src/app/lien-he/actions.ts`) — Task 17
 * (2026-08-10 QA remediation), the write behind `/lien-he`'s site-wide góp ý
 * form.
 *
 * Run against a real database and the real `next/headers` mock shape
 * `admin-actions.test.ts` already established, for the reason every test file
 * in this directory gives: the interesting property is which row landed where
 * and under which `bookshelf_id`, not that the action called three functions
 * in order.
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
}));

const { submitSiteFeedbackAction } = await import("../../src/app/lien-he/actions");
const { pool } = await import("../../src/db/client");
const { getFeedbackInbox } =
  await import("../../src/domain/admin/queries/get-feedback-inbox");
const { runAdminQuery } = await import("../../src/domain/kernel/unit-of-work");

const clock = fixedClock("2026-08-10T03:00:00Z");

let previousUrl: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/** Where a `redirect()` aimed — the same digest-reading helper every action test in this directory carries its own copy of. */
async function redirectedTo(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.split(";")[2];
    }
    throw err;
  }
  throw new Error("the action returned without redirecting");
}

test("a stranger with no session and no shelf reaches the administrator", async () => {
  const target = await redirectedTo(
    submitSiteFeedbackAction(
      form({
        ten: "Giáo xứ Thánh Tâm",
        "dien-thoai": "0900000010",
        "chu-de": "Mở tủ sách",
        "noi-dung": "Giáo xứ em chưa có tủ sách trên OLibra, muốn mở một tủ.",
      }),
    ),
  );

  expect(target).toBe("/lien-he?da-gui=1");

  const [row] = await sql<{ bookshelf_id: string | null; subject: string }[]>`
    select bookshelf_id, subject from feedback
  `;
  expect(row.bookshelf_id).toBeNull();
  expect(row.subject).toBe("Mở tủ sách");
});

test("a missing required field redirects with the field's refusal code, not a bare 500", async () => {
  const target = await redirectedTo(
    submitSiteFeedbackAction(
      form({
        ten: "",
        "dien-thoai": "0900000011",
        "chu-de": "",
        "noi-dung": "Nội dung",
      }),
    ),
  );

  expect(target).toBe("/lien-he?loi=feedback_fields_required");
  expect(await sql`select 1 from feedback`).toHaveLength(0);
});

test("the fourth submission from the same number in a day is refused", async () => {
  for (let i = 0; i < 3; i++) {
    const target = await redirectedTo(
      submitSiteFeedbackAction(
        form({
          ten: "Người quen",
          "dien-thoai": "0900000012",
          "noi-dung": `Lần ${i + 1}`,
        }),
      ),
    );
    expect(target).toBe("/lien-he?da-gui=1");
  }

  const target = await redirectedTo(
    submitSiteFeedbackAction(
      form({
        ten: "Người quen",
        "dien-thoai": "0900000012",
        "noi-dung": "Lần thứ tư",
      }),
    ),
  );
  expect(target).toBe("/lien-he?loi=rate_limited");
});

test("the submission reaches /quan-tri/gop-y's own read — the whole point of the inbox", async () => {
  await redirectedTo(
    submitSiteFeedbackAction(
      form({
        ten: "Giáo xứ Thánh Tâm",
        "dien-thoai": "0900000013",
        "noi-dung": "Giáo xứ em muốn mở tủ sách.",
      }),
    ),
  );

  const admin = {
    bookshelfId: "",
    actor: { userId: null, membershipId: null, role: "super_admin" as const },
    clock,
  };
  const inbox = await runAdminQuery(sql, admin, (tx, ctx) =>
    getFeedbackInbox(tx, ctx, {}),
  );
  expect(inbox).toHaveLength(1);
  expect(inbox[0].shelfId).toBeNull();
  expect(inbox[0].senderName).toBe("Giáo xứ Thánh Tâm");
  expect(inbox[0].isUnread).toBe(true);
});
