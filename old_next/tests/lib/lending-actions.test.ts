import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * The three circulation server actions (U1 Task 4).
 *
 * **What this file exists for is one distinction**, the one U1 §3.3 calls "the
 * one worth a test": a `RuleViolated` is an answer and comes back to the form
 * as a code; anything else is a fault and keeps throwing. The tempting
 * implementation — `catch (e) { return { error: messageFor(...) } }` — passes
 * every happy-path test in this file and tells a volunteer their input was
 * wrong when the database is down. So the refusals and the faults are asserted
 * side by side, against the same shipped functions.
 *
 * Run against a real database, like `page-data.test.ts` and for the same
 * reason: the interesting properties are which rows were written, which shelf
 * they belong to, and which refusal a command actually reached — none of which
 * a mocked `runCommand` could answer.
 */

/**
 * `cookies()` is the only thing here with no meaning outside a request.
 * `redirect()` is deliberately *not* mocked: it works standalone and throws an
 * error carrying `digest: "NEXT_REDIRECT;replace;<path>;307;"`, so every
 * assertion below reads the real signal Next.js would act on rather than a
 * stand-in that would agree with any implementation.
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

const { lendCopyAction, receiveReturnAction, reportCopyLostAction } =
  await import("../../src/app/tu-sach/[shelf]/quan-ly/actions");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-09T03:00:00Z");

/** What Next.js's own `notFound()` throws. */
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

let previousUrl: string | undefined;

beforeAll(async () => {
  // Same trade as `page-data.test.ts`: the seam reaches Postgres through
  // `pool()`, which reads `DATABASE_URL`, so the suite points that at its own
  // database rather than giving the seam an `sql` parameter production would
  // never pass.
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

async function signInAs(bookshelfId: string, role: string, username: string) {
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone, username, password_hash)
    values ('Maria', 'Maria Nguyễn Thị Lan', 'A', 'B', '0900000001', ${username},
            ${await hashPassword("x")})
    returning id
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${bookshelfId}, ${user.id}, ${role}, 'active')
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

/**
 * Where a `redirect()` aimed, query string and all, or a failure naming what
 * happened instead.
 *
 * Reading the digest rather than mocking `redirect` is what makes "the action
 * redirected" a claim about Next.js's actual control flow: a test that swapped
 * the function out would pass against an action that never redirected at all.
 * The digest is `NEXT_REDIRECT;<kind>;<url>;<status>;`, and a URL cannot contain
 * a `;` unescaped, so index 2 is the whole target.
 *
 * A `run` that resolves is itself a failure, and says so — every one of these
 * actions ends in a redirect, on both branches.
 */
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

/** A shelf, a manager signed in, one book with `copies` available copies. */
async function shelfWithManager(copies = 1) {
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const manager = await signInAs(shelf.id, "manager", "lan.nguyen");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  return { shelf, manager, bookId, copyIds };
}

async function activeLoansOn(copyId: string) {
  return sql<{ id: string; status: string }[]>`
    select id, status from loans where copy_id = ${copyId}
  `;
}

test("a lend that succeeds writes the loan and lands on the dashboard with a confirmation notice", async () => {
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);

  const target = await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "sach-1",
        // The confirm page's own hidden field (QA remediation Task 16) — a
        // shelf-mark, not read back from the database here, since
        // `lendCopyAction` never re-derives it from `copyId` and simply
        // carries whatever the page sent.
        "ma-ban": "DT-0001",
      }),
    ),
  );

  const loans = await activeLoansOn(copyIds[0]);
  expect(loans).toHaveLength(1);
  expect(loans[0].status).toBe("active");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("on_loan");

  // `lendCopyAction` resolves its own context through `submitCommand`, not
  // through this file's `clock` (that fixed clock is `signIn`'s own, for
  // session expiry — see `:92`), so `dueOn` runs off the real system clock
  // and cannot be pinned to a literal date the way `lend-copy.test.ts`'s
  // domain-level test pins it against an injected one. Read back rather than
  // hard-coded, for the same reason `due_on::text` is read there.
  const [row] = await sql<{ due_on: string }[]>`
    select due_on::text from loans where copy_id = ${copyIds[0]}
  `;
  expect(target).toBe(
    `/tu-sach/dong-thap/quan-ly?da-luu=cho-muon&ma-ban=DT-0001&han=${row.due_on}`,
  );
});

