import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * PO feedback round 1, Task 8: the empty-phone confirmation's server-side
 * half — the rule the dialog is a courtesy in front of, per the task brief's
 * own instruction to build and prove the refusal first.
 *
 * **`registerMembershipAction`, not the brief's `registerAction`.** No
 * function by that name exists anywhere in this codebase (checked); the real
 * export is `src/app/dang-ky/actions.ts`'s `registerMembershipAction`, which
 * returns `Promise<void>` and signals a refusal by *redirecting* to
 * `?loi=<code>`, never by returning `{ refusal }` — the brief's own snippet
 * names a shape this action does not have. `tests/lib/manager-actions.test.ts`
 * and `tests/lib/registration-over-http.test.ts` both confirm the real
 * contract; this file follows the former's lighter, in-process
 * `redirectedTo`/`vi.mock("next/headers")` shape rather than spinning up a
 * real `next dev` server, because nothing in this feature crosses the
 * Turbopack layer boundary the HTTP file exists for (no password hasher or
 * verifier is reached when neither a username nor a password is posted).
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

const { registerMembershipAction } = await import("../../src/app/dang-ky/actions");
const { pool } = await import("../../src/db/client");

let previousUrl: string | undefined;

beforeAll(async () => {
  // The action reaches `src/db/client.ts`'s pooled connection, a separate
  // handle from this file's own `sql` — matching `tests/lib/manager-actions
  // .test.ts`'s identical setup, for the identical reason: without this, the
  // action writes into whatever `DATABASE_URL` already pointed at (or
  // nothing at all) while every assertion below reads `olibra_test` through
  // `sql`, and the two never meet.
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});
beforeEach(async () => {
  session.token = null;
  await resetDatabase();
  await makeShelf(sql, { slug: "dong-thap" });
});
afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

/** Every field `registerMembershipAction` reads, except `dien-thoai` and
 *  `ly-do-thieu-sdt`, which each test supplies for itself. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("tu-sach", "dong-thap");
  data.set("ten-thanh", "Anna");
  data.set("ho-ten", "Anna Phạm Thu Hà");
  data.set("ngay-sinh", "2016-03-01");
  data.set("ten-cha", "Phạm Văn Bình");
  data.set("ten-me", "Nguyễn Thị Cúc");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** `redirect()`'s own signalling shape — see `manager-actions.test.ts`'s
 *  identical helper for why `redirect` is not mocked instead. */
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

/** The `?loi=` code a refusal came back with, or null. */
function refusalIn(target: string): string | null {
  return new URLSearchParams(target.split("?")[1] ?? "").get("loi");
}

async function personByFullName(fullName: string) {
  const [row] = await sql<
    { phone: string | null; phone_missing_reason: string | null }[]
  >`select phone, phone_missing_reason from users where full_name = ${fullName}`;
  return row;
}

test("a form with no phone and no reason is refused", async () => {
  const target = await redirectedTo(
    registerMembershipAction(form({ "dien-thoai": "", "ly-do-thieu-sdt": "" })),
  );

  expect(refusalIn(target)).toBe("thieu-so-dien-thoai");
  // And nothing was written — a refused registration leaves no half-made row.
  expect(await personByFullName("Anna Phạm Thu Hà")).toBeUndefined();
});

test("a form with no phone and a typed reason is accepted", async () => {
  const target = await redirectedTo(
    registerMembershipAction(
      form({
        "dien-thoai": "",
        "ly-do-thieu-sdt": "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau",
      }),
    ),
  );

  expect(refusalIn(target)).not.toBe("thieu-so-dien-thoai");
  expect(target).toBe("/dang-ky?tu-sach=dong-thap&da-gui=1");
  const person = await personByFullName("Anna Phạm Thu Hà");
  expect(person.phone).toBeNull();
  expect(person.phone_missing_reason).toBe(
    "Em bé chưa có điện thoại, mẹ sẽ bổ sung sau",
  );
});

test("a form with a phone needs no reason, and none is stored", async () => {
  const target = await redirectedTo(
    registerMembershipAction(
      form({ "dien-thoai": "0912345678", "ly-do-thieu-sdt": "" }),
    ),
  );

  expect(refusalIn(target)).toBeNull();
  const person = await personByFullName("Anna Phạm Thu Hà");
  expect(person.phone).toBe("0912345678");
  expect(person.phone_missing_reason).toBeNull();
});

test("a reason typed alongside a real phone is not stored — the phone answers the question", async () => {
  const target = await redirectedTo(
    registerMembershipAction(
      form({
        "dien-thoai": "0912345678",
        "ly-do-thieu-sdt": "Không cần vì đã có số",
      }),
    ),
  );

  expect(refusalIn(target)).toBeNull();
  const person = await personByFullName("Anna Phạm Thu Hà");
  expect(person.phone).toBe("0912345678");
  expect(person.phone_missing_reason).toBeNull();
});
