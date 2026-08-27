import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * `approveCommentAction`, `rejectCommentAction` and `hideCommentAction` — the
 * three comment decisions, which had no test of their own until a second screen
 * started posting to them.
 *
 * **What is actually new, and why it needs a test.** All three used to end in
 * `backToQueue(...)`, a hard-coded redirect to `/quan-ly/binh-luan`. The
 * manager's own book page now shows that book's waiting comments, so a decision
 * made there has to come back *there* — `afterCommentDecision` takes an optional
 * **book slug** and builds the URL itself.
 *
 * That optionality is the whole risk surface, and it has two halves:
 *
 * 1. The queue must be unchanged. It posts no `sach`, and a regression that
 *    made the new path the default would send a manager working a stack of
 *    cards to a book page after every single decision.
 * 2. **A form must never be able to name a redirect target.** These are
 *    `"use server"` actions, reachable by anyone who can post to them, so a
 *    `ve=` carrying a return *path* would be an open redirect — the fact that
 *    the page only ever puts its own path in it is a property of the page, not
 *    of the action. The last test here is that one, and it is the reason the
 *    field is a slug rather than a URL.
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

const { approveCommentAction, rejectCommentAction, hideCommentAction } =
  await import("../../src/app/tu-sach/[shelf]/quan-ly/actions");
const { pool } = await import("../../src/db/client");

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

/** Where a `redirect()` aimed, read off the digest Next.js actually throws. */
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

async function signInAs(bookshelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  const [membership] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${bookshelfId}, ${user.id}, ${role}, 'active')
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id, membershipId: membership.id };
}

/** A shelf, a published book, a signed-in manager, and one comment in `status`. */
async function aCommentOn(status: "pending" | "approved") {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const [book] = await sql<{ slug: string }[]>`
    select slug from books where id = ${bookId}
  `;
  const { userId } = await signInAs(shelf.id, "manager", "quanly");
  const [comment] = await sql<{ id: string }[]>`
    insert into comments (bookshelf_id, book_id, author_id, body, status)
    values (${shelf.id}, ${bookId}, ${userId}, 'Cuốn này hay lắm.', ${status})
    returning id
  `;
  return { shelf, bookSlug: book.slug, commentId: comment.id };
}

test("a decision made on the queue still lands on the queue", async () => {
  // No `sach` field at all — which is exactly what `/quan-ly/binh-luan` posts.
  // A manager working a stack of cards stays on the stack.
  const { commentId } = await aCommentOn("pending");

  const target = await redirectedTo(
    approveCommentAction(form({ "tu-sach": "dong-thap", "binh-luan": commentId })),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly/binh-luan");
  const [row] = await sql<{ status: string }[]>`select status from comments`;
  expect(row.status).toBe("approved");
});

test("approving from a book page comes back to that book page", async () => {
  const { bookSlug, commentId } = await aCommentOn("pending");

  const target = await redirectedTo(
    approveCommentAction(
      form({ "tu-sach": "dong-thap", "binh-luan": commentId, sach: bookSlug }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/sach/${bookSlug}`);
  const [row] = await sql<{ status: string }[]>`select status from comments`;
  expect(row.status).toBe("approved");
});

test("hiding from a book page comes back to that book page", async () => {
  const { bookSlug, commentId } = await aCommentOn("approved");

  const target = await redirectedTo(
    hideCommentAction(
      form({ "tu-sach": "dong-thap", "binh-luan": commentId, sach: bookSlug }),
    ),
  );

  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/sach/${bookSlug}`);
  const [row] = await sql<{ status: string }[]>`select status from comments`;
  expect(row.status).toBe("hidden");
});

test("a rejection carries its reason, and an empty box refuses on the same page", async () => {
  const { bookSlug, commentId } = await aCommentOn("pending");

  // The empty box first: the refusal has to land back where the manager was,
  // with the code, or the reason box they left blank is off screen when they
  // read the sentence telling them to fill it in.
  const refused = await redirectedTo(
    rejectCommentAction(
      form({
        "tu-sach": "dong-thap",
        "binh-luan": commentId,
        sach: bookSlug,
        "ly-do": "   ",
      }),
    ),
  );
  expect(refused).toBe(
    `/tu-sach/dong-thap/quan-ly/sach/${bookSlug}?loi=reject_reason_required`,
  );
  const [untouched] = await sql<{ status: string }[]>`select status from comments`;
  expect(untouched.status).toBe("pending");

  const target = await redirectedTo(
    rejectCommentAction(
      form({
        "tu-sach": "dong-thap",
        "binh-luan": commentId,
        sach: bookSlug,
        "ly-do": "Bình luận không phù hợp với tủ sách.",
      }),
    ),
  );
  expect(target).toBe(`/tu-sach/dong-thap/quan-ly/sach/${bookSlug}`);
  const [row] = await sql<{ status: string; moderation_note: string }[]>`
    select status, moderation_note from comments
  `;
  expect(row.status).toBe("rejected");
  expect(row.moderation_note).toBe("Bình luận không phù hợp với tủ sách.");
});

test("a forged `sach` cannot redirect off this shelf, or off this site", async () => {
  // **The reason the field is a slug and not a path.** Each of these is what an
  // open redirect would look like arriving through a form post; all three have
  // to come back as a single, escaped path segment underneath this shelf's own
  // manager area, where the worst outcome is a 404.
  // One shelf and one book for the whole loop — `aCommentOn` creates the shelf,
  // and `bookshelves.slug` is unique, so calling it per iteration is a 23505
  // about the fixture rather than anything about the redirect.
  const { shelf, commentId: first } = await aCommentOn("pending");
  const [book] = await sql<{ id: string }[]>`select id from books`;
  const [author] = await sql<{ author_id: string }[]>`
    select author_id from comments where id = ${first}
  `;

  for (const forged of [
    "//evil.example.com",
    "../../../../quan-tri",
    "https://evil.example.com/x",
  ]) {
    const [fresh] = await sql<{ id: string }[]>`
      insert into comments (bookshelf_id, book_id, author_id, body, status)
      values (${shelf.id}, ${book.id}, ${author.author_id}, 'Bình luận thử.',
              'pending')
      returning id
    `;

    const target = await redirectedTo(
      approveCommentAction(
        form({ "tu-sach": "dong-thap", "binh-luan": fresh.id, sach: forged }),
      ),
    );

    const prefix = "/tu-sach/dong-thap/quan-ly/sach/";
    expect(target).toBe(`${prefix}${encodeURIComponent(forged)}`);

    // **The property that matters is "one path segment", not "no dots".**
    // `encodeURIComponent` escapes the separators and leaves `.` alone, so
    // `../../x` becomes `..%2F..%2Fx` — a segment that literally contains two
    // dots and cannot traverse anywhere, because a browser resolves `%2F` as
    // data rather than as a delimiter. Asserting on the dots would fail here
    // while proving nothing; asserting there is no unescaped separator left is
    // what actually rules out climbing out of the manager area or leaving the
    // site entirely.
    const segment = target.slice(prefix.length);
    expect(segment).not.toContain("/");
    expect(new URL(target, "https://olibra.test").origin).toBe(
      "https://olibra.test",
    );
  }
});
