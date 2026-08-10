import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../../src/db/migrate";
import { submitFeedback } from "../../../src/domain/community/commands/feedback";
import { markFeedbackRead } from "../../../src/domain/community/commands/feedback";
import {
  countUnreadFeedback,
  feedbackFilterFrom,
  getFeedbackDetail,
  getFeedbackInbox,
} from "../../../src/domain/admin/queries/get-feedback-inbox";
import {
  runAdminCommand,
  runAdminQuery,
  runCommand,
  runQuery,
} from "../../../src/domain/kernel/unit-of-work";
import { closeAll, resetDatabase, sql } from "../../support/db";
import { managerContext, superAdminContext } from "../../support/scenarios";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

/** The `code` of whatever `run` threw, so a test can assert on it without `any`. */
async function codeThrownBy(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? null;
  }
}

/**
 * Two parishes, one message each, plus one addressed to nobody in particular.
 *
 * The site-wide one is written with an explicit `null`, which is what
 * `submitFeedback`'s inverted default requires and what `/lien-he` will pass —
 * omitting the field files against the shelf in scope.
 */
async function threeMessages() {
  const a = await managerContext(sql, { slug: "dong-thap" });
  const b = await managerContext(sql, { slug: "vinh-long" });

  const first = await runCommand(sql, a.ctx, submitFeedback, {
    senderName: "Maria Nguyễn Thị Hoa",
    phone: "0900000001",
    subject: "Xin thêm truyện tranh",
    body: "Các cháu rất thích truyện tranh ạ.",
  });
  const second = await runCommand(sql, b.ctx, submitFeedback, {
    senderName: "Giuse Trần Minh",
    phone: "0900000002",
    subject: "Giờ mở cửa",
    body: "Tủ sách mở cửa mấy giờ ạ?",
  });
  const siteWide = await runCommand(sql, a.ctx, submitFeedback, {
    bookshelfId: null,
    senderName: "Phêrô Lê Văn Bình",
    phone: "0900000003",
    subject: "Mở tủ sách mới",
    body: "Giáo xứ chúng con muốn mở một tủ sách.",
  });

  return { a, b, first, second, siteWide };
}

// ── The inbox spans every shelf, which is the whole reason it exists ────────

test("the administrator sees every parish's messages and the site-wide ones", async () => {
  const { a } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  const inbox = await runAdminQuery(sql, ctx, (tx, c) => getFeedbackInbox(tx, c));

  expect(inbox.map((m) => m.subject).sort()).toEqual([
    "Giờ mở cửa",
    "Mở tủ sách mới",
    "Xin thêm truyện tranh",
  ]);
  // A site-wide message names no shelf, which is what the screen renders as
  // "Toàn hệ thống".
  expect(inbox.find((m) => m.subject === "Mở tủ sách mới")?.shelfName).toBeNull();
  expect(inbox.find((m) => m.subject === "Xin thêm truyện tranh")?.shelfSlug).toBe(
    a.shelf.slug,
  );
});

test("a shelf-scoped read cannot see the other parish, which is why this is an admin query", async () => {
  // The falsification for the test above: if `runQuery` could produce the same
  // three rows, `runAdminQuery` and this whole module would be ceremony. It
  // cannot — `feedback_tenant` admits this shelf's rows and the site-wide ones,
  // and Vĩnh Long's message is neither.
  const { a } = await threeMessages();

  const rows = await runQuery(
    sql,
    a.ctx,
    (tx) => tx<{ subject: string }[]>`select subject from feedback`,
  );

  expect(rows.map((r) => r.subject).sort()).toEqual([
    "Mở tủ sách mới",
    "Xin thêm truyện tranh",
  ]);
});

// ── The two role checks, each falsified on its own path ─────────────────────

test("the kernel refuses a manager the admin role, before any transaction opens", async () => {
  const { ctx } = await managerContext(sql);

  // Not the query's own check: the callback never runs. A manager who reached
  // `olibra_admin` would hold `bypassrls` for the duration of the transaction,
  // so this refusal has to happen before `sql.begin`.
  let ran = false;
  const code = await codeThrownBy(() =>
    runAdminQuery(sql, ctx, async () => {
      ran = true;
    }),
  );

  expect(code).toBe("not_permitted");
  expect(ran).toBe(false);
});

test("the query refuses a manager too, on the path the kernel check does not cover", async () => {
  // The other half. An admin query reached through the ordinary shelf-scoped
  // runner — by a page that copied the wrong seam, or by a test — gets no
  // protection from the kernel check, because the kernel check is on a code
  // path it did not take.
  const { ctx } = await managerContext(sql);

  const code = await codeThrownBy(() =>
    runQuery(sql, ctx, (tx, c) => getFeedbackInbox(tx, c)),
  );

  expect(code).toBe("not_permitted");
});

