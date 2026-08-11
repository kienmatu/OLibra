import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";
import { makeBookWithCopies, makeShelf } from "../support/factories";

/**
 * `postCommentAction` (`src/app/tu-sach/[shelf]/community-actions.ts`) — U6 §1,
 * the write behind the comment box on a book's page.
 *
 * **Why this file exists at all.** `createComment` shipped in B3 fully
 * implemented and tested, and was called from nowhere for two slices;
 * `every-domain-command-has-a-caller.test.ts` carried a named exemption saying
 * so. That exemption is deleted now, but all it proves is that the command is
 * *referenced* somewhere — it would go on passing if the form posted the wrong
 * field names, and every field crossing this boundary is a bare string on both
 * sides (`sach-id`, `thanh-vien`, `noi-dung`, `tu-sach`, `sach`) with no shared
 * constant to keep them in step. A renamed hidden input is a form that posts
 * `""` and a queue that silently stops filling, which is precisely the state
 * this slice found the feature in.
 *
 * Same shape as `site-feedback-action.test.ts`: a real database and the
 * `next/headers` mock every action test in this directory uses, because the
 * interesting property is which row landed under which `bookshelf_id` and with
 * which status — not that the action called three functions in order.
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

const { postCommentAction } =
  await import("../../src/app/tu-sach/[shelf]/community-actions");
const { pool } = await import("../../src/db/client");
const { signIn } = await import("../../src/auth/session");
const { hashPassword } = await import("../../src/auth/password");

const clock = fixedClock("2026-08-11T03:00:00Z");

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

/** Where a `redirect()` aimed — the digest-reading helper every action test in this directory carries. */
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

/** A signed-in member of `shelfId` with `role`, and the membership the form posts. */
async function signInAs(shelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria Nguyễn Thị Lan', 'A', 'B', '0900000000', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelfId}, ${user.id}, ${role}, 'active')
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id, membershipId: membership.id };
}

async function aShelfWithABook(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const [book] = await sql<{ slug: string }[]>`
    select slug from books where id = ${bookId}
  `;
  return { shelf, bookId, bookSlug: book.slug };
}

test("a reader's comment lands as pending, on the right shelf and the right book", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook("dong-thap");
  const { userId, membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    postCommentAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
        "noi-dung": "Cuốn này hay lắm, các em nên đọc thử.",
      }),
    ),
  );

  // Back to the page they were reading, with the sentence that tells them the
  // comment is waiting — the whole reason this redirect carries a marker.
  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?da-gui=1`);

  const [row] = await sql<
    { status: string; body: string; author_id: string; bookshelf_id: string }[]
  >`select status, body, author_id, bookshelf_id from comments`;
  // `pending`, because INV-9 makes moderation the default (`comments_require
  // _approval` defaults to true) — the state that puts it in the manager's
  // queue rather than on the page.
  expect(row.status).toBe("pending");
  expect(row.body).toBe("Cuốn này hay lắm, các em nên đọc thử.");
  expect(row.author_id).toBe(userId);
  expect(row.bookshelf_id).toBe(shelf.id);
});

test("a manager can comment too — the symptom this slice was reported for", async () => {
  // `createComment` calls `requireReader`, which is a floor rather than an
  // equality, and a manager holds an active membership like anybody else. This
  // is the assertion the bug report translates to: nothing about the manager
  // role blocks the form the reader uses.
  const { shelf, bookId, bookSlug } = await aShelfWithABook("dong-thap");
  const { membershipId } = await signInAs(shelf.id, "manager", "quanly");

  const target = await redirectedTo(
    postCommentAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
        "noi-dung": "Sách mới về, các em ghé mượn nhé.",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?da-gui=1`);
  expect(await sql`select 1 from comments`).toHaveLength(1);
});

test("an empty body is a refusal code on the page, not a bare 500", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook("dong-thap");
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    postCommentAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
        // Whitespace, not "": `createComment` trims before checking, so this is
        // the case a browser's own `required` attribute lets through.
        "noi-dung": "   ",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?loi=empty_body`);
  expect(await sql`select 1 from comments`).toHaveLength(0);
});

test("a membership that is not the caller's own is refused", async () => {
  // The hidden `thanh-vien` field is a convenience, and this is the assertion
  // that it is not a trust boundary: `createComment` compares it to
  // `ctx.actor.membershipId` and refuses anything else. Somebody else's real,
  // active membership of the same shelf is the strongest version of the forgery
  // — it exists, it is active, and it is not theirs.
  const { shelf, bookId, bookSlug } = await aShelfWithABook("dong-thap");
  const [other] = await sql<{ id: string }[]>`
    insert into users (full_name, father_name, mother_name, phone)
    values ('Giuse Trần Minh', 'A', 'B', '0900000001')
    returning id
  `;
  const [otherMembership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${other.id}, 'reader', 'active')
    returning id
  `;
  await signInAs(shelf.id, "reader", "bandoc");

  const target = await redirectedTo(
    postCommentAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": otherMembership.id,
        "noi-dung": "Bình luận dưới tên người khác.",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?loi=not_permitted`);
  expect(await sql`select 1 from comments`).toHaveLength(0);
});

test("a shelf that has turned comments off refuses the write", async () => {
  const { shelf, bookId, bookSlug } = await aShelfWithABook("dong-thap");
  await sql`
    update bookshelves
       set settings = jsonb_set(coalesce(settings, '{}'), '{comments_enabled}', 'false')
     where id = ${shelf.id}
  `;
  const { membershipId } = await signInAs(shelf.id, "reader", "bandoc");

  // The page hides the whole section on this setting, so reaching the command
  // means the shelf turned comments off between a page load and a submit —
  // which is exactly why the refusal has to be a sentence and not a 500.
  const target = await redirectedTo(
    postCommentAction(
      form({
        "tu-sach": "dong-thap",
        sach: bookSlug,
        "sach-id": bookId,
        "thanh-vien": membershipId,
        "noi-dung": "Tủ sách này không nhận bình luận.",
      }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/sach/${bookSlug}?loi=comments_disabled`);
  expect(await sql`select 1 from comments`).toHaveLength(0);
});