test("a reader at the loan limit comes back as a code, and nothing is written", async () => {
  // INV-5, and the sentence BR §16.3 wants beside the confirm button. The
  // screen refuses first — `searchReadersForLending` marks the row — but the
  // command is the guarantee, and this is what the volunteer sees when the
  // third loan was created in the seconds between the two.
  const { shelf, copyIds } = await shelfWithManager(4);
  const reader = await makeMember(sql, shelf.id);
  for (let i = 0; i < 3; i++) {
    await sql`
      insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by,
                         due_on, status)
      select ${shelf.id}, ${copyIds[i]}, book_id, ${reader.userId}, ${reader.userId},
             '2026-08-23', 'active'
        from book_copies where id = ${copyIds[i]}
    `;
  }

  const target = await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[3],
        "nguoi-doc": reader.id,
        sach: "sach-1",
      }),
    ),
  );

  expect(target.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/cho-muon/xac-nhan");
  // The code, never the sentence: the page looks the Vietnamese up through
  // `messageFor`, so the URL cannot become a second copy of the wording.
  expect(refusalIn(target)).toBe("loan_limit_reached");
  // And the book survives the round trip, so the volunteer lands back on the
  // screen they were looking at rather than at an empty step 3.
  expect(new URLSearchParams(target.split("?")[1]).get("sach")).toBe("sach-1");

  expect(await activeLoansOn(copyIds[3])).toHaveLength(0);
});

test("a reader who posts to a manager action is refused by code, not by a 404", async () => {
  // U1 §3.4 draws the line at *pages*: a reader who navigates to a manager URL
  // gets `notFound()`, because a refusal screen would confirm the page exists.
  // An action is the other side of that line — the caller already knows the
  // route, and the honest answer to a POST is the domain's own sentence. This
  // is also what pins `submitCommand` *not* translating `not_permitted`, which
  // `loadPage` does translate: the same refusal, two deliberate answers.
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const { copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const borrower = await makeMember(sql, shelf.id);
  await signInAs(shelf.id, "reader", "ban.doc");

  const target = await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": borrower.id,
        sach: "sach-1",
      }),
    ),
  );

  expect(refusalIn(target)).toBe("not_permitted");
  expect(await activeLoansOn(copyIds[0])).toHaveLength(0);
});

test("a fault is not swallowed into a friendly refusal", async () => {
  // The whole point of the file. `ban` is not a uuid, so `lendCopy`'s first
  // select fails the cast and Postgres raises 22P02 — a fault, in exactly the
  // class of thing a dead connection or a missing column also produces. It must
  // reach the caller as an error: a redirect carrying `?loi=` here would tell a
  // volunteer their input was wrong about a book, when what is wrong is the
  // request that reached the database.
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);

  const run = lendCopyAction(
    form({
      "tu-sach": "dong-thap",
      ban: "khong-phai-uuid",
      "nguoi-doc": reader.id,
      sach: "sach-1",
    }),
  );

  await expect(run).rejects.toMatchObject({ code: "22P02" });
  // And specifically not a redirect — the shape a `catch (e)` around
  // everything would have produced.
  await expect(run).rejects.not.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
});

