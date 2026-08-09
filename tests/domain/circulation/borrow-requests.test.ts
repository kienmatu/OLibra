import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { messageFor } from "../../../src/domain/kernel/errors";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import { approveBorrowRequest } from "../../../src/domain/circulation/commands/approve-borrow-request";
import { cancelOwnRequest } from "../../../src/domain/circulation/commands/cancel-own-request";
import { createBorrowRequest } from "../../../src/domain/circulation/commands/create-borrow-request";
import { handoverRequest } from "../../../src/domain/circulation/commands/handover-request";
import { lendCopy } from "../../../src/domain/circulation/commands/lend-copy";
import { rejectBorrowRequest } from "../../../src/domain/circulation/commands/reject-borrow-request";
import { migrate } from "../../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql, withTwoConnections } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** The instant every fixture here is built at, unless a test moves it. */
const AT = "2026-08-07T10:00:00Z";

function readerContextFor(
  bookshelfId: string,
  member: { id: string; userId: string },
  instant = AT,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: member.userId, membershipId: member.id, role: "reader" },
    clock: fixedClock(instant),
  };
}

function managerContextFor(
  bookshelfId: string,
  manager: { id: string; userId: string },
  instant = AT,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock: fixedClock(instant),
  };
}

/** A shelf, a manager, one book with `copies` copies, and one reader. */
async function shelfWithQueue(slug: string, copies = 1) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, copies);
  const reader = await makeMember(sql, shelf.id);
  return {
    shelf,
    manager,
    bookId,
    copyIds,
    reader,
    manage: (instant?: string) => managerContextFor(shelf.id, manager, instant),
    read: (instant?: string) => readerContextFor(shelf.id, reader, instant),
  };
}

async function requestRow(id: string) {
  const [row] = await sql<
    {
      status: string;
      member_id: string;
      copy_id: string | null;
      requested_at: Date;
      hold_expires_at: Date | null;
      decided_by: string | null;
      decided_at: Date | null;
      decision_note: string | null;
      cancelled_at: Date | null;
      fulfilled_loan_id: string | null;
    }[]
  >`
    select status, member_id, copy_id, requested_at, hold_expires_at,
           decided_by, decided_at, decision_note, cancelled_at, fulfilled_loan_id
      from borrow_requests where id = ${id}
  `;
  return row;
}

