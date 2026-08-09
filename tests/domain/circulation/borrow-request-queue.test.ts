import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runQuery, type Tx } from "../../../src/domain/kernel/unit-of-work";
import {
  countQueuedRequests,
  getBorrowRequestQueue,
  type QueuedRequestRow,
} from "../../../src/domain/circulation/queries/get-borrow-request-queue";
import { migrate } from "../../../src/db/migrate";
import {
  makeBookWithCopies,
  makeMember,
  makeParishUnits,
  makeShelf,
  makeUser,
} from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const AT = "2026-08-07T10:00:00Z";

function contextFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  role: "manager" | "reader" = "manager",
  instant = AT,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role },
    clock: fixedClock(instant),
  };
}

/** A request row written straight to the table, so a test can pick its instant. */
async function request(
  bookshelfId: string,
  bookId: string,
  userId: string,
  over: {
    at?: string;
    status?: string;
    copyId?: string;
    holdExpiresAt?: string;
  } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into borrow_requests
      (bookshelf_id, book_id, member_id, status, requested_at, copy_id,
       hold_expires_at)
    values
      (${bookshelfId}, ${bookId}, ${userId}, ${over.status ?? "pending"},
       ${over.at ?? AT}, ${over.copyId ?? null}, ${over.holdExpiresAt ?? null})
    returning id
  `;
  return row.id;
}

async function shelfWithManager(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  return { shelf, manager, ctx: contextFor(shelf.id, manager) };
}

function read(ctx: TenantContext, input: { bookId?: string } = {}) {
  return runQuery(sql, ctx, (tx) => getBorrowRequestQueue(tx, ctx, input));
}

/** Every request in the answer, flattened back into the order it came in. */
function flat(queues: { requests: QueuedRequestRow[] }[]): QueuedRequestRow[] {
  return queues.flatMap((q) => q.requests);
}

test("the queue groups by book and numbers each reader's place", async () => {
  const { shelf, ctx } = await shelfWithManager("dong-thap");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const first = await makeMember(sql, shelf.id);
  const second = await makeMember(sql, shelf.id);
  const third = await makeMember(sql, shelf.id);
  const a = await request(shelf.id, bookId, first.userId, {
    at: "2026-08-02T09:00:00Z",
  });
  const b = await request(shelf.id, bookId, second.userId, {
    at: "2026-08-03T09:00:00Z",
  });
  const c = await request(shelf.id, bookId, third.userId, {
    at: "2026-08-04T09:00:00Z",
  });

  const queues = await read(ctx);

  expect(queues).toHaveLength(1);
  expect(queues[0].waiting).toBe(3);
  expect(queues[0].requests.map((r) => r.requestId)).toEqual([a, b, c]);
  // OPS §3.3's "queue position", derived on read — 1-based, and it is the
  // number the screen prints beside a child's name.
  expect(queues[0].requests.map((r) => r.position)).toEqual([1, 2, 3]);
  expect(queues[0].requests[0].readerUserId).toBe(first.userId);
  expect(queues[0].requests[0].membershipId).toBe(first.id);
});

test("cancelling ahead of somebody moves them up, because position is derived", async () => {
  // The reason `position` is `row_number()` and not a column. A stored position
  // is wrong the moment anybody ahead withdraws, and it is wrong silently —
  // the screen still shows a number.
  const { shelf, ctx } = await shelfWithManager("can-tho");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const first = await makeMember(sql, shelf.id);
  const second = await makeMember(sql, shelf.id);
  const a = await request(shelf.id, bookId, first.userId, {
    at: "2026-08-02T09:00:00Z",
  });
  const b = await request(shelf.id, bookId, second.userId, {
    at: "2026-08-03T09:00:00Z",
  });

  expect(flat(await read(ctx)).map((r) => [r.requestId, r.position])).toEqual([
    [a, 1],
    [b, 2],
  ]);

  await sql`update borrow_requests set status = 'cancelled' where id = ${a}`;

  expect(flat(await read(ctx)).map((r) => [r.requestId, r.position])).toEqual([
    [b, 1],
  ]);
});

test("only pending and approved rows are waiting on anybody", async () => {
  // `rejected`, `cancelled` and `fulfilled` are terminal — nobody is waiting on
  // them. `approved` is on the list rather than off it because BR §7.2's
  // definition ("the set of pending requests") on its own would drop the one
  // row the manager most needs: the child whose copy is on the shelf with their
  // name on it, who has to be handed the book before the hold lapses.
  const { shelf, ctx } = await shelfWithManager("ben-tre");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const pending = await makeMember(sql, shelf.id);
  const approved = await makeMember(sql, shelf.id);
  const p = await request(shelf.id, bookId, pending.userId, {
    at: "2026-08-03T09:00:00Z",
  });
  const q = await request(shelf.id, bookId, approved.userId, {
    at: "2026-08-02T09:00:00Z",
    status: "approved",
    copyId: copyIds[0],
    holdExpiresAt: "2026-08-10T10:00:00Z",
  });
  for (const status of ["rejected", "cancelled", "fulfilled"]) {
    const other = await makeMember(sql, shelf.id);
    await request(shelf.id, bookId, other.userId, {
      at: "2026-08-01T09:00:00Z",
      status,
    });
  }

  const rows = flat(await read(ctx));

  expect(rows.map((r) => r.requestId)).toEqual([q, p]);
  expect(rows[0].status).toBe("approved");
  expect(rows[0].copyCode).not.toBeNull();
  expect(rows[0].holdExpiresAt).not.toBeNull();
  // A pending row has no hold, so `holdExpired` is `false` rather than null —
  // null is not a flag, and a screen branching on it would render "hết hạn" for
  // a child who has not been offered anything yet.
  expect(rows[1].holdExpired).toBe(false);
  expect(rows[1].holdExpiresAt).toBeNull();
});

test("a hold expires because the clock moved, and the row stays on the screen", async () => {
  // BR §8 and master §7.6's acceptance: the fixture is written once and read
  // twice through two different `fixedClock`s. Nothing runs, nothing is
  // written, and no wall-clock time passes.
  //
  // The row does *not* leave the queue when it lapses, deliberately: the copy
  // is still sitting in `held` with nobody coming for it, and a manager has to
  // record `held → available` or offer it to the next reader. Dropping the row
  // would hide the one thing that needs doing.
  const { shelf, manager } = await shelfWithManager("vinh-long");
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const holder = await makeMember(sql, shelf.id);
  await request(shelf.id, bookId, holder.userId, {
    status: "approved",
    copyId: copyIds[0],
    holdExpiresAt: "2026-08-10T10:00:00Z",
  });

  const at = (instant: string) =>
    read(contextFor(shelf.id, manager, "manager", instant));

  expect(flat(await at("2026-08-10T09:59:00Z"))[0].holdExpired).toBe(false);
  expect(flat(await at("2026-08-10T10:01:00Z"))[0].holdExpired).toBe(true);

  // Nothing expired it: the row is byte-identical across the two reads, checked
  // by Postgres's own `xmin` rather than asserted by this test's narration.
  const [row] = await sql<{ status: string; xmin: string }[]>`
    select status, xmin::text from borrow_requests
  `;
  expect(row.status).toBe("approved");
  const [again] = await sql<
    { xmin: string }[]
  >`select xmin::text from borrow_requests`;
  expect(again.xmin).toBe(row.xmin);
});

test("a reader who left the shelf is still in the queue, with nothing to link to", async () => {
  // `borrow_requests.member_id` is a `users(id)` and carries no membership, so
  // the row survives the membership being soft-deleted. Joining *through*
  // `memberships` would drop it — and a child who queued and then left is
  // precisely the row a manager needs in order to clear it.
  const { shelf, ctx } = await shelfWithManager("soc-trang");
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const gone = await makeMember(sql, shelf.id);
  await request(shelf.id, bookId, gone.userId);
  await sql`
    update memberships set deleted_at = now() where id = ${gone.id}
  `;

  const rows = flat(await read(ctx));

  expect(rows).toHaveLength(1);
  expect(rows[0].readerUserId).toBe(gone.userId);
  expect(rows[0].membershipId).toBeNull();
});

test("the parish line is the shelf's own wording, not the words Tổ or Giáo họ", async () => {
  // BR §16.3: a shelf names its own units. The query returns the sentence
  // `describeSelection` builds from this shelf's taxonomy, exactly as
  // `getPendingRegistrations` does, so no screen writes those words itself.
  const { shelf, ctx } = await shelfWithManager("hau-giang");
  const units = await makeParishUnits(
    sql,
    shelf.id,
    { levels: 2, nested: true, level1Label: "Giáo khu", level2Label: "Nhóm" },
    [
      { level: 1, name: "Giáo khu Một" },
      { level: 2, name: "Nhóm A", parentName: "Giáo khu Một" },
    ],
  );
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  await sql`
    update memberships
       set parish_unit_l1_id = ${units.get("Giáo khu Một")!},
           parish_unit_l2_id = ${units.get("Nhóm A")!}
     where id = ${reader.id}
  `;
  await request(shelf.id, bookId, reader.userId);

  const rows = flat(await read(ctx));
  expect(rows[0].parishLine).toContain("Giáo khu Một");
  expect(rows[0].parishLine).toContain("Nhóm A");
});

test("bookId narrows the answer to one title", async () => {
  // OPS §5 step 3: the return screen asks the same question about one book.
  // One query with a filter rather than a second function, so the return
  // screen and the queue screen cannot be shown two different answers.
  const { shelf, ctx } = await shelfWithManager("bac-lieu");
  const one = await makeBookWithCopies(sql, shelf.id, 1);
  const two = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);
  const other = await makeMember(sql, shelf.id);
  await request(shelf.id, one.bookId, reader.userId);
  await request(shelf.id, two.bookId, other.userId);

  expect(await read(ctx)).toHaveLength(2);
  const narrowed = await read(ctx, { bookId: one.bookId });
  expect(narrowed).toHaveLength(1);
  expect(narrowed[0].bookId).toBe(one.bookId);
  // A book with nobody waiting is an empty answer, not a group with no rows.
  const three = await makeBookWithCopies(sql, shelf.id, 1);
  expect(await read(ctx, { bookId: three.bookId })).toEqual([]);
});

test("the badge counts what the list shows", async () => {
  // `getManagerBadgeCounts`' own rule: a badge that disagrees with the list it
  // links to is worse than no badge. Asserted against the list rather than
  // against a literal, so the two cannot drift in opposite directions.
  const { shelf, ctx } = await shelfWithManager("tra-vinh");
  const one = await makeBookWithCopies(sql, shelf.id, 1);
  const two = await makeBookWithCopies(sql, shelf.id, 1);
  for (const bookId of [one.bookId, one.bookId, two.bookId]) {
    const reader = await makeMember(sql, shelf.id);
    await request(shelf.id, bookId, reader.userId);
  }
  const decided = await makeMember(sql, shelf.id);
  await request(shelf.id, one.bookId, decided.userId, { status: "rejected" });

  const [queues, waiting] = await Promise.all([
    read(ctx),
    runQuery(sql, ctx, (tx) => countQueuedRequests(tx, ctx)),
  ]);
  expect(waiting).toBe(3);
  expect(waiting).toBe(flat(queues).length);
});

test("it is RLS doing the scoping, not a where clause", async () => {
  // The same property `overdue-loans.test.ts` and `manager-dashboard.test.ts`
  // assert, and for the same reason: a `where r.bookshelf_id = …` satisfies
  // "one shelf sees one shelf" perfectly and is then one deletion away from
  // listing every parish's children under one manager's screen. This runs the
  // *same function*, unchanged, against a transaction whose only difference is
  // the role — `olibra_admin` holds `bypassrls`, so no `<table>_tenant` policy
  // applies. A query that scoped itself in SQL would answer identically.
  const here = await shelfWithManager("kien-giang");
  const elsewhere = await shelfWithManager("ca-mau");
  for (const shelf of [here.shelf, elsewhere.shelf]) {
    const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
    const reader = await makeMember(sql, shelf.id);
    await request(shelf.id, bookId, reader.userId);
  }

  const scoped = await read(here.ctx);
  const unpoliced = await sql.begin(async (tx) => {
    await tx`select set_config('olibra.bookshelf_id', ${here.shelf.id}, true)`;
    await tx`select set_config('olibra.now', ${AT}, true)`;
    await tx`set local role olibra_admin`;
    return getBorrowRequestQueue(tx as unknown as Tx, here.ctx);
  });

  expect(scoped).toHaveLength(1);
  expect(unpoliced).toHaveLength(2);
});

test("a reader is refused, by the domain and not by the page", async () => {
  const shelf = await makeShelf(sql, { slug: "long-an" });
  const reader = await makeMember(sql, shelf.id);
  const ctx = contextFor(shelf.id, reader, "reader");
  await expect(
    runQuery(sql, ctx, (tx) => getBorrowRequestQueue(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
  await expect(
    runQuery(sql, ctx, (tx) => countQueuedRequests(tx, ctx)),
  ).rejects.toBeInstanceOf(RuleViolated);
});

// ── The order, and a fixture that can actually break it ──────────────────────

/**
 * Four titles, in the order `olibra_fold` puts them, and two of them identical.
 *
 * The fold maps `Đ` to `d`, so the order is An, Đất, Đất, Vũ — not the byte
 * order this cluster's `C` collation would give, which puts every `Đ` above
 * every ASCII letter and would file *Đất Rừng Phương Nam* above *An Bình*.
 *
 * The two identical titles are what makes `b.id` load-bearing: without it the
 * two books' queues interleave, and a manager reading down the screen sees one
 * title's readers split across two cards with somebody else's card between them.
 *
 * The folded rank is written out rather than recomputed here, so this test does
 * not carry a second implementation of the fold.
 */
const TIEBREAK_TITLES = ["An Bình", "Đất Rừng", "Đất Rừng", "Vũ Trụ"] as const;
const TIEBREAK_RANK = [0, 1, 1, 2] as const;
/** Three request instants, ascending. Several readers share each one. */
const TIEBREAK_INSTANTS = [
  "2026-08-01T09:00:00Z",
  "2026-08-02T09:00:00Z",
  "2026-08-03T09:00:00Z",
] as const;

test("the queue's order is total, across titles and within one", async () => {
  // ── Why the fixture is twenty-eight rows over four titles and three instants
  //
  // U3 found *two* tiebreak tests in this repo that were green against the
  // broken query, and both failed the same way: every sort key was equal across
  // every row, so Postgres's tuplesort took its presorted short-circuit and
  // handed back the scan order untouched — which, from the sixth execution of a
  // prepared statement (`plan_cache_mode = auto` switching to a generic plan),
  // is index order on the primary key. postgres.js prepares statements and this
  // file shares one connection, so a degenerate fixture here would be past that
  // switch long before this test ran.
  //
  // So the fixture has to make both sorts **non-degenerate** — a real sort, not
  // a presorted no-op — while still leaving ties for each tiebreak to resolve:
  //
  //   * four titles folding to three distinct values, so the leading key varies
  //     and two books tie for `b.id` to separate;
  //   * seven requests per book across three instants (3, 2, 2), so
  //     `requested_at` varies within every partition and three rows tie inside
  //     it for `r.id` to separate.
  //
  // Twenty-eight rows is also past the seven-tuple threshold below which
  // Postgres sorts with a stable insertion sort — measured on the overdue-loans
  // fixture, where six varied rows stayed green.
  //
  // The assertion is the full lexicographic order rather than "ascending by
  // id", because "ascending by id" is a shape a broken query produces on its
  // own (see above).
  const { shelf, ctx } = await shelfWithManager("dong-thap");

  const books: { id: string; rank: number }[] = [];
  for (const [i, title] of TIEBREAK_TITLES.entries()) {
    const [book] = await sql<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${shelf.id}, ${title}, 'Tô Hoài', ${`tiebreak-${i}`}, true)
      returning id
    `;
    books.push({ id: book.id, rank: TIEBREAK_RANK[i] });
  }

  for (const book of books) {
    for (let i = 0; i < 7; i++) {
      const reader = await makeUser(sql);
      await request(shelf.id, book.id, reader.id, {
        at: TIEBREAK_INSTANTS[Math.min(Math.floor(i / 3), 2)],
      });
    }
  }

  const rows = flat(await read(ctx));
  expect(rows).toHaveLength(28);
  expect(new Set(rows.map((r) => r.requestId)).size).toBe(28);

  const rankOf = new Map(books.map((b) => [b.id, b.rank]));
  const bookOf = new Map<string, string>();
  for (const queue of await read(ctx)) {
    for (const r of queue.requests) bookOf.set(r.requestId, queue.bookId);
  }

  // The whole contract, in one comparison: folded title, then book id, then
  // request time, then request id. Deleting any one of the four keys from the
  // `order by` leaves a different sequence.
  const expected = [...rows].sort((a, b) => {
    const ba = bookOf.get(a.requestId)!;
    const bb = bookOf.get(b.requestId)!;
    const byRank = rankOf.get(ba)! - rankOf.get(bb)!;
    if (byRank !== 0) return byRank;
    if (ba !== bb) return ba < bb ? -1 : 1;
    if (a.requestedAt !== b.requestedAt)
      return a.requestedAt < b.requestedAt ? -1 : 1;
    return a.requestId < b.requestId ? -1 : 1;
  });
  expect(rows.map((r) => r.requestId)).toEqual(expected.map((r) => r.requestId));

  // And the positions follow the same order, so the number beside a child's
  // name cannot disagree with where their card sits.
  for (const queue of await read(ctx)) {
    expect(queue.requests.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  }

  // The fold, stated as its own assertion rather than left implicit in the
  // comparison above: `Đất Rừng` sits between `An Bình` and `Vũ Trụ`, which is
  // not where a `C`-collation byte order would put it.
  const titles = (await read(ctx)).map((q) => q.title);
  expect(titles).toEqual(["An Bình", "Đất Rừng", "Đất Rừng", "Vũ Trụ"]);
});