test("a post to a shelf that does not exist is a 404, not a refusal", async () => {
  // The translation `loadPage` also makes: `contextFor` throws before there is
  // a tenant at all, so there is no rule anybody broke — only a URL naming
  // nothing.
  //
  // The form is complete on purpose. `nguoi-doc` used to be `""` here, which
  // now stops at the completeness check above (see `complete` in `actions.ts`)
  // and never reaches `contextFor` — so the assertion would have been about the
  // wrong thing. A whole form aimed at a shelf that does not exist is exactly
  // the case this test is named for.
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);

  await expect(
    lendCopyAction(
      form({
        "tu-sach": "khong-co-tu-sach-nay",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });
});

test("a copy id from another shelf is a 404, not a bare 500", async () => {
  // Minor 4. `submitCommand` translated `shelf_not_found` and nothing else, so
  // `lendCopy`'s `NotFound("copy_not_found")` — which is what a copy belonging
  // to somebody else's shelf becomes, because RLS filters the row before the
  // command's own `if (!copy)` runs — left the action throwing and a volunteer
  // looking at an HTTP 500. OPERATIONS.md:33 names the three shapes and what
  // each is for: "inline field error vs. a named blocking message vs. a 404
  // page". A bare 500 is not on that list.
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  const theirs = await makeShelf(sql, { slug: "can-tho" });
  const { copyIds: theirCopies } = await makeBookWithCopies(sql, theirs.id, 1);

  await expect(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: theirCopies[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });

  // And nothing was written to either shelf — the 404 is the whole outcome.
  expect(await activeLoansOn(theirCopies[0])).toHaveLength(0);
});

test("a well-formed uuid naming nothing at all is the same 404", async () => {
  // The other half of the same defect, and the one with no cross-tenant story
  // behind it: a link a volunteer kept after the copy was deleted.
  const { shelf } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);

  await expect(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: "00000000-0000-4000-8000-000000000000",
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });

  // The same for the reader half, so the translation is not one command's.
  await expect(
    reportCopyLostAction(
      form({
        "tu-sach": "dong-thap",
        ban: "00000000-0000-4000-8000-000000000000",
        muon: "",
        "ghi-chu": "",
        q: "",
      }),
    ),
  ).rejects.toMatchObject({ digest: NOT_FOUND });
});

test("an incomplete form is a refusal in words, not a 22P02", async () => {
  // Removing `disabled` from the confirm button in a browser's inspector and
  // submitting sends `ban=""`, which Postgres answers with a failed `uuid`
  // cast — a bare 500 for a form this application itself rendered incomplete.
  //
  // The decision recorded in `complete()`: an *empty* required id is refused
  // here, a *malformed* one is still the database's answer. So the shape check
  // covers the form the app produced and not the request somebody rewrote —
  // which is also what leaves "a fault is not swallowed into a friendly
  // refusal" above with a real fault to be about.
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);

  const noCopy = await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: "",
        "nguoi-doc": reader.id,
        sach: "de-men",
      }),
    ),
  );
  expect(noCopy.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/cho-muon/xac-nhan");
  expect(refusalIn(noCopy)).toBe("validation_failed");
  // Back to the same screen with the book still chosen, like every other
  // refusal — the point is that the volunteer keeps their place.
  expect(new URLSearchParams(noCopy.split("?")[1]).get("sach")).toBe("de-men");

  const noReader = await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": "",
        sach: "de-men",
      }),
    ),
  );
  expect(refusalIn(noReader)).toBe("validation_failed");
  expect(await activeLoansOn(copyIds[0])).toHaveLength(0);

  const noLoan = await redirectedTo(
    receiveReturnAction(
      form({
        "tu-sach": "dong-thap",
        muon: "",
        "tinh-trang": "perfect",
        "ghi-chu": "",
        q: "de men",
      }),
    ),
  );
  expect(noLoan.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/nhan-tra");
  expect(refusalIn(noLoan)).toBe("validation_failed");

  const noLostCopy = await redirectedTo(
    reportCopyLostAction(
      form({
        "tu-sach": "dong-thap",
        ban: "",
        muon: "",
        "ghi-chu": "",
        q: "de men",
      }),
    ),
  );
  expect(noLostCopy.split("?")[0]).toBe(
    "/tu-sach/dong-thap/quan-ly/nhan-tra/bao-mat",
  );
  expect(refusalIn(noLostCopy)).toBe("validation_failed");
});

test("a ValidationFailed from a command is still a fault, not a friendly sentence", async () => {
  // The half of "everything else throws" that a `PostgresError` cannot show.
  // `receiveReturn` validates the condition against the `copy_condition` enum
  // itself and throws `ValidationFailed` — a `DomainError` like `RuleViolated`,
  // carrying a code with a Vietnamese sentence, and therefore exactly the class
  // a too-eager `catch (e) { return { error: messageFor(e.code) } }` would
  // swallow. The picker can only ever submit one of six; anything else is a
  // rewritten request, and it stays loud.
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  );
  const [loan] = await activeLoansOn(copyIds[0]);

  const run = receiveReturnAction(
    form({
      "tu-sach": "dong-thap",
      muon: loan.id,
      "tinh-trang": "khong-co-tinh-trang-nay",
      "ghi-chu": "",
      q: "de men",
    }),
  );

  await expect(run).rejects.toMatchObject({ code: "validation_failed" });
  await expect(run).rejects.not.toMatchObject({
    digest: expect.stringContaining("NEXT_REDIRECT"),
  });
});

