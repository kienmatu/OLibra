import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command, Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import { validateSelection } from "../parish-taxonomy";
import { avatarObjectOf } from "../pending-proposal";
import { requireManager } from "../policy";
import {
  applyProfileFields,
  diffProfileFields,
  lockPerson,
  normaliseProfilePatch,
  pickProfileFields,
} from "../profile-fields";

export interface ApproveProfileChangeInput {
  profileChangeRequestId: string;
  /** BR §5.6, both optional, always — supplying neither leaves the placement alone. */
  parishUnitL1Id?: string | null;
  parishUnitL2Id?: string | null;
}

/**
 * A manager approves a pending change; the proposed values are written to the
 * person record in the same transaction as the audit record (OPS §4.3, BR
 * §7.4's diagram: `pending ──► approved (values written to the person)`).
 *
 * ── The join is the security check, not a convenience ────────────────────
 *
 * `profile_change_requests.user_id` references `users(id)` plainly, and `users`
 * is global with no row-level security. RLS's `with check` on this table
 * guarantees a row's `bookshelf_id` matches the session and **nothing else** —
 * so a row naming a `user_id` with no membership at that shelf is
 * representable. Reading the request and then writing `users` from its
 * `user_id` would therefore be a `users` write authorised by a column, not by
 * a policy. The `join memberships` below is what ties the subject to *this*
 * shelf; every command in this lifecycle carries it for the same reason.
 *
 * ── `parishUnitL1Id` / `parishUnitL2Id` ──────────────────────────────────
 *
 * Not part of what was proposed — parish units are a membership fact, not one
 * of the person-level fields a reader may put forward. They let the approving
 * manager set or correct the placement in the same action, which is what the
 * profile screen points a reader towards when it says a unit change needs the
 * manager's help. `validateSelection` is the shared rule (`../parish-taxonomy
 * .ts`), and it treats a soft-deleted unit as existing on purpose, so
 * re-validating an unchanged selection does not start failing the day a manager
 * retires that unit. **This is the only code path this slice shares with B2a**,
 * and it is shared as an import rather than as a restatement.
 *
 * ── `write_target_not_found` for a request that is not there ─────────────
 *
 * OPS §4.3 names no failure mode for it, and an `ErrorCode` may not be invented
 * with a Vietnamese sentence nobody wrote (the rule `kernel/tenant.ts` states).
 * The kernel's generic — "Không tìm thấy dữ liệu cần thay đổi." — is honest,
 * and it is also what a request belonging to *another shelf* produces, because
 * RLS filtered the select to zero rows rather than anyone comparing two shelf
 * ids. B2b's plan §8 asks the product owner for a specific sentence.
 *
 * ── `avatarObject`: the photograph this approval replaced ────────────────
 *
 * Approving a new photograph makes the old one unreferenced, and the old one
 * goes on answering 200 from a public bucket for as long as nobody deletes it.
 * That is a **retention** problem rather than a storage one: `src/storage/s3.ts`
 * argues at length that the readers here are children and that name-plus-face is
 * the most identifying pair of facts in the system, so a family who replaces
 * their child's photograph — or asks the parish to take it down — must not leave
 * every earlier version publicly fetchable.
 *
 * So this command returns the superseded object's key, and the surface deletes
 * it after the commit, exactly as `./reject-profile-change.ts` and
 * `./cancel-profile-change.ts` already do. Same field name, so
 * `decideAndDiscardAvatar` in `src/lib/avatar.ts` takes all three without
 * knowing which decision it is running.
 *
 * **What it recovers, and what it cannot.** The key is not on `users` — that
 * column holds a URL — so it is read back out of the request that *put* the old
 * photograph there, whose `proposed_values` still carries its `avatar_object`
 * and which `audit_log` and the request table both keep forever. Every avatar
 * that arrived through this lifecycle is therefore deletable. One does not:
 * a photograph set at registration arrives as a bare `avatarUrl` with no key
 * anywhere (`../registration.ts`), so no code path can remove it. That needs a
 * key column on `users` and a migration, and it is recorded as its own slice —
 * master plan §7.14, **B6 · Avatar retention** — rather than as a comment,
 * because it is a promise to a family that the software cannot currently keep.
 */
export const approveProfileChange: Command<
  ApproveProfileChangeInput,
  { userId: string; avatarObject: string | null }
