import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { requireReader } from "../../catalogue/policy";

/**
 * A reader dismisses one notification, or all of them.
 *
 * **Neither writes an audit entry, and that is a departure from OPS §4 worth
 * stating.** OPS names `notification.read` as the audit action and, in the same
 * line, calls it questionable — "INV-8 is arguably overkill for a read-flag flip
 * with no business consequence". Three things settle it against writing one:
 *
 * - P1 made the audit map *the type*, so `notification.read` would need a
 *   Vietnamese sentence in `audit-actions.ts` — a sentence describing an event
 *   that is not a business fact about the shelf.
 * - BR §14 asks the browser to answer "what has manager A been doing" and to
 *   stay readable. One row per bell tap buries every real entry under the most
 *   frequent and least meaningful action in the system.
 * - Nothing is recoverable from it. INV-8 exists so a change to *the shelf's
 *   record* can be traced; `read_at` is a fact about one person's inbox, it
 *   changes nothing anybody else can observe, and it is already visible to the
 *   only person it concerns.
 *
 * `audit: []` rather than a fabricated entry — the kernel takes an array
 * precisely so a command can produce none, and an empty one says "deliberately
 * nothing" where a missing field would not type-check at all.
 *
 * **Own notifications only, enforced by `user_id` and not by the caller.** The
 * update is keyed on `ctx.actor.userId`, so a reader passing somebody else's
 * notification id updates zero rows rather than being told it exists. RLS scopes
 * the shelf; this scopes the person.
 */

export interface MarkNotificationReadInput {
  notificationId: string;
}

export const markNotificationRead: Command<
  MarkNotificationReadInput,
  void
> = async (tx, ctx, input) => {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  // `.allowZero()` — this is the genuinely conditional write the guard's
  // escape hatch exists for, declared at the call site as its docstring asks.
  // Zero rows is the ordinary answer to a double-tap on the bell, and to a
  // notification id that is not this reader's; neither is an error, and
  // neither should raise.
  await tx`
      update notifications
         set read_at = ${ctx.clock.now()}
       where id = ${input.notificationId}
         and user_id = ${ctx.actor.userId}
         and read_at is null
    `.allowZero();

  return { result: undefined, audit: [] };
};

export const markAllNotificationsRead: Command<void, { marked: number }> = async (
  tx,
  ctx,
) => {
  requireReader(ctx);
  requireIdentifiedActor(ctx);

  const rows = await tx<{ id: string }[]>`
      update notifications
         set read_at = ${ctx.clock.now()}
       where user_id = ${ctx.actor.userId}
         and read_at is null
      returning id
    `.allowZero();

  return { result: { marked: rows.length }, audit: [] };
};
