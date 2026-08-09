import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { runCommand, runQuery } from "../../../src/domain/kernel/unit-of-work";
import {
  createAnnouncement,
  hideAnnouncement,
  pinAnnouncement,
  publishAnnouncement,
  unpinAnnouncement,
  updateAnnouncement,
} from "../../../src/domain/community/commands/announcements";
import {
  getAllAnnouncements,
  getAnnouncements,
} from "../../../src/domain/community/queries/get-announcements";
import {
  markFeedbackRead,
  phoneHash,
  resolveFeedback,
  submitFeedback,
} from "../../../src/domain/community/commands/feedback";
import {
  declineDonation,
  offerDonation,
  receiveDonation,
} from "../../../src/domain/community/commands/donations";
import { migrate } from "../../../src/db/migrate";
import { makeMember } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { SCENARIO_CLOCK, managerContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const LATER = "2026-08-20T10:00:00Z";

function readerContext(
  bookshelfId: string,
  reader: { id: string; userId: string },
  instant = SCENARIO_CLOCK,
): TenantContext {
  return {
    bookshelfId,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock: fixedClock(instant),
  };
}

// ── Announcements ──────────────────────────────────────────────────────────

test("a draft is invisible to a member and visible to a manager", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  await runCommand(sql, ctx, createAnnouncement, {
    title: "Nghỉ lễ tuần này",
    body: "Tủ sách nghỉ Chúa nhật này.",
  });

  expect(
    await runQuery(sql, readerContext(shelf.id, reader), getAnnouncements),
  ).toEqual([]);
  expect(await runQuery(sql, ctx, getAllAnnouncements)).toHaveLength(1);
});

test("an announcement lapses on the clock alone, with no write and no job", async () => {
  // G5. The same rule `copies_borrowable` follows for holds and `loans_current`
  // for overdue status: expiry is a comparison at read time, so nothing has to
  // run for a lapsed announcement to stop showing.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const { announcementId } = await runCommand(sql, ctx, createAnnouncement, {
    title: "Chỉ trong tuần này",
    body: "Hết tuần là thôi.",
  });
  await runCommand(sql, ctx, publishAnnouncement, {
    announcementId,
    expiresAt: new Date("2026-08-10T00:00:00Z"),
  });

  expect(
    await runQuery(sql, readerContext(shelf.id, reader), getAnnouncements),
  ).toHaveLength(1);

  // No write between these two reads — only the clock moves.
  const auditBefore = await sql`select id from audit_log`;
  expect(
    await runQuery(sql, readerContext(shelf.id, reader, LATER), getAnnouncements),
  ).toEqual([]);
  expect(await sql`select id from audit_log`).toHaveLength(auditBefore.length);

  // And a manager still sees it, because managing a lapsed announcement is
  // exactly what the reader-facing filter gets in the way of.
  expect(await runQuery(sql, ctx, getAllAnnouncements)).toHaveLength(1);
});

test("pinned comes first, then most recent — and more than one may be pinned", async () => {
  // BR §16.1's ordering, and OPS §4.4's reading of the open question: an
  // ordering *among* pins only means something if more than one may exist.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);

  const ids: string[] = [];
  for (const title of ["Thông báo một", "Thông báo hai", "Thông báo ba"]) {
    const { announcementId } = await runCommand(sql, ctx, createAnnouncement, {
      title,
      body: title,
    });
    await runCommand(sql, ctx, publishAnnouncement, { announcementId });
    ids.push(announcementId);
  }
  await runCommand(sql, ctx, pinAnnouncement, { announcementId: ids[0] });
  await runCommand(sql, ctx, pinAnnouncement, { announcementId: ids[1] });

  const rows = await runQuery(
    sql,
    readerContext(shelf.id, reader),
    getAnnouncements,
  );
  expect(rows.slice(0, 2).map((r) => r.isPinned)).toEqual([true, true]);
  expect(rows[2].isPinned).toBe(false);

  await runCommand(sql, ctx, unpinAnnouncement, { announcementId: ids[0] });
  const after = await runQuery(
    sql,
    readerContext(shelf.id, reader),
    getAnnouncements,
  );
  expect(after.filter((r) => r.isPinned)).toHaveLength(1);
});

test("hiding returns an announcement to draft, so it can be posted again", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const { announcementId } = await runCommand(sql, ctx, createAnnouncement, {
    title: "Sẽ bị ẩn",
    body: "Nội dung",
  });
  await runCommand(sql, ctx, publishAnnouncement, { announcementId });

  await runCommand(sql, ctx, hideAnnouncement, { announcementId });
  expect(
    await runQuery(sql, readerContext(shelf.id, reader), getAnnouncements),
  ).toEqual([]);

  // "Đăng lại" — the same command, and it works because hiding cleared
  // `published_at` rather than setting a separate flag.
  await runCommand(sql, ctx, publishAnnouncement, { announcementId });
  expect(
    await runQuery(sql, readerContext(shelf.id, reader), getAnnouncements),
  ).toHaveLength(1);
});