test("the admin write path refuses a manager as well", async () => {
  const { ctx } = await managerContext(sql);

  const code = await codeThrownBy(() =>
    runAdminCommand(sql, ctx, markFeedbackRead, {
      feedbackId: "00000000-0000-0000-0000-000000000000",
    }),
  );

  expect(code).toBe("not_permitted");
});

// ── What the two shapes disclose ───────────────────────────────────────────

test("the phone number is on the detail row and not in the list", async () => {
  const { first } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  const [inbox, detail] = await runAdminQuery(sql, ctx, async (tx, c) => [
    await getFeedbackInbox(tx, c),
    await getFeedbackDetail(tx, c, { feedbackId: first.feedbackId }),
  ]);

  // Nothing in a list row carries the number, under any key.
  const row = inbox.find((m) => m.feedbackId === first.feedbackId);
  expect(JSON.stringify(row)).not.toContain("0900000001");

  expect(detail?.senderContact).toBe("0900000001");
  expect(detail?.body).toBe("Các cháu rất thích truyện tranh ạ.");
});

test("the rate-limit hash reaches neither shape", async () => {
  const { first } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  const [hash] = await sql<{ guest_hash: string }[]>`
    select guest_hash from feedback where id = ${first.feedbackId}
  `;
  expect(hash.guest_hash).toHaveLength(64);

  const detail = await runAdminQuery(sql, ctx, (tx, c) =>
    getFeedbackDetail(tx, c, { feedbackId: first.feedbackId }),
  );
  expect(JSON.stringify(detail)).not.toContain(hash.guest_hash);
});

test("a member's own name wins over whatever was typed into the form", async () => {
  const a = await managerContext(sql);
  const [me] = await sql<{ full_name: string }[]>`
    select full_name from users where id = ${a.manager.userId}
  `;

  const sent = await runCommand(sql, a.ctx, submitFeedback, {
    senderName: "gõ vội",
    phone: "0900000009",
    subject: "Tên",
    body: "Thân gửi ban quản trị.",
  });

  const { ctx } = await superAdminContext(sql);
  const inbox = await runAdminQuery(sql, ctx, (tx, c) => getFeedbackInbox(tx, c));

  expect(inbox.find((m) => m.feedbackId === sent.feedbackId)?.senderName).toBe(
    me.full_name,
  );
});

// ── Ordering, filtering, counting ──────────────────────────────────────────

test("an unread message sorts above a read one that arrived later", async () => {
  // The fixture is deliberately non-degenerate: the *read* message is the more
  // recent of the two, so an implementation that ordered on `created_at` alone
  // would put it first and this would fail. Both arms differ in both keys.
  const a = await managerContext(sql, { instant: "2026-08-07T08:00:00Z" });
  const older = await runCommand(sql, a.ctx, submitFeedback, {
    senderName: "Người gửi sớm",
    phone: "0900000011",
    subject: "Gửi trước, chưa đọc",
    body: "…",
  });
  const laterCtx = {
    ...a.ctx,
    clock: {
      now: () => new Date("2026-08-09T08:00:00Z"),
      today: a.ctx.clock.today,
    },
  };
  const newer = await runCommand(sql, laterCtx, submitFeedback, {
    senderName: "Người gửi muộn",
    phone: "0900000012",
    subject: "Gửi sau, đã đọc",
    body: "…",
  });

  const { ctx } = await superAdminContext(sql);
  // Scoped to the message's own shelf — `auditScopeFor` refuses any other.
  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: a.shelf.id },
    markFeedbackRead,
    { feedbackId: newer.feedbackId },
  );

  const inbox = await runAdminQuery(sql, ctx, (tx, c) => getFeedbackInbox(tx, c));
  expect(inbox.map((m) => m.feedbackId)).toEqual([
    older.feedbackId,
    newer.feedbackId,
  ]);
});

test("the status filter narrows, and an unrecognised one does not", async () => {
  const { first, a } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: a.shelf.id },
    markFeedbackRead,
    { feedbackId: first.feedbackId },
  );

  const read = await runAdminQuery(sql, ctx, (tx, c) =>
    getFeedbackInbox(tx, c, { status: "read" }),
  );
  expect(read.map((m) => m.feedbackId)).toEqual([first.feedbackId]);

  // `?trang-thai=constructor` is not a fourth status. It narrows to `null`,
  // which means no filter — three messages, not zero.
  expect(feedbackFilterFrom("constructor")).toBeNull();
  expect(feedbackFilterFrom("resolved")).toBe("resolved");
  const all = await runAdminQuery(sql, ctx, (tx, c) =>
    getFeedbackInbox(tx, c, { status: feedbackFilterFrom("constructor") }),
  );
  expect(all).toHaveLength(3);
});

