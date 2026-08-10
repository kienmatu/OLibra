import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireSuperAdmin } from "../../members/policy";

/**
 * OPS §3.4's `GetFeedbackInbox` and `GetFeedbackDetail` — the read half of a
 * command that has been writable since B3 and unreadable ever since.
 *
 * `submitFeedback` is the only write in the system open to an unauthenticated
 * caller, and the `gop-y` form that calls it has been live on every shelf. Every
 * message it has taken went into a table with no query over it: a parish's
 * children could send a note to the people who keep their shelf and nobody could
 * open it. The commands to mark one read and to resolve it shipped in the same
 * slice, so the state machine was complete and unreachable.
 *
 * **Cross-shelf by nature, which is why this lives under `src/domain/admin/`.**
 * BR §16.1's inbox is one list spanning every parish plus the site-wide
 * messages, and `feedback.bookshelf_id` is the schema's one nullable tenant
 * column (`0006_community.sql:50`, "null for site-wide"). No shelf-scoped read
 * can express it: under `runQuery` the tenant policy admits this shelf's rows
 * and — because `feedback_tenant`'s `using` also admits `bookshelf_id is null`
 * (`20260808_01_feedback_rls.sql`) — the site-wide ones, and nothing else. That
 * is the manager's view, and it is a different product from the administrator's.
 * These run through `runAdminQuery`.
 *
 * **`guest_contact` is in the detail row and not in the list.** It is a phone
 * number belonging to somebody who may never have registered, typed into a
 * public form. §5.4's reason for hashing the rate-limit key applies to the
 * screen as well as to the store: a list is scanned, often over somebody's
 * shoulder on a shared parish device, and a number is only needed at the moment
 * the administrator decides to reply. `guest_hash` is in neither — it is the
 * rate-limit key, it is of no use to a person, and `assertNoSecrets` would
 * refuse it in an audit payload for the same reason.
 */

export interface FeedbackRow {
  feedbackId: string;
  /**
   * What was typed into "Tên của em" — `feedback.guest_name`, always, even
   * when the sender was signed in. QA remediation Task 21: this used to be
   * `member_name ?? guest_name`, so a message sent while signed in showed
   * the *account's* name regardless of what the sender actually typed —
   * measured live, "Tên của em" = "Chị Hạnh" displayed as "Quản trị viên" on
   * `/quan-tri/gop-y`, and the administrator called the wrong person.
   * `submitFeedback` (`../../community/commands/feedback.ts`) requires this
   * non-blank on every write, so the `?? accountName` fallback below is
   * defensive rather than a case this inbox actually meets.
   */
  senderName: string;
  /**
   * The signed-in account's own name — `users.full_name` via
   * `feedback.member_id` — or `null` for a genuine guest. Never used to
   * decide `senderName` above; shown as its own fact
   * (`gop-y/page.tsx`'s "gửi khi đang đăng nhập bằng …" line) so a manager
   * who *did* mean to speak as their own account is not hidden by this fix,
   * only no longer mistaken for the only truth.
   */
  accountName: string | null;
  subject: string;
  status: string;
  isUnread: boolean;
  submittedAt: Date;
  /**
   * `null` for a site-wide message — BR §16.1's "Toàn hệ thống".
   *
   * The id travels with the name because the two actions on a message have to
   * scope their audit row to it: `auditScopeFor` refuses a context whose shelf
   * disagrees with the message's, so the caller needs the id and not only
   * something to print.
   */
  shelfId: string | null;
  shelfName: string | null;
  shelfSlug: string | null;
}

export interface FeedbackDetailRow extends FeedbackRow {
  body: string;
  /** The number to reply on. Read on the detail screen only — see above. */
  senderContact: string | null;
  handledAt: Date | null;
  handledByName: string | null;
}

export type FeedbackFilter = "new" | "read" | "resolved";

/**
 * The inbox. Unread first, then newest, so a queue drains rather than piling up
 * — the same ordering `getDonationQueue` gives the manager, inverted on
 * recency because a message is answered while it is fresh and a donation is
 * collected in the order it was offered.
 *
 * **`status` is compared against a value from a closed set, never interpolated
 * loose.** `FeedbackFilter` is the three values of the `feedback_status` enum
 * (`0006_community.sql:46`) and nothing else, so a caller cannot pass a fourth
 * that silently matches nothing and renders as "no messages". A `?trang-thai=`
 * from the URL is narrowed by `feedbackFilterFrom` below before it reaches here.
 */