async function copyState(id: string): Promise<string> {
  const [row] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${id}
  `;
  return row.state;
}

// ── CreateBorrowRequest ──────────────────────────────────────────────────────

test("a reader joins the queue, and the row carries their user id", async () => {
  // The trap this whole slice is written around. `borrow_requests.member_id` is
  // `not null references users(id)` despite its name (verified live against
  // `pg_constraint`), so the command has to resolve the membership it was given
  // into a user id. Read back out of the database rather than asserted against
  // what the test passed in, because the point is what the *column* holds.
  const { bookId, reader, read } = await shelfWithQueue("dong-thap");

  const { requestId } = await runCommand(sql, read(), createBorrowRequest, {
    bookId,
    membershipId: reader.id,
  });

  const row = await requestRow(requestId);
  expect(row.status).toBe("pending");
  expect(row.member_id).toBe(reader.userId);
  expect(row.member_id).not.toBe(reader.id);
});

test("requested_at is the injected clock's instant, not the database's", async () => {
  // `requested_at` carries `default now()` (verified live), and it is the
  // queue's ordering key — while every hold derived from it is compared against
  // `olibra_now()`, which follows `ctx.clock`. Letting the default fill it in
  // orders a queue by the database host's clock and expires its holds by the
  // injected one, which is DB §6's "two clocks in one transaction".
  //
  // The fixture clock is deliberately in the past, so a `requested_at` written
  // by `now()` would be minutes or years away from it rather than accidentally
  // equal. Delete the column from the insert and this fails on every run.
  const { bookId, reader, read } = await shelfWithQueue("can-tho");

  const { requestId } = await runCommand(
    sql,
    read("2026-08-07T10:00:00Z"),
    createBorrowRequest,
    { bookId, membershipId: reader.id },
  );

  expect((await requestRow(requestId)).requested_at.toISOString()).toBe(
    "2026-08-07T10:00:00.000Z",
  );
});

test("a copy being free is not a reason to refuse a request", async () => {
  // BR §7.2 and OPS §4.2: a reader may "queue even when copies exist". Nothing
  // in this command reads `book_copies` at all — a request is a statement of
  // intent, and the claim on a physical object is made by the manager, on a
  // copy they chose. A command that checked availability would silently turn
  // "Xin mượn" into a lend button that fails when the shelf is stocked.
  const { bookId, reader, read, copyIds } = await shelfWithQueue("ben-tre");
  expect(await copyState(copyIds[0])).toBe("available");

  await expect(
    runCommand(sql, read(), createBorrowRequest, {
      bookId,
      membershipId: reader.id,
    }),
  ).resolves.toMatchObject({ requestId: expect.any(String) });
});

test("a second request for the same title is refused, pending or approved", async () => {
  const { bookId, copyIds, reader, read, manage } =
    await shelfWithQueue("vinh-long");

  const { requestId } = await runCommand(sql, read(), createBorrowRequest, {
    bookId,
    membershipId: reader.id,
  });
  await expect(
    runCommand(sql, read(), createBorrowRequest, {
      bookId,
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "duplicate_request" });

  // And once their turn has come. `approved` counts as well as `pending`
  // because a child whose copy is on the shelf with their name on it has a
  // request in flight — restricting the check to `pending` would let one reader
  // hold a copy *and* stand in the queue for the same title.
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await expect(
    runCommand(sql, read(), createBorrowRequest, {
      bookId,
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "duplicate_request" });

  expect(await sql`select 1 from borrow_requests`).toHaveLength(1);
});

test("a cancelled request does not block a second attempt", async () => {
  // The other half of the rule above, and the half that matters to a child who
  // changed their mind: `cancelled` is terminal, so nothing is in flight and
  // the queue is open again. A duplicate check written as "any row for this
  // book" would lock them out permanently.
  const { bookId, reader, read } = await shelfWithQueue("soc-trang");

  const first = await runCommand(sql, read(), createBorrowRequest, {
    bookId,
    membershipId: reader.id,
  });
  await runCommand(sql, read(), cancelOwnRequest, { requestId: first.requestId });

  await expect(
    runCommand(sql, read(), createBorrowRequest, {
      bookId,
      membershipId: reader.id,
    }),
  ).resolves.toMatchObject({ requestId: expect.any(String) });
});

test("a suspended reader is refused in the queue's own words", async () => {
  const shelf = await makeShelf(sql, { slug: "hau-giang" });
  const { bookId } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id, { status: "suspended" });

  await expect(
    runCommand(sql, readerContextFor(shelf.id, reader), createBorrowRequest, {
      bookId,
      membershipId: reader.id,
    }),
  ).rejects.toMatchObject({ code: "membership_not_active_cannot_request" });

  // The refusal a reader actually reads. OPS §4.2 words this one "không thể
  // gửi yêu cầu mượn" (`:293`) and LendCopy's "không thể mượn thêm" (`:233`),
  // and the second would tell a suspended child the queue is still open.
  expect(messageFor("membership_not_active_cannot_request")).toBe(
    "Tài khoản đang tạm khoá, không thể gửi yêu cầu mượn.",
  );
  expect(await sql`select 1 from borrow_requests`).toHaveLength(0);
});

test("a reader cannot queue under somebody else's name", async () => {
  // `requireReader` ranks a role; it cannot express "own". Without the
  // comparison against `ctx.actor.membershipId`, editing one hidden field puts
  // another child in a queue under that child's name — and the audit row would
  // name the person whose id was posted, not the person who posted it.
  const { shelf, bookId, read } = await shelfWithQueue("bac-lieu");
  const other = await makeMember(sql, shelf.id);

  await expect(
    runCommand(sql, read(), createBorrowRequest, {
      bookId,
      membershipId: other.id,
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
  expect(await sql`select 1 from borrow_requests`).toHaveLength(0);
});

test("a book from another shelf is not found rather than refused", async () => {
  // INV-10. RLS filters the select before the command sees it, so "another
  // shelf's book" and "no such book" are one answer — telling them apart would
  // confirm the other shelf's book exists.
  const here = await shelfWithQueue("tra-vinh");
  const elsewhere = await makeShelf(sql, { slug: "ca-mau" });
  const { bookId: theirs } = await makeBookWithCopies(sql, elsewhere.id, 1);

  await expect(
    runCommand(sql, here.read(), createBorrowRequest, {
      bookId: theirs,
      membershipId: here.reader.id,
    }),
  ).rejects.toMatchObject({ code: "book_not_found" });
});

// ── ApproveBorrowRequest ─────────────────────────────────────────────────────

/** A pending request from `reader` for `bookId`, through the real command. */
async function queued(
  shelfId: string,
  bookId: string,
  reader: { id: string; userId: string },
  instant = AT,
): Promise<string> {
  const { requestId } = await runCommand(
    sql,
    readerContextFor(shelfId, reader, instant),
    createBorrowRequest,
    { bookId, membershipId: reader.id },
  );
  return requestId;
}

test("approving puts the copy aside and starts the hold clock", async () => {
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("kien-giang");
  const requestId = await queued(shelf.id, bookId, reader);

  const result = await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  const row = await requestRow(requestId);
  expect(row.status).toBe("approved");
  expect(row.copy_id).toBe(copyIds[0]);
  // `hold_days` defaults to 3 (BR §5.5) and the expiry is counted from the
  // injected clock, never from `now()` — see `holdExpiryFrom`.
  expect(row.hold_expires_at?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  expect(result.holdExpiresAt.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  expect(row.decided_at?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  expect(row.decided_by).not.toBeNull();

  // BR §7.1's `available → held`. This settles the question C1 left open in
  // `inv-03-only-available-or-own-hold.test.ts:185-212`: the hold shows up in
  // `book_copies.state` as well as in the request row.
  expect(await copyState(copyIds[0])).toBe("held");
});

test("an approved copy leaves copies_borrowable, and the clock alone gives it back", async () => {
  // Master §7.6's acceptance, end to end and with no sleep anywhere: the row is
  // written once and read twice through two different `fixedClock`s. Nothing
  // expires the hold — the clock moves past `hold_expires_at` and
  // `copies_borrowable` stops excluding it.
  //
  // The copy is left in `held`, deliberately: BR §7.1 has no arrow a *read*
  // performs, so the view's hold clause stops firing while the state clause
  // still does. The second assertion below is what that looks like, and it is
  // the reason `cancelOwnRequest` and a manager's own `held → available` exist.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("dong-nai");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  const borrowable = (instant: string) =>
    runQuery(
      sql,
      manage(instant),
      (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
    );

  expect(await borrowable("2026-08-10T09:59:00Z")).toHaveLength(0);
  // Still zero after expiry, because the *state* clause now holds it out. The
  // hold clause genuinely stopped firing — proved by the row being untouched
  // below, and by `handoverRequest` answering `hold_expired` from the same
  // fixture in a later test.
  expect(await borrowable("2026-08-10T10:01:00Z")).toHaveLength(0);

  const row = await requestRow(requestId);
  expect(row.hold_expires_at?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  expect(row.status).toBe("approved");
});

test("a copy of a different title cannot be assigned to a request", async () => {
  // OPS §4.2: "an available copy of the requested title". The `book_id` filter
  // is what makes that clause real; without it a manager clearing a queue could
  // put a child's name on the wrong book and the screen would say it worked.
  const { shelf, bookId, reader, manage } = await shelfWithQueue("long-an");
  const other = await makeBookWithCopies(sql, shelf.id, 1);
  const requestId = await queued(shelf.id, bookId, reader);

  await expect(
    runCommand(sql, manage(), approveBorrowRequest, {
      requestId,
      copyId: other.copyIds[0],
    }),
  ).rejects.toMatchObject({ code: "copy_not_found" });
  expect((await requestRow(requestId)).status).toBe("pending");
});

test("a copy already held or on loan cannot be promised again", async () => {
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue(
    "tien-giang",
    2,
  );
  const second = await makeMember(sql, shelf.id);
  const third = await makeMember(sql, shelf.id);

  const first = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId: first,
    copyId: copyIds[0],
  });

  // The same copy, a different reader — INV-3's premise, from the approval
  // side. `copyLendable` would say yes to the holder here; `copyHoldable` says
  // no to everybody, which is the difference between the two predicates.
  const next = await queued(shelf.id, bookId, second);
  await expect(
    runCommand(sql, manage(), approveBorrowRequest, {
      requestId: next,
      copyId: copyIds[0],
    }),
  ).rejects.toMatchObject({ code: "no_copy_available" });

  // And a copy that is out with somebody.
  await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[1],
    membershipId: third.id,
  });
  await expect(
    runCommand(sql, manage(), approveBorrowRequest, {
      requestId: next,
      copyId: copyIds[1],
    }),
  ).rejects.toMatchObject({ code: "no_copy_available" });

  expect((await requestRow(next)).status).toBe("pending");
});

test("a lost copy cannot be put aside, and says so in its own words", async () => {
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("go-cong");
  const requestId = await queued(shelf.id, bookId, reader);
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;

  await expect(
    runCommand(sql, manage(), approveBorrowRequest, {
      requestId,
      copyId: copyIds[0],
    }),
  ).rejects.toMatchObject({ code: "chosen_copy_lost_or_retired" });
  expect(messageFor("chosen_copy_lost_or_retired")).toBe(
    "Bản sách đã chọn đã mất hoặc ngừng dùng.",
  );
});

test("a request that has already been decided cannot be approved again", async () => {
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue(
    "my-tho",
    2,
  );
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  // A double-submit from a stale queue page. Refused, and — the half a
  // `rejects` alone does not prove — the second copy is untouched, so a
  // re-click cannot quietly move the hold onto a different book.
  await expect(
    runCommand(sql, manage(), approveBorrowRequest, {
      requestId,
      copyId: copyIds[1],
    }),
  ).rejects.toMatchObject({ code: "request_not_pending" });
  expect(await copyState(copyIds[1])).toBe("available");
  expect((await requestRow(requestId)).copy_id).toBe(copyIds[0]);
});

test("two managers approving two readers onto one copy: the second is refused", async () => {
  // OPS §6, applied to the one write in this slice that no constraint
  // arbitrates: `borrow_requests` has no uniqueness on `copy_id` (verified
  // against `pg_indexes`), so two transactions that both read the copy
  // `available` would both write a hold — two live holds on one physical book,
  // INV-3's premise broken with nothing to catch it.
  //
  // `for update of c` is what makes the second wait; under `read committed`
  // Postgres re-fetches the row it waited for, so the loser's `copyHoldable`
  // sees `held`. Two genuinely separate connections, because a single one
  // cannot reproduce the race and a test that cannot reproduce it would pass
  // against a command with no lock at all.
  const { shelf, bookId, copyIds, reader, manager } =
    await shelfWithQueue("phu-tan");
  const second = await makeMember(sql, shelf.id);
  const a = await queued(shelf.id, bookId, reader);
  const b = await queued(shelf.id, bookId, second);
  const ctx = managerContextFor(shelf.id, manager);

  const outcomes = await withTwoConnections(async (one, two) =>
    Promise.allSettled([
      runCommand(one, ctx, approveBorrowRequest, {
        requestId: a,
        copyId: copyIds[0],
      }),
      runCommand(two, ctx, approveBorrowRequest, {
        requestId: b,
        copyId: copyIds[0],
      }),
    ]),
  );

  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const rejected = outcomes.filter((o) => o.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]).toMatchObject({ reason: { code: "no_copy_available" } });

  const holds = await sql`
    select 1 from borrow_requests
     where copy_id = ${copyIds[0]} and status = 'approved'
  `;
  expect(holds).toHaveLength(1);
});

// ── RejectBorrowRequest ──────────────────────────────────────────────────────

test("rejecting is terminal, keeps the row, and records the reason", async () => {
  const { shelf, bookId, reader, manage } = await shelfWithQueue("chau-doc");
  const requestId = await queued(shelf.id, bookId, reader);

  await runCommand(sql, manage(), rejectBorrowRequest, {
    requestId,
    reason: "Sách đang được sửa bìa",
  });

  const row = await requestRow(requestId);
  expect(row.status).toBe("rejected");
  // G10 and BR §2: nothing is deleted, so "why did this not happen" has an
  // answer six months later. `decision_note` is the column — there is no
  // `rejection_reason` on this table (verified live).
  expect(row.decision_note).toBe("Sách đang được sửa bìa");
  expect(row.decided_by).not.toBeNull();
  expect(row.decided_at?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
});

test("the reason is optional, and an empty one is stored as no reason", async () => {
  // Q2, on the assumed reading the C2 plan §3.4 records: the queue screen's
  // *Từ chối* button carries no "cần ghi lý do" statement and OPS §4.2 lists no
  // `reason_required` here, unlike `RejectMembership`. A blank string would
  // read, a year later, as a manager who wrote something illegible.
  const { shelf, bookId, reader, manage } = await shelfWithQueue("tan-chau");
  const bare = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), rejectBorrowRequest, { requestId: bare });
  expect((await requestRow(bare)).decision_note).toBeNull();

  const other = await makeMember(sql, shelf.id);
  const blank = await queued(shelf.id, bookId, other);
  await runCommand(sql, manage(), rejectBorrowRequest, {
    requestId: blank,
    reason: "   ",
  });
  expect((await requestRow(blank)).decision_note).toBeNull();
});

test("a decided request cannot be rejected", async () => {
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("an-giang");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  await expect(
    runCommand(sql, manage(), rejectBorrowRequest, { requestId }),
  ).rejects.toMatchObject({ code: "request_not_pending" });
  expect((await requestRow(requestId)).status).toBe("approved");
});

// ── CancelOwnRequest ─────────────────────────────────────────────────────────

test("a reader withdraws a pending request", async () => {
  const { shelf, bookId, reader, read } = await shelfWithQueue("cao-lanh");
  const requestId = await queued(shelf.id, bookId, reader);

  const result = await runCommand(sql, read(), cancelOwnRequest, { requestId });

  const row = await requestRow(requestId);
  expect(row.status).toBe("cancelled");
  expect(row.cancelled_at?.toISOString()).toBe("2026-08-07T10:00:00.000Z");
  expect(result.releasedCopyId).toBeNull();
});

test("withdrawing a held request puts the copy back on the shelf", async () => {
  // OPS §4.2 lists INV-2 under this command as "releases the hold if one
  // exists". Without it the request goes on naming the copy, so
  // `copies_borrowable`'s hold clause keeps excluding it for the rest of
  // `hold_days` while the book sits on the shelf — and `book_copies.state`
  // keeps saying `held` with nobody left to hand it to.
  const { shelf, bookId, copyIds, reader, read, manage } =
    await shelfWithQueue("sa-dec");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  expect(await copyState(copyIds[0])).toBe("held");

  const result = await runCommand(sql, read(), cancelOwnRequest, { requestId });

  expect(result.releasedCopyId).toBe(copyIds[0]);
  expect(await copyState(copyIds[0])).toBe("available");
  const borrowable = await runQuery(
    sql,
    read(),
    (tx) => tx<{ id: string }[]>`select id from copies_borrowable`,
  );
  expect(borrowable.map((r) => r.id)).toEqual([copyIds[0]]);
});

test("withdrawing never drags a copy that has moved on back to available", async () => {
  // The guard is `state = 'held'`, not `copy_id is not null`. A copy reported
  // lost while a stale hold still named it would otherwise be put back on the
  // shelf by a reader tidying up their own dashboard — a lost book the
  // catalogue then offers to the next child.
  const { shelf, bookId, copyIds, reader, read, manage } =
    await shelfWithQueue("lai-vung");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;

  const result = await runCommand(sql, read(), cancelOwnRequest, { requestId });

  expect(result.releasedCopyId).toBeNull();
  expect(await copyState(copyIds[0])).toBe("lost");
  expect((await requestRow(requestId)).status).toBe("cancelled");
});

test("a reader cannot withdraw somebody else's request", async () => {
  const { shelf, bookId, reader } = await shelfWithQueue("hong-ngu");
  const other = await makeMember(sql, shelf.id);
  const requestId = await queued(shelf.id, bookId, reader);

  await expect(
    runCommand(sql, readerContextFor(shelf.id, other), cancelOwnRequest, {
      requestId,
    }),
  ).rejects.toMatchObject({ code: "not_own_request" });
  expect((await requestRow(requestId)).status).toBe("pending");
});

test("the ownership comparison is on user ids, and a membership id never matches", async () => {
  // The same trap `copyLendable`'s parameter names exist to make unwriteable,
  // one command over — and here there is no pure predicate to unit-test, so
  // this is the only place it can be pinned. Comparing `member_id` against
  // `ctx.actor.membershipId` would refuse *every* cancellation as somebody
  // else's, and a reader would simply never be able to withdraw anything.
  const { shelf, bookId, reader, read } = await shelfWithQueue("thanh-binh");
  const requestId = await queued(shelf.id, bookId, reader);

  expect((await requestRow(requestId)).member_id).toBe(reader.userId);
  expect(read().actor.membershipId).toBe(reader.id);
  expect(reader.userId).not.toBe(reader.id);

  await expect(
    runCommand(sql, read(), cancelOwnRequest, { requestId }),
  ).resolves.toMatchObject({ requestId });
});

test("a fulfilled request cannot be withdrawn, and says why", async () => {
  const { shelf, bookId, copyIds, reader, read, manage } =
    await shelfWithQueue("tam-nong");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await runCommand(sql, manage(), handoverRequest, { requestId });

  await expect(
    runCommand(sql, read(), cancelOwnRequest, { requestId }),
  ).rejects.toMatchObject({ code: "request_already_fulfilled" });
  // The copy stays with the child. A cancellation that released it would put a
  // book on the shelf that is in somebody's bag.
  expect(await copyState(copyIds[0])).toBe("on_loan");
});

// ── HandoverRequest ──────────────────────────────────────────────────────────

test("handing over the held copy creates the loan and closes the request", async () => {
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("thap-muoi");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  const { loanId, dueOn } = await runCommand(sql, manage(), handoverRequest, {
    requestId,
  });

  expect(await copyState(copyIds[0])).toBe("on_loan");
  // BR §5.5's `loan_days`, defaulting to 14, counted from the local date.
  expect(dueOn).toBe("2026-08-21");

  const row = await requestRow(requestId);
  expect(row.status).toBe("fulfilled");
  expect(row.fulfilled_loan_id).toBe(loanId);

  // The two rows point at each other (`loans.request_id` is "originating
  // request", `0005_circulation.sql:21`). Writing only one would leave a loan
  // that came out of a queue looking, from its own row, like a walk-up lend.
  const [loan] = await sql<{ borrower_id: string; request_id: string | null }[]>`
    select borrower_id, request_id from loans where id = ${loanId}
  `;
  expect(loan.request_id).toBe(requestId);
  expect(loan.borrower_id).toBe(reader.userId);
});

test("the handover writes loan.created and request.fulfilled in one transaction", async () => {
  // OPS §4.2 specifies the pair for this command. Two facts about two records,
  // one manager action, one transaction — G3.
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue("lap-vo");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await runCommand(sql, manage(), handoverRequest, { requestId });

  const entries = await sql<{ action: string }[]>`
    select action from audit_log
     where action in ('loan.created', 'request.fulfilled')
     order by action
  `;
  expect(entries.map((e) => e.action)).toEqual([
    "loan.created",
    "request.fulfilled",
  ]);
});

test("a hold that lapsed by the clock alone can no longer be handed over", async () => {
  // Master §7.6's acceptance criterion, as a command refusal. Nothing runs, no
  // row is written, no wall-clock time passes — the manager's context carries a
  // later instant and the hold that was live a moment ago is not.
  //
  // The refusal is `hold_expired` and not `copy_not_available`, which is why
  // this command checks expiry itself before delegating: a lapsed hold leaves
  // the copy in `held` with no live row naming its holder, so `lendCopy` would
  // answer "Bản sách này đang được mượn hoặc đang giữ chỗ." about a book
  // sitting on the shelf, and tell a volunteer nothing about what to do next.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("chau-thanh");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });

  await expect(
    runCommand(sql, manage("2026-08-10T10:01:00Z"), handoverRequest, { requestId }),
  ).rejects.toMatchObject({ code: "hold_expired" });

  expect(await sql`select 1 from loans`).toHaveLength(0);
  const row = await requestRow(requestId);
  expect(row.status).toBe("approved");
  expect(row.hold_expires_at?.toISOString()).toBe("2026-08-10T10:00:00.000Z");
  // A minute earlier, the identical call succeeds — so the refusal above is the
  // clock's doing and not the fixture's.
  await expect(
    runCommand(sql, manage("2026-08-10T09:59:00Z"), handoverRequest, { requestId }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});

test("a request with nothing held for it is refused, whatever state it is in", async () => {
  // The C2 plan §8's case: OPS gives this command three failure modes and none
  // of them describes a request that never had a hold. A stale queue page posts
  // exactly this.
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue(
    "tan-hong",
    2,
  );

  // Pending: nobody approved it, so there is no copy to hand over.
  const pending = await queued(shelf.id, bookId, reader);
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: pending }),
  ).rejects.toMatchObject({ code: "request_not_held" });

  // Rejected: a manager already said no.
  const second = await makeMember(sql, shelf.id);
  const rejected = await queued(shelf.id, bookId, second);
  await runCommand(sql, manage(), rejectBorrowRequest, { requestId: rejected });
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: rejected }),
  ).rejects.toMatchObject({ code: "request_not_held" });

  // Cancelled after the hold was made: the copy went back on the shelf, and
  // the row still names it — which is exactly why the check is on the status
  // and not on `copy_id is not null`.
  const third = await makeMember(sql, shelf.id);
  const cancelled = await queued(shelf.id, bookId, third);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId: cancelled,
    copyId: copyIds[0],
  });
  await runCommand(sql, readerContextFor(shelf.id, third), cancelOwnRequest, {
    requestId: cancelled,
  });
  expect((await requestRow(cancelled)).copy_id).toBe(copyIds[0]);
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: cancelled }),
  ).rejects.toMatchObject({ code: "request_not_held" });

  // A request id naming nothing at all — the same answer, deliberately, so a
  // guessed uuid learns nothing about another shelf's queue.
  await expect(
    runCommand(sql, manage(), handoverRequest, {
      requestId: "00000000-0000-0000-0000-000000000000",
    }),
  ).rejects.toMatchObject({ code: "request_not_held" });

  expect(await sql`select 1 from loans`).toHaveLength(0);
});

test("the copy-side refusal is copyLendable's, not a second rule", async () => {
  // C2 plan §3.2: the risk is that this command "grows a second definition of
  // who may take a held copy". These two codes are the proof it did not —
  // neither `copy_lost_or_retired` nor `copy_not_available` appears anywhere in
  // `handover-request.ts`, and neither is reachable through
  // `hold_expired`/`request_not_held`, which are the only refusals that file
  // writes. They can only have come from `copyLendable`, through `lendCopy`.
  //
  // Both fixtures are states the schema admits and no command produces: a live
  // hold naming a copy somebody has meanwhile reported lost, and one naming a
  // copy that is out on loan (INV-2 across two tables — DB §4.4). The second is
  // exactly the window `inv-02-not-held-and-on-loan.test.ts` is about.
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue(
    "nha-mat",
    2,
  );
  const lostOne = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId: lostOne,
    copyId: copyIds[0],
  });
  await sql`update book_copies set state = 'lost' where id = ${copyIds[0]}`;
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: lostOne }),
  ).rejects.toMatchObject({ code: "copy_lost_or_retired" });

  const other = await makeMember(sql, shelf.id);
  const onLoanOne = await queued(shelf.id, bookId, other);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId: onLoanOne,
    copyId: copyIds[1],
  });
  await sql`update book_copies set state = 'on_loan' where id = ${copyIds[1]}`;
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: onLoanOne }),
  ).rejects.toMatchObject({ code: "copy_not_available" });

  expect(await sql`select 1 from loans`).toHaveLength(0);
});

test("a suspended holder, and one at the loan limit, are both refused at handover", async () => {
  // INV-4 and INV-5, enforced by the same lines that enforce them for a walk-up
  // lend — which is the whole reason this command delegates rather than
  // restating. OPS §4.2 lists both under `HandoverRequest` (`:245`, `:246`) and
  // words them exactly as `LendCopy` does.
  const { shelf, bookId, copyIds, reader, manage } = await shelfWithQueue(
    "my-an",
    2,
  );
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await sql`update memberships set status = 'suspended' where id = ${reader.id}`;

  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId }),
  ).rejects.toMatchObject({ code: "membership_not_active" });

  // Reactivated, but already at the shelf's limit of one.
  await sql`update memberships set status = 'active' where id = ${reader.id}`;
  await sql`
    update bookshelves
       set settings = settings || ${sql.json({ max_concurrent_loans: 1 })}
     where id = ${shelf.id}
  `;
  await runCommand(sql, manage(), lendCopy, {
    copyId: copyIds[1],
    membershipId: reader.id,
  });
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId }),
  ).rejects.toMatchObject({ code: "loan_limit_reached" });
});

test("a withdrawn request stays unheld even after its would-be expiry", async () => {
  // The one case that separates the status check from the expiry check, and
  // the reason both exist. `cancelOwnRequest` leaves `copy_id` and
  // `hold_expires_at` where they stand — deliberately, they are the record of
  // what the reader gave up — so a cancelled row still carries a timestamp,
  // and a command that reached the expiry comparison first would tell a
  // volunteer "Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại." about a
  // request the child withdrew themselves.
  //
  // Falsified by deleting the `status !== "approved"` line: this goes red with
  // `hold_expired`, and nothing else in the file notices.
  const { shelf, bookId, copyIds, reader, manage, read } =
    await shelfWithQueue("my-hiep");
  const requestId = await queued(shelf.id, bookId, reader);
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId,
    copyId: copyIds[0],
  });
  await runCommand(sql, read(), cancelOwnRequest, { requestId });
  const row = await requestRow(requestId);
  expect(row.copy_id).toBe(copyIds[0]);
  expect(row.hold_expires_at?.toISOString()).toBe("2026-08-10T10:00:00.000Z");

  await expect(
    runCommand(sql, manage("2026-08-11T10:00:00Z"), handoverRequest, {
      requestId,
    }),
  ).rejects.toMatchObject({ code: "request_not_held" });
});

test("the handover fulfils the request it was asked about, never an earlier one", async () => {
  // `lendCopy` collects *the earliest live approved hold on the copy*, which is
  // the right rule for a walk-up lend that knows a copy and a reader and not a
  // request. Here the request is the input, so this command checks that the
  // hold `lendCopy` will find is the one it was asked about.
  //
  // Two live approved holds on one copy is a state `approveBorrowRequest`'s row
  // lock exists to prevent and no constraint enforces, so the fixture is
  // written by hand — this is the shape a bug elsewhere, or a hand-edited row,
  // would leave behind. Without the check the manager scans the second child's
  // card, the book goes to the second child, and the *first* child's request is
  // the one that closes as fulfilled.
  //
  // Falsified by deleting the `firstHold?.id !== request.id` line: the handover
  // succeeds and `first` comes back `fulfilled` while `second` stays `approved`.
  const { shelf, bookId, copyIds, reader, manage } =
    await shelfWithQueue("truong-xuan");
  const other = await makeMember(sql, shelf.id);
  const first = await queued(shelf.id, bookId, reader, "2026-08-06T10:00:00Z");
  const second = await queued(shelf.id, bookId, other, "2026-08-07T10:00:00Z");
  await runCommand(sql, manage(), approveBorrowRequest, {
    requestId: first,
    copyId: copyIds[0],
  });
  // The second hold, written straight to the table because no command produces
  // it: `copyHoldable` refuses a copy that is already `held`.
  await sql`
    update borrow_requests
       set status = 'approved',
           copy_id = ${copyIds[0]},
           hold_expires_at = timestamptz '2026-08-10T10:00:00Z'
     where id = ${second}
  `;

  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: second }),
  ).rejects.toMatchObject({ code: "request_not_held" });
  expect(await sql`select 1 from loans`).toHaveLength(0);
  expect((await requestRow(first)).status).toBe("approved");

  // The earlier hold is still handable over, from the same fixture — so the
  // refusal above is about *which* request, not about the copy.
  await expect(
    runCommand(sql, manage(), handoverRequest, { requestId: first }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });
});
