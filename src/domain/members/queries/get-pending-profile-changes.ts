import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import {
  pickProfileFields,
  PROFILE_FIELDS,
  type ProfileFields,
  type ProfilePatch,
} from "../profile-fields";

export interface PendingProfileChange {
  profileChangeRequestId: string;
  membershipId: string;
  userId: string;
  requestedAt: string;
  /**
   * What the reader asked for.
   *
   * There is deliberately no separate `fullName` on this row. The card's
   * heading is `currentValues.full_name`, which is the live one by
   * construction — a second copy would be the one place a name corrected by
   * `UpdateReaderProfile` an hour ago could still be shown stale, which is the
   * exact failure this query exists to prevent.
   */
  proposedValues: ProfilePatch;
  /**
   * What the person's details are **right now** — read from `users` in this
   * query, never from the request's `previous_values`. See the docstring.
   */
  currentValues: ProfileFields;
  /**
   * The snapshot taken when the proposal was made, unchanged.
   *
   * Returned as well as `currentValues`, and never instead of it: BR §5.4 keeps
   * it so a manager can see what the reader was looking at, and DATABASE.md
   * §4.11 calls it a historical record. A screen that wants to say "this was
   * proposed against an older phone number" needs both.
   */
  previousValues: ProfilePatch;
}

/**
 * The manager's profile-change approval queue (OPS §3.3,
 * `GetPendingProfileChanges`; BR §16.3: "One card per proposed change, showing
 * the current value and the proposed one side by side").
 *
 * ── The "current" column is live, and this is the whole mechanism ────────
 *
 * B2b's plan §3.5 calls it Drift 3, and it is the only protection there is
 * against a manager's direct edit making a pending proposal's snapshot lie.
 * `UpdateReaderProfile` (`../commands/update-reader-profile.ts`) writes a
 * person's details with no approval step and deliberately does not touch a
 * pending request — so a request proposed on Monday against phone A, with the
 * number corrected to B on Tuesday, still carries `previous_values: {phone: A}`
 * on Wednesday. Rendering that as "current" would show a manager a comparison
 * that was true a week ago, and BR §5.4's stated reason for keeping the snapshot
 * at all is that "a manager reviewing a week-old request sees what it would
 * actually change".
 *
 * So `currentValues` is selected from `users` here, in the same transaction as
 * the request rows. `previous_values` stays exactly what DATABASE.md §4.11 calls
 * it — the state at proposal time — and comes back beside it rather than in
 * place of it. The two are different questions and the screen may show both;
 * what it may not do is answer the first with the second.
 *
 * The alternative — having `UpdateReaderProfile` rewrite pending snapshots — was
 * rejected in the plan: it would make a historical record mutable, and it would
 * put a write to `profile_change_requests` inside a command whose entire
 * argument for existing is that it is a direct, audited edit of one person.
 *
 * ── The join is the scoping ──────────────────────────────────────────────
 *
 * `profile_change_requests` is RLS-scoped, so `where status = 'pending'` already
 * means "at this shelf". The `join memberships` is the other half of the same
 * sentence, for the reason `../commands/approve-profile-change.ts` states at
 * length: nothing structurally ties a request row to a membership of its own
 * `bookshelf_id`, because `user_id` references the global, RLS-free `users`. A
 * row naming a person with no membership here is representable, and it must not
 * appear in a queue whose next click writes that person's record.
 *
 * `requireIdentifiedActor` is deliberately not called — it exists so an audit
 * row cannot name nobody, and a query writes none.
 */
export async function getPendingProfileChanges(
  tx: Tx,
  ctx: TenantContext,
): Promise<PendingProfileChange[]> {
  requireManager(ctx);

  const rows = await tx<
    (ProfileFields & {
      id: string;
      membership_id: string;
      user_id: string;
      requested_at: string;
      proposed_values: unknown;
      previous_values: unknown;
    })[]
  >`
    select
      r.id, r.user_id, r.proposed_values, r.previous_values,
      r.requested_at::text as requested_at,
      m.id as membership_id,
      u.saint_name, u.full_name, u.date_of_birth::text as date_of_birth,
      u.father_name, u.mother_name, u.phone, u.email, u.avatar_url
    from profile_change_requests r
    join memberships m on m.user_id = r.user_id and m.deleted_at is null
    join users u       on u.id = r.user_id and u.deleted_at is null
   where r.status = 'pending'
   order by r.requested_at
  `;

  return rows.map((row) => ({
    profileChangeRequestId: row.id,
    membershipId: row.membership_id,
    userId: row.user_id,
    requestedAt: row.requested_at,
    // Filtered through the allowlist on the way out, not only on the way in:
    // `proposed_values` also carries `avatar_object`, the proposed image's
    // storage key, which a screen has no use for and which a query handing back
    // raw `jsonb` would be the place that leaked.
    proposedValues: pickProfileFields(row.proposed_values),
    currentValues: Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, row[f] ?? null]),
    ) as ProfileFields,
    previousValues: pickProfileFields(row.previous_values),
  }));
}