test("a blank title or body is refused, and a slug collision gets a suffix", async () => {
  const { ctx } = await managerContext(sql);
  await expect(
    runCommand(sql, ctx, createAnnouncement, { title: "  ", body: "x" }),
  ).rejects.toMatchObject({ code: "announcement_fields_required" });

  const first = await runCommand(sql, ctx, createAnnouncement, {
    title: "Nghỉ lễ",
    body: "a",
  });
  const second = await runCommand(sql, ctx, createAnnouncement, {
    title: "Nghỉ lễ",
    body: "b",
  });
  expect(first.slug).toBe("nghi-le");
  expect(second.slug).toBe("nghi-le-2");
});

test("updating leaves an untouched expiry alone and can clear one", async () => {
  // The three-case field: absent means leave it, null means clear it, a date
  // means set it. A `coalesce` would conflate the first two and make "this no
  // longer expires" unexpressible.
  const { ctx } = await managerContext(sql);
  const { announcementId } = await runCommand(sql, ctx, createAnnouncement, {
    title: "Có hạn",
    body: "x",
    expiresAt: new Date("2026-08-10T00:00:00Z"),
  });

  await runCommand(sql, ctx, updateAnnouncement, {
    announcementId,
    title: "Đổi tên",
  });
  let [row] = await sql<{ expires_at: Date | null; title: string }[]>`
    select expires_at, title from announcements
  `;
  expect(row.title).toBe("Đổi tên");
  expect(row.expires_at).not.toBeNull();

  await runCommand(sql, ctx, updateAnnouncement, {
    announcementId,
    expiresAt: null,
  });
  [row] = await sql<{ expires_at: Date | null; title: string }[]>`
    select expires_at, title from announcements
  `;
  expect(row.expires_at).toBeNull();
});

// ── Feedback ───────────────────────────────────────────────────────────────

test("feedback stores a hash of the number and the fourth in a day is refused", async () => {
  // OPS §8: three per phone per day. The window is the injected clock's, so
  // this needs no sleeping — and the next day's first must go through, which is
  // what distinguishes a window from a permanent ban.
  const { shelf, ctx } = await managerContext(sql);
  const guest: TenantContext = {
    ...ctx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };

  for (let i = 0; i < 3; i++) {
    await runCommand(sql, guest, submitFeedback, {
      bookshelfId: shelf.id,
      senderName: "Chị Hạnh",
      phone: "0912 345 678",
      body: `Góp ý số ${i + 1}`,
    });
  }

  await expect(
    runCommand(sql, guest, submitFeedback, {
      bookshelfId: shelf.id,
      senderName: "Chị Hạnh",
      phone: "0912 345 678",
      body: "Góp ý thứ tư",
    }),
  ).rejects.toMatchObject({ code: "rate_limited" });

  // The next day's first goes through.
  const tomorrow: TenantContext = { ...guest, clock: fixedClock(LATER) };
  await runCommand(sql, tomorrow, submitFeedback, {
    bookshelfId: shelf.id,
    senderName: "Chị Hạnh",
    phone: "0912 345 678",
    body: "Hôm sau",
  });
  expect(await sql`select id from feedback`).toHaveLength(4);
});

