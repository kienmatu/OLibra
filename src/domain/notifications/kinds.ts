/**
 * The closed set of notification kinds, and the Vietnamese each renders as.
 *
 * **The map is the type**, exactly as `src/domain/kernel/audit-actions.ts` made
 * it for audit actions and for the same reason: `notifications.kind` is a bare
 * `text` column (`0007_audit_notifications.sql:11`), so nothing in the schema
 * stops a command inventing a kind, and a kind with no sentence would reach a
 * child's bell as `request_approved`. Deriving `NotificationKind` from
 * `NOTIFICATIONS`' keys makes an uncovered kind a **compile error** rather than
 * something a test has to notice afterwards.
 *
 * **Managers get none of these — BR §15 and OPS §7, by design.** The reason is
 * stated in the requirements rather than inferred: it "avoids notification
 * fatigue for volunteers and removes any dependency on timely background work",
 * and managers work from the dashboard's live counts instead. That is why every
 * kind below is phrased to a reader and why
 * `tests/architecture/notifications-are-reader-facing.test.ts` enumerates the
 * call sites rather than trusting this comment.
 *
 * **"Sách đã sẵn sàng để nhận" is not a separate kind, and that is an
 * inference.** §15 lists "borrow request approved" and "book ready for
 * collection" as two notifications, but every command in the catalogue that
 * creates a hold is the same event a reader experiences as *it's ready* — OPS
 * §7 says so and flags the reading as an inference rather than something §15
 * states outright. One kind, one row, one bell: telling a child twice about one
 * book is worse than the tidiness of matching a list.
 */

import type { JSONValue } from "postgres";

/** What a kind needs from its payload to render. Absent fields degrade, never throw. */
type Payload = Record<string, JSONValue | undefined>;

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** `Dế Mèn Phiêu Lưu Ký` if the payload carries it, `cuốn sách` if it does not. */
function which(title: string | null): string {
  return title ?? "cuốn sách";
}

/** ` vì <reason>`, or nothing — a rejection with no reason is still a sentence. */
function because(reason: string | null): string {
  return reason ? ` vì ${reason}` : "";
}

export const NOTIFICATIONS = {
  membership_approved: {
    /** OPS §7, written by `ApproveMembership`. */
    sentence: () => "Đơn đăng ký của em đã được duyệt. Chúc em đọc sách vui!",
  },
  membership_rejected: {
    /** OPS §7, written by `RejectMembership`. The reason is the whole point. */
    sentence: (p: Payload) =>
      `Đơn đăng ký của em chưa được duyệt${because(str(p, "reason"))}.`,
  },
  request_approved: {
    /**
     * OPS §7, written by `ApproveBorrowRequest` and by `ReceiveReturn` when it
     * holds the returned copy for the next reader — the same event from two
     * doors, which is why it is one kind and not two.
     *
     * The collection deadline is in the sentence rather than behind an
     * expansion, unlike an audit entry: §15 names it ("kèm hạn đến nhận") and a
     * hold a child does not know the end of is a hold they will miss.
     */
    sentence: (p: Payload) => {
      const until = str(p, "hold_until");
      const book = which(str(p, "title"));
      return until
        ? `${book} đã sẵn sàng, em đến nhận trước ngày ${until} nhé.`
        : `${book} đã sẵn sàng, em đến nhận sớm nhé.`;
    },
  },
  request_rejected: {
    /** OPS §7, written by `RejectBorrowRequest`. */
    sentence: (p: Payload) =>
      `Yêu cầu mượn ${which(str(p, "title"))} chưa được duyệt${because(str(p, "reason"))}.`,
  },
  loan_due_soon: {
    /** The scheduled sweep, not a command — see `./sweep.ts` and OPS §7. */
    sentence: (p: Payload) =>
      `${which(str(p, "title"))} sắp đến hạn trả, ngày ${str(p, "due_on") ?? "sắp tới"}.`,
  },
  loan_overdue: {
    /** The scheduled sweep, not a command. */
    sentence: (p: Payload) =>
      `${which(str(p, "title"))} đã quá hạn trả. Em mang sách đến trả giúp nhé.`,
  },
} as const;

export type NotificationKind = keyof typeof NOTIFICATIONS;

export const NOTIFICATION_KINDS = Object.keys(NOTIFICATIONS) as NotificationKind[];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && Object.hasOwn(NOTIFICATIONS, value);
}

/**
 * The Vietnamese a reader sees. Never the raw kind — the same rule
 * `auditSentence` follows, for the same reason: `request_approved` on a child's
 * screen is a failure, not a fallback.
 *
 * A kind this build does not know is a real state rather than a programming
 * error, because `notifications` rows written by an older build survive a
 * deploy. It renders a neutral sentence rather than the token.
 */
export function notificationSentence(kind: string, payload: Payload): string {
  if (!isNotificationKind(kind)) return "Em có một thông báo mới.";
  return NOTIFICATIONS[kind].sentence(payload);
}