test("the unread count drops when a message is read", async () => {
  const { first, a } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  expect(await runAdminQuery(sql, ctx, countUnreadFeedback)).toBe(3);
  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: a.shelf.id },
    markFeedbackRead,
    { feedbackId: first.feedbackId },
  );
  expect(await runAdminQuery(sql, ctx, countUnreadFeedback)).toBe(2);
});

test("an id naming nothing is null rather than a refusal", async () => {
  await threeMessages();
  const { ctx } = await superAdminContext(sql);

  const detail = await runAdminQuery(sql, ctx, (tx, c) =>
    getFeedbackDetail(tx, c, {
      feedbackId: "00000000-0000-0000-0000-000000000000",
    }),
  );
  expect(detail).toBeNull();
});

// ── The audit row lands on the message's shelf, or nowhere ─────────────────

test("resolving one parish's message while scoped to another is refused", async () => {
  // B3 could do this silently: `toRow` takes the shelf from `ctx.bookshelfId`
  // and nothing compared it to the message. Đồng Tháp's manager would read
  // "quản trị viên đã xử lý góp ý" in their own audit log for a message Vĩnh
  // Long sent, and Vĩnh Long's manager would see nothing at all.
  const { first, b } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  const code = await codeThrownBy(() =>
    runAdminCommand(sql, { ...ctx, bookshelfId: b.shelf.id }, markFeedbackRead, {
      feedbackId: first.feedbackId,
    }),
  );

  expect(code).toBe("not_permitted");
  expect(
    await sql`select id from audit_log where action = 'feedback.read'`,
  ).toHaveLength(0);
});

test("a site-wide message is audited globally, and refuses a shelf scope", async () => {
  const { siteWide, a } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  // Filing a decision about the whole deployment into one parish's record.
  expect(
    await codeThrownBy(() =>
      runAdminCommand(sql, { ...ctx, bookshelfId: a.shelf.id }, markFeedbackRead, {
        feedbackId: siteWide.feedbackId,
      }),
    ),
  ).toBe("not_permitted");

  // With no shelf scope it commits, and the audit row belongs to no shelf.
  await runAdminCommand(sql, ctx, markFeedbackRead, {
    feedbackId: siteWide.feedbackId,
  });
  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'feedback.read'
  `;
  expect(row.bookshelf_id).toBeNull();
});

// ── The admin write path's own guard ───────────────────────────────────────

test("an audit entry that names a shelf, under a context that has none, is refused by name", async () => {
  // `runAdminCommand` allows an empty `bookshelfId` because a genuinely global
  // command has no shelf to name. A command that then writes a *non*-global
  // audit entry would bind `''` into a `uuid` column and raise a raw
  // PostgresError from inside the transaction. This is the named error instead.
  const { ctx } = await superAdminContext(sql);

  const code = await codeThrownBy(() =>
    runAdminCommand(
      sql,
      ctx,
      async () => ({
        result: undefined,
        audit: {
          action: "feedback.read" as const,
          entityType: "feedback",
          entityId: "00000000-0000-0000-0000-000000000000",
          before: null,
          after: null,
        },
      }),
      undefined,
    ),
  );

  expect(code).toBe("invalid_bookshelf_id");
});

test("a global entry under the same context commits", async () => {
  const { ctx } = await superAdminContext(sql);

  await runAdminCommand(
    sql,
    ctx,
    async () => ({
      result: undefined,
      audit: {
        action: "feedback.read" as const,
        entityType: "feedback",
        entityId: "00000000-0000-0000-0000-000000000000",
        before: null,
        after: null,
        global: true,
      },
    }),
    undefined,
  );

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'feedback.read'
  `;
  expect(row.bookshelf_id).toBeNull();
});

test("an admin command acting on one named shelf writes an ordinary shelf-scoped audit row", async () => {
  // The other direction, and the reason `submitAdminCommand` takes a
  // `bookshelfId`: an administrator editing one parish's settings leaves a
  // trace that parish's own manager can read in their audit log.
  const { first, a } = await threeMessages();
  const { ctx } = await superAdminContext(sql);

  await runAdminCommand(
    sql,
    { ...ctx, bookshelfId: a.shelf.id },
    markFeedbackRead,
    { feedbackId: first.feedbackId },
  );

  const [row] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'feedback.read'
  `;
  expect(row.bookshelf_id).toBe(a.shelf.id);
});