test("a different number is a different budget", async () => {
  // Pins that the limit is keyed on the hash and not simply on the shelf.
  const { shelf, ctx } = await managerContext(sql);
  const guest: TenantContext = {
    ...ctx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  for (let i = 0; i < 3; i++) {
    await runCommand(sql, guest, submitFeedback, {
      bookshelfId: shelf.id,
      senderName: "A",
      phone: "0900000001",
      body: "x",
    });
  }
  await runCommand(sql, guest, submitFeedback, {
    bookshelfId: shelf.id,
    senderName: "B",
    phone: "0900000002",
    body: "y",
  });
  expect(await sql`select id from feedback`).toHaveLength(4);
});

test("the hash column holds a hash, and the audit record holds neither", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const guest: TenantContext = {
    ...ctx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  await runCommand(sql, guest, submitFeedback, {
    bookshelfId: shelf.id,
    senderName: "Chị Hạnh",
    phone: "0912345678",
    body: "Nội dung",
  });

  const [row] = await sql<{ guest_hash: string }[]>`
    select guest_hash from feedback
  `;
  expect(row.guest_hash).toBe(phoneHash("0912345678"));
  expect(row.guest_hash).not.toContain("0912345678");
  // Whitespace does not create a second budget.
  expect(phoneHash("0912 345 678")).toBe(phoneHash("0912345678"));

  const [entry] = await sql<{ after: Record<string, unknown> }[]>`
    select after from audit_log where action = 'feedback.submitted'
  `;
  expect(JSON.stringify(entry.after)).not.toContain("0912345678");
  expect(JSON.stringify(entry.after)).not.toContain(row.guest_hash);
});

test("site-wide feedback carries no shelf, and only a super admin handles it", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const guest: TenantContext = {
    ...ctx,
    actor: { userId: null, membershipId: null, role: "guest" },
  };
  const { feedbackId } = await runCommand(sql, guest, submitFeedback, {
    senderName: "Người lạ",
    phone: "0900000009",
    body: "Giáo xứ em muốn mở tủ sách",
  });

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from feedback
  `;
  expect(row.bookshelf_id).toBeNull();

  // A shelf manager may not resolve it — OPS §4.4 restricts these to
  // super_admin, following the only built screen.
  await expect(
    runCommand(sql, ctx, markFeedbackRead, { feedbackId }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  const admin: TenantContext = {
    ...ctx,
    actor: { ...ctx.actor, role: "super_admin" },
  };
  await runCommand(sql, admin, resolveFeedback, { feedbackId });
  const [after] = await sql<{ status: string }[]>`select status from feedback`;
  expect(after.status).toBe("resolved");
  expect(shelf.id).toBeTruthy();
});

// ── Donations ──────────────────────────────────────────────────────────────

test("receiving a donation writes no book and no copy", async () => {
  // The decision most likely to be "improved" later. OPS §4.4: cataloguing is a
  // separate, manager-typed CreateBook with the donor pre-filled, because a bag
  // of books is not a catalogue entry and only a person holding them knows what
  // they are.
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const rctx = readerContext(shelf.id, reader);

  const { donationId } = await runCommand(sql, rctx, offerDonation, {
    membershipId: reader.id,
    description: "Khoảng mười cuốn truyện thiếu nhi",
    estimatedCount: 10,
  });
  await runCommand(sql, ctx, receiveDonation, { donationId });

  const [row] = await sql<{ status: string; donor_membership_id: string }[]>`
    select status, donor_membership_id from book_donations
  `;
  expect(row.status).toBe("received");
  // A membership id, not a user id — the reverse of this codebase's usual trap.
  expect(row.donor_membership_id).toBe(reader.id);

  expect(await sql`select id from books`).toHaveLength(0);
  expect(await sql`select id from book_copies`).toHaveLength(0);
});

test("declining requires a reason, and whitespace is not one", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const { donationId } = await runCommand(
    sql,
    readerContext(shelf.id, reader),
    offerDonation,
    { membershipId: reader.id, description: "Vài cuốn cũ" },
  );

  await expect(
    runCommand(sql, ctx, declineDonation, { donationId, reason: "  " }),
  ).rejects.toMatchObject({ code: "reject_reason_required" });

  await runCommand(sql, ctx, declineDonation, {
    donationId,
    reason: "Tủ sách đã có nhiều bản này rồi",
  });
  const [row] = await sql<{ status: string; decision_note: string }[]>`
    select status, decision_note from book_donations
  `;
  expect(row.status).toBe("declined");
  expect(row.decision_note).toBe("Tủ sách đã có nhiều bản này rồi");
});

test("an offer is decided once", async () => {
  const { shelf, ctx } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const { donationId } = await runCommand(
    sql,
    readerContext(shelf.id, reader),
    offerDonation,
    { membershipId: reader.id, description: "Sách" },
  );
  await runCommand(sql, ctx, receiveDonation, { donationId });

  await expect(
    runCommand(sql, ctx, receiveDonation, { donationId }),
  ).rejects.toMatchObject({ code: "donation_not_pending" });
  await expect(
    runCommand(sql, ctx, declineDonation, { donationId, reason: "muộn" }),
  ).rejects.toMatchObject({ code: "donation_not_pending" });
});

test("an empty description is refused, and a reader cannot offer for somebody else", async () => {
  const { shelf } = await managerContext(sql);
  const reader = await makeMember(sql, shelf.id);
  const other = await makeMember(sql, shelf.id);
  const rctx = readerContext(shelf.id, reader);

  await expect(
    runCommand(sql, rctx, offerDonation, {
      membershipId: reader.id,
      description: " ",
    }),
  ).rejects.toMatchObject({ code: "empty_description" });

  await expect(
    runCommand(sql, rctx, offerDonation, {
      membershipId: other.id,
      description: "Giả danh",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });
});