> = async (tx, ctx, input) => {
  requireManager(ctx);
  // `decided_by` is nullable and would take a null happily; INV-8 wants the
  // actor by name, and a decision with nobody's name on it is exactly what
  // `voidLoan` shipped.
  requireIdentifiedActor(ctx);

  // Whose request this is, and nothing else, so the lifecycle's lock can be
  // taken **before** anything is read that a decision depends on. RLS scopes
  // this select to the shelf exactly as the full one below is scoped.
  const [subject] = await tx<{ user_id: string }[]>`
    select user_id from profile_change_requests
     where id = ${input.profileChangeRequestId}
  `;
  if (!subject) throw new NotFound("write_target_not_found");

  // The order every command in this lifecycle takes its two locks in:
  // the person, then the request. This command used to take them the other way
  // round without meaning to — `applyProfileFields`' `for update` on `users`
  // came first here, while `CancelProfileChange` took the request row first and
  // then needed `FOR KEY SHARE` on the same `users` row for its audit entry —
  // and *Duyệt* racing *Huỷ* deadlocked, 3/3, in both directions. Taking it here
  // rather than leaving `applyProfileFields` to do it also makes the read below
  // current: a proposal committed a moment ago cannot slip in between reading
  // `proposed_values` and writing it. `../profile-fields.ts` holds the rule.
  await lockPerson(tx, subject.user_id);

  const [request] = await tx<
    {
      id: string;
      user_id: string;
      membership_id: string;
      status: string;
      proposed_values: unknown;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
    }[]
  >`
    select r.id, r.user_id, r.status, r.proposed_values,
           m.id as membership_id, m.parish_unit_l1_id, m.parish_unit_l2_id
      from profile_change_requests r
      join memberships m on m.user_id = r.user_id and m.deleted_at is null
      join users u       on u.id = r.user_id and u.deleted_at is null
     where r.id = ${input.profileChangeRequestId}
  `;
  if (!request) throw new NotFound("write_target_not_found");
  if (request.status !== "pending") {
    throw new RuleViolated("profile_change_not_pending");
  }

  const hasL1 = input.parishUnitL1Id !== undefined;
  const hasL2 = input.parishUnitL2Id !== undefined;
  if (hasL1 || hasL2) {
    const l1 = hasL1 ? (input.parishUnitL1Id ?? null) : request.parish_unit_l1_id;
    const l2 = hasL2 ? (input.parishUnitL2Id ?? null) : request.parish_unit_l2_id;
    const { taxonomy, units } = await loadParishContext(tx, ctx);
    // Validated as the *resulting* selection rather than as the supplied half:
    // setting only l1 while a leftover l2 hangs off a different parent is
    // precisely the state BR §5.6's rule exists to forbid, and checking only
    // what was typed would let it through.
    const check = validateSelection(taxonomy, units, { l1, l2 });
    if (check.blocked) {
      throw new ValidationFailed(check.reason!, "parishUnitL1Id");
    }
    await tx`
      update memberships
         set parish_unit_l1_id = ${l1}, parish_unit_l2_id = ${l2}
       where id = ${request.membership_id}
    `;
  }

  // Re-validated rather than trusted. `proposed_values` is `jsonb` with no
  // check constraint behind it (DATABASE.md §4.11 names that as the price of
  // the design), and a row written by an older version of this application —
  // or by hand — could hold a blanked `full_name` or a date in a shape
  // `::date` will misread. `pickProfileFields` also drops `avatar_object`,
  // which the avatar wave stores here and which is never copied to `users`.
  const proposed = normaliseProfilePatch(
    pickProfileFields(request.proposed_values),
  );
  const { before, after } = await applyProfileFields(tx, request.user_id, proposed);
  const diff = diffProfileFields(before, after);

  // Read *after* the write, off the authoritative before/after, rather than
  // from `proposed_values` — so an approval that did not actually move the
  // photograph (the same URL re-proposed, a proposal about a phone number)
  // hands back nothing to delete. The same reasoning as `empty_proposal` on
  // `./update-reader-profile.ts`: one statement decides what changed.
  const supersededAvatar =
    before.avatar_url !== null && after.avatar_url !== before.avatar_url
      ? await avatarObjectBehind(tx, request.id, request.user_id, before.avatar_url)
      : null;

  await tx`
    update profile_change_requests
       set status     = 'approved',
           decided_by = ${ctx.actor.userId},
           decided_at = ${ctx.clock.now()}
     where id = ${request.id} and status = 'pending'
  `;

  return {
    result: { userId: request.user_id, avatarObject: supersededAvatar },
    audit: {
      action: "profile_change.approved",
      // The **person**, unlike the other three commands in this lifecycle,
      // which audit against the request. This is the moment a person's verified
      // details actually move, and INV-13b's whole substance is that such a
      // move is traceable on the person. Which request it came from is
      // recoverable from `profile_change_requests.decided_by`/`decided_at`,
      // written in this same transaction. A decision, not a rule —
      // `audit_log.entity_id` is a bare `uuid` with no foreign key, so each
      // command states which id it writes.
      entityType: "user",
      entityId: request.user_id,
      before: diff.before,
      after: diff.after,
    },
  };
};

/**
 * The storage key of the object a person's *current* `avatar_url` names, found
 * in the request that put it there.
 *
 * `users` keeps only the URL — DATABASE.md §4.11's `jsonb` argument is what made
 * a key column unnecessary for the *pending* image, and the price is that a
 * *settled* one has no key beside it. It is recoverable anyway, because
 * `profile_change_requests` is never deleted: the approved row that set this URL
 * still carries the `avatar_object` the surface wrote. So this is a lookup, not
 * a derivation — nothing here reconstructs a key out of a URL, which would be a
 * guess that quietly stops matching the day `S3_PUBLIC_URL` changes and would
 * happily hand back a key for a URL this application never issued.
 *
 * `null` is the ordinary answer for a photograph that arrived at registration as
 * a bare URL (`../registration.ts`), for one set at another shelf (RLS scopes
 * this select), and for an `avatar_url` pointing anywhere else at all. The
 * caller treats "no key" as "nothing to delete", which is honest: what is
 * missing is the ability to delete it, not the intention. Master plan §7.14,
 * **B6 · Avatar retention**, owns closing that.
 */
async function avatarObjectBehind(
  tx: Tx,
  exceptRequestId: string,
  userId: string,
  avatarUrl: string,
): Promise<string | null> {
  const [row] = await tx<{ proposed_values: unknown }[]>`
    select proposed_values
      from profile_change_requests
     where user_id = ${userId}
       and id <> ${exceptRequestId}
       and status = 'approved'
       and proposed_values->>'avatar_url' = ${avatarUrl}
     order by decided_at desc nulls last
     limit 1
  `;
  return row ? avatarObjectOf(row.proposed_values) : null;
}
