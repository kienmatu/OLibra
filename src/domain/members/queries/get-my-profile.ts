import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { describeSelection, unitName } from "../parish-taxonomy";
import { requireSelfOrManager } from "../policy";
import { PROFILE_FIELDS, type ProfileFields } from "../profile-fields";
import {
  getMyProfileChangeRequest,
  type MyProfileChangeRequest,
} from "./get-my-profile-change-request";

export interface MyProfile {
  membershipId: string;
  /**
   * The eight verified fields, spelled as the database spells them.
   *
   * snake_case out of a query, which is unlike every other query in this
   * codebase and is deliberate: the profile screen puts these side by side with
   * `pendingChange.proposedValues`, which is a `jsonb` bag keyed by column name
   * and cannot be renamed without breaking the shadow-of-`users` argument
   * DATABASE.md §4.11 makes. One spelling on both sides of that comparison
   * means the screen matches keys instead of maintaining a translation table
   * that is wrong in exactly one entry.
   */
  fields: ProfileFields;
  /** BR §5.6, rendered with this shelf's own labels — never a hard-coded word. */
  parishLine: string;
  /** `unitName`'s own "Chưa có" when nothing is selected — never an empty cell. */
  parishUnitL1Name: string;
  parishUnitL2Name: string;
  /** BR §16.2's toggle — the one thing on this page a reader changes directly. */
  leaderboardOptIn: boolean;
  /** OPS §3.2 lists it as part of this query's own return. */
  pendingChange: MyProfileChangeRequest | null;
}

/**
 * What a reader sees on their own profile page (OPS §3.2, `GetMyProfile`).
 *
 * ── Why it composes `GetMyProfileChangeRequest` rather than re-reading ───
 *
 * OPS §3.2 lists "current pending change if any (see `GetMyProfileChangeRequest`)"
 * as part of this query's return and points at the other query by name. Calling
 * it is what makes that pointer true: the rules it carries — that it returns the
 * most recent request rather than only a pending one, because BR §15 lists no
 * notification for a profile-change decision and a reader learns the outcome by
 * revisiting the page, and that `proposed_values` is filtered through the
 * allowlist on the way out so a storage key never reaches a screen — are rules
 * this page needs and would otherwise have to restate. A second read of the same
 * table is a second place for them to be got wrong.
 *
 * ── Why the parish units come back as a rendered line and not as ids ─────
 *
 * BR §5.6's placement is read-only here: OPS §4.3's `UpdateOwnProfile` says so,
 * and the screen tells the reader to ask a manager. `describeSelection` is the
 * shared renderer (`../parish-taxonomy.ts`) and it treats a soft-deleted unit as
 * existing on purpose, so a child stays described by the unit they are actually
 * in on the day a manager retires it. The two names are returned as well, for a
 * screen that wants them in separate rows under this shelf's own labels.
 *
 * `requireIdentifiedActor` is deliberately not called: it exists so an audit row
 * cannot name nobody, and a query writes none. Same reasoning as
 * `./get-my-profile-change-request.ts`.
 */
export async function getMyProfile(
  tx: Tx,
  ctx: TenantContext,
  input: { membershipId: string },
): Promise<MyProfile> {
  requireSelfOrManager(ctx, input.membershipId);

  // RLS scopes this to `ctx.bookshelfId`; `users` carries none, so the join is
  // the whole of what ties the person to this shelf.
  const [row] = await tx<
    (ProfileFields & {
      leaderboard_opt_in: boolean;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
    })[]
  >`
    select
      u.saint_name, u.full_name, u.date_of_birth::text as date_of_birth,
      u.father_name, u.mother_name, u.phone, u.email, u.avatar_url,
      m.leaderboard_opt_in, m.parish_unit_l1_id, m.parish_unit_l2_id
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!row) throw new NotFound("membership_not_found");

  const { taxonomy, units } = await loadParishContext(tx, ctx);
  const pendingChange = await getMyProfileChangeRequest(tx, ctx, input);

  return {
    membershipId: input.membershipId,
    fields: Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, row[f] ?? null]),
    ) as ProfileFields,
    parishLine: describeSelection(taxonomy, units, {
      l1: row.parish_unit_l1_id,
      l2: row.parish_unit_l2_id,
    }),
    parishUnitL1Name: unitName(units, row.parish_unit_l1_id),
    parishUnitL2Name: unitName(units, row.parish_unit_l2_id),
    leaderboardOptIn: row.leaderboard_opt_in,
    pendingChange,
  };
}