export async function getFeedbackInbox(
  tx: Tx,
  ctx: TenantContext,
  input: { status?: FeedbackFilter | null; shelfId?: string | null } = {},
): Promise<FeedbackRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<
    {
      id: string;
      guest_name: string | null;
      member_name: string | null;
      subject: string;
      status: string;
      created_at: Date;
      shelf_id: string | null;
      shelf_name: string | null;
      shelf_slug: string | null;
    }[]
  >`
    select f.id, f.guest_name, u.full_name as member_name, f.subject, f.status,
           f.created_at, f.bookshelf_id as shelf_id,
           b.name as shelf_name, b.slug as shelf_slug
      from feedback f
      left join bookshelves b on b.id = f.bookshelf_id
      left join users u on u.id = f.member_id
     where (${input.status ?? null}::feedback_status is null
            or f.status = ${input.status ?? null}::feedback_status)
       and (${input.shelfId ?? null}::uuid is null
            or f.bookshelf_id = ${input.shelfId ?? null}::uuid)
     order by (f.status = 'new') desc, f.created_at desc, f.id desc
  `;

  return rows.map(toRow);
}

/**
 * One message, with the body and the number to reply on.
 *
 * Returns `null` rather than throwing for an id naming nothing, so the page can
 * answer 404 without the seam having to tell a `NotFound` from a refusal —
 * `getAnnouncementDetail` made the same call, for the same reason.
 */
export async function getFeedbackDetail(
  tx: Tx,
  ctx: TenantContext,
  input: { feedbackId: string },
): Promise<FeedbackDetailRow | null> {
  requireSuperAdmin(ctx);

  const [row] = await tx<
    {
      id: string;
      guest_name: string | null;
      member_name: string | null;
      guest_contact: string | null;
      subject: string;
      body: string;
      status: string;
      created_at: Date;
      handled_at: Date | null;
      handled_by_name: string | null;
      shelf_id: string | null;
      shelf_name: string | null;
      shelf_slug: string | null;
    }[]
  >`
    select f.id, f.guest_name, u.full_name as member_name, f.guest_contact,
           f.subject, f.body, f.status, f.created_at, f.handled_at,
           h.full_name as handled_by_name, f.bookshelf_id as shelf_id,
           b.name as shelf_name, b.slug as shelf_slug
      from feedback f
      left join bookshelves b on b.id = f.bookshelf_id
      left join users u on u.id = f.member_id
      left join users h on h.id = f.handled_by
     where f.id = ${input.feedbackId}
  `;
  if (!row) return null;

  return {
    ...toRow(row),
    body: row.body,
    senderContact: row.guest_contact,
    handledAt: row.handled_at,
    handledByName: row.handled_by_name,
  };
}

/** BR §16.1's unread count, for the nav badge. */
export async function countUnreadFeedback(
  tx: Tx,
  ctx: TenantContext,
): Promise<number> {
  requireSuperAdmin(ctx);
  const [row] = await tx<{ unread: string }[]>`
    select count(*) as unread from feedback where status = 'new'
  `;
  return Number(row.unread);
}

/**
 * A `?trang-thai=` value narrowed to the enum, or `null`.
 *
 * `Object.hasOwn`-free because the set is three literals, but the hazard it
 * guards is the same one `refusalFrom` hit: a value from a URL used to pick a
 * branch. Anything unrecognised — including `constructor` — is `null`, which
 * means "no filter" rather than "a filter that matches nothing".
 */
export function feedbackFilterFrom(value: string | null): FeedbackFilter | null {
  return value === "new" || value === "read" || value === "resolved" ? value : null;
}

function toRow(r: {
  id: string;
  guest_name: string | null;
  member_name: string | null;
  subject: string;
  status: string;
  created_at: Date;
  shelf_id: string | null;
  shelf_name: string | null;
  shelf_slug: string | null;
}): FeedbackRow {
  return {
    feedbackId: r.id,
    // QA remediation Task 21. `guest_name` is what the sender actually typed
    // into "Tên của em" and wins regardless of who was signed in —
    // `submitFeedback` requires it non-blank, so `?? r.member_name` only
    // covers a historical row from before that requirement, never an
    // ordinary submission. The account's own name is `accountName` below,
    // not folded into this field.
    senderName: r.guest_name ?? r.member_name ?? "",
    accountName: r.member_name,
    subject: r.subject,
    status: r.status,
    isUnread: r.status === "new",
    submittedAt: r.created_at,
    shelfId: r.shelf_id,
    shelfName: r.shelf_name,
    shelfSlug: r.shelf_slug,
  };
}
