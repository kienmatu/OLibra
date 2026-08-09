import { requireIdentifiedActor } from "../../kernel/tenant";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireReader } from "../../catalogue/policy";
import { notificationSentence } from "../kinds";

export interface NotificationRow {
  id: string;
  kind: string;
  /** The Vietnamese a reader reads. Never the raw kind. */
  sentence: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface MyNotifications {
  rows: NotificationRow[];
  /** BR §15's bell count. Unread only. */
  unread: number;
}

/**
 * OPS §3.2's `GetMyNotifications` — the bell dropdown and the notifications
 * page, with the unread count BR §15 puts on the bell.
 *
 * **The sentence is rendered here, from the stored payload.** Not on the page:
 * the wording belongs to the domain for the same reason `ERROR_MESSAGES` and
 * `auditSentence` do — a screen calling `notificationSentence` cannot invent its
 * own phrasing for an event it did not define. And not stored: a rendered
 * sentence in the row would freeze the wording of every notification ever sent,
 * so a typo would be uncorrectable and a change of tone would apply only to the
 * future.
 *
 * That is the opposite of the audit browser's rule, deliberately, and the
 * difference is what each record is *for*. An audit entry is evidence and must
 * say what was true when it was written (P1 §3.2), so its expansion shows stored
 * values. A notification is a message to one person; nothing is being evidenced,
 * and re-rendering it from the payload is how "Dế Mèn" follows a corrected title.
 *
 * **Own notifications only**, keyed on `ctx.actor.userId` rather than on a
 * caller-supplied id — `users` has no RLS, and `notifications.user_id` is a
 * `users(id)`, so the scope has to come from the session.
 *
 * `id desc` beside `created_at desc`: `created_at` has no unique constraint and
 * the sweep writes many rows in one statement, so the timestamps tie by
 * construction. The measured cost of leaving that out, twice in this codebase,
 * was rows repeating and vanishing across pages.
 */
export async function getMyNotifications(
  tx: Tx,
  ctx: TenantContext,
  input: { limit?: number } = {},
): Promise<MyNotifications> {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  const limit = Math.min(100, Math.max(1, input.limit ?? 30));

  const rows = await tx<
    {
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      created_at: Date;
      read_at: Date | null;
    }[]
  >`
    select id, kind, payload, created_at, read_at
      from notifications
     where user_id = ${ctx.actor.userId}
     order by created_at desc, id desc
     limit ${limit}
  `;

  const [{ unread }] = await tx<{ unread: string }[]>`
    select count(*) as unread
      from notifications
     where user_id = ${ctx.actor.userId} and read_at is null
  `;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      sentence: notificationSentence(r.kind, r.payload as never),
      createdAt: r.created_at,
      readAt: r.read_at,
    })),
    // `count(*)` is `int8`, which the driver returns as a string.
    unread: Number(unread),
  };
}