test("a return closes the loan, records the condition and frees the copy", async () => {
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  );
  const [loan] = await activeLoansOn(copyIds[0]);

  const target = await redirectedTo(
    receiveReturnAction(
      form({
        "tu-sach": "dong-thap",
        muon: loan.id,
        "tinh-trang": "worn",
        "ghi-chu": "Gáy sách hơi long",
        q: "sach",
        // The return screen's own hidden field (QA remediation Task 16) —
        // see the sibling note on the lend test above.
        "ma-ban": "DT-0001",
      }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly?da-luu=nhan-tra&ma-ban=DT-0001");
  const [after] = await sql<{ status: string; return_condition: string }[]>`
    select status, return_condition from loans where id = ${loan.id}
  `;
  expect(after.status).toBe("returned");
  expect(after.return_condition).toBe("worn");
  const [copy] = await sql<{ state: string; condition: string }[]>`
    select state, condition from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("available");
  expect(copy.condition).toBe("worn");
  const assessments = await sql<{ note: string }[]>`
    select note from condition_assessments where loan_id = ${loan.id}
  `;
  expect(assessments).toHaveLength(1);
  expect(assessments[0].note).toBe("Gáy sách hơi long");
});

test("returning the same loan twice is a refusal, not a crash", async () => {
  // BR §17.7's double-submit, which is what `loan_not_active` is worded for:
  // "Lượt mượn này đã được xử lý." A volunteer who tapped twice on a slow
  // connection is told nothing is wrong, because nothing is.
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  );
  const [loan] = await activeLoansOn(copyIds[0]);
  const fields = {
    "tu-sach": "dong-thap",
    muon: loan.id,
    "tinh-trang": "perfect",
    "ghi-chu": "",
    q: "sach",
  };

  await redirectedTo(receiveReturnAction(form(fields)));
  const target = await redirectedTo(receiveReturnAction(form(fields)));

  expect(target.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/nhan-tra");
  expect(refusalIn(target)).toBe("loan_not_active");
  const params = new URLSearchParams(target.split("?")[1]);
  // The search and the loan travel back with it, so the volunteer returns to
  // the screen they were on rather than to an empty box.
  expect(params.get("q")).toBe("sach");
  expect(params.get("muon")).toBe(loan.id);
});

test("reporting a copy lost closes its loan as lost, not as returned", async () => {
  // OPS §4.2: this branch "does not call ReceiveReturn at all". INV-11 — the
  // loan is closed, never deleted — and `loans.status = 'lost'` rather than
  // `'returned'` is what distinguishes the two a year later.
  const { shelf, copyIds } = await shelfWithManager();
  const reader = await makeMember(sql, shelf.id);
  await redirectedTo(
    lendCopyAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        "nguoi-doc": reader.id,
        sach: "",
      }),
    ),
  );
  const [loan] = await activeLoansOn(copyIds[0]);

  const target = await redirectedTo(
    reportCopyLostAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        muon: loan.id,
        "ghi-chu": "Gia đình đã tìm quanh nhà",
        q: "sach",
      }),
    ),
  );

  expect(target).toBe("/tu-sach/dong-thap/quan-ly");
  const [after] = await sql<{ status: string }[]>`
    select status from loans where id = ${loan.id}
  `;
  expect(after.status).toBe("lost");
  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyIds[0]}
  `;
  expect(copy.state).toBe("lost");
});

test("reporting a copy that is not out is a refusal in the copy's own words", async () => {
  // BR §7.1 draws exactly one arrow into `lost`, from `on_loan`, and
  // `copyStateTransition` is where that lives. The refusal names what is
  // allowed instead — "Chỉ có thể báo mất bản sách đang được mượn." — rather
  // than failing as a constraint violation.
  const { copyIds } = await shelfWithManager();

  const target = await redirectedTo(
    reportCopyLostAction(
      form({
        "tu-sach": "dong-thap",
        ban: copyIds[0],
        muon: "",
        "ghi-chu": "",
        q: "sach",
      }),
    ),
  );

  expect(target.split("?")[0]).toBe("/tu-sach/dong-thap/quan-ly/nhan-tra/bao-mat");
  expect(refusalIn(target)).toBe("copy_not_on_loan");
});
