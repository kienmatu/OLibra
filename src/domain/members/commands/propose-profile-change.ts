import { isUniqueViolation, NotFound, RuleViolated } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command, Tx } from "../../kernel/unit-of-work";
import { requireSelfOrManager } from "../policy";
import {
  normaliseProfilePatch,
  pickProfileFields,
  readProfileFields,
  type ProfileField,
  type ProfilePatch,
} from "../profile-fields";
import {
  mergeProposal,
  PROPOSABLE_FIELDS,
  type ProposalContents,
} from "../profile-proposals";

export interface ProposeProfileChangeInput {
  membershipId: string;
  /** Any subset of `PROPOSABLE_FIELDS`. The photograph is `ProposeAvatarChange`'s. */
  fields: ProfilePatch;
}

/**
 * A reader proposes new values for their own verified details (OPS §4.3; BR §2,
 * "Changing your own details is a request, not an edit").
 *
 * **This command never writes to `users`.** That is BR §6's restated INV-13
 * read strictly: a manager may correct a person's details directly, and a
 * *reader* may not — the existing values stay in force, "including the phone
 * number, so a manager never loses the means of contacting a family
 * mid-change", until a manager approves. It is also master plan §7.2's
 * acceptance clause, which B2a deferred to this slice.
 *
 * ── Proposing again while one is pending ─────────────────────────────────
 *
 * OPS §4.3 calls this normal rather than a failure, and this command implements
 * it in three steps whose order is forced by the schema rather than chosen:
 *
 * 1. **Look for a pending request.** RLS scopes the read to this shelf.
 * 2. **Merge and update, or insert.** `../profile-proposals.ts` holds the merge
 *    and the one constant that reverses it; see there for why "replace" taken
 *    literally would silently lose a reader's phone proposal the moment they
 *    also proposed a photograph.
 * 3. **Catch `23505` on the insert** and raise `change_already_pending`.
 *
 * Step 3 is not belt and braces, and it is the part an implementer following
 * OPS alone would leave out. `profile_change_requests_one_pending` is `unique
 * (user_id) where status = 'pending'` — **global across shelves**, while the
 * table is RLS-scoped per shelf. So a reader with memberships at two parishes
 * who has a pending request at the first and proposes at the second: step 1
 * cannot see the blocking row (RLS hides it), step 2 therefore inserts, and the
 * index rejects it. Without the catch that surfaces as a raw `PostgresError`
 * out of the driver, which OPS §2 forbids. `change_already_pending` — "Bạn
 * đang có một yêu cầu thay đổi chờ duyệt." — has been sitting in `errors.ts`
 * unreferenced since before this slice and is the honest sentence for it, so
 * no new Vietnamese is written for a case OPS never described.
 *
 * ── Two smaller decisions ────────────────────────────────────────────────
 *
 * **A field proposed at its current value is not a proposal.** OPS §4.3's
 * `empty_proposal` is "nothing differs from the current values", so the
 * incoming patch is filtered against the person as they stand before anything
 * is stored. Otherwise a reader could fill a form, change nothing, and leave a
 * manager a request to decide about that would change nothing.
 *
 * **`requested_at` comes from `ctx.clock`, never from the column default.**
 * The default is `now()` on the *database* host (DATABASE.md §6, two clocks in
 * one transaction), and this is a timestamp the domain means: a test with a
 * `fixedClock` must be able to make a request look a week old without waiting a
 * week. `updated_at` on this table is written by `set_updated_at()` from SQL
 * `now()` and will not agree with it under a fixed clock; that is the rule, not
 * a bug, and no test may assert otherwise.
 */
export const proposeProfileChange: Command<
  ProposeProfileChangeInput,
  { profileChangeRequestId: string }
> = async (tx, ctx, input) => {
  requireSelfOrManager(ctx, input.membershipId);
  // A proposal names who asked, and `profile_change.proposed`'s audit row is
  // the only place that survives once the request is decided. `systemContext`
  // holds `super_admin` with a null `userId` and would otherwise pass the gate
  // above on rank alone — the defect `requireIdentifiedActor` records.
  requireIdentifiedActor(ctx);

  // Narrowed to the seven before validation, so a caller that sends
  // `avatar_url` gets it dropped rather than quietly bypassing
  // `ProposeAvatarChange`'s size and content-type policy, which lives at the
  // surface and cannot be enforced from here.
  const named = onlyProposable(input.fields);
  const patch = normaliseProfilePatch(named);
  if (Object.keys(patch).length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  // RLS scopes this to `ctx.bookshelfId`; `users` has none, so this join is
  // the whole of what stands between a caller and any person in the system.
  const [membership] = await tx<{ user_id: string }[]>`
    select m.user_id from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${input.membershipId} and m.deleted_at is null
  `;
  if (!membership) throw new NotFound("membership_not_found");

  const current = await readProfileFields(tx, membership.user_id);
  if (!current) throw new NotFound("membership_not_found");

  const incoming = Object.fromEntries(
    Object.entries(patch).filter(
      ([field, value]) => current[field as ProfileField] !== value,
    ),
  ) as ProfilePatch;
  if (Object.keys(incoming).length === 0) {
    throw new RuleViolated("empty_proposal");
  }

  const [pending] = await tx<
    { id: string; proposed_values: unknown; previous_values: unknown }[]
  >`
    select id, proposed_values, previous_values
    from profile_change_requests
    where user_id = ${membership.user_id} and status = 'pending'
  `;

  const existing: ProposalContents | null = pending
    ? {
        proposed: pickProfileFields(pending.proposed_values),
        previous: pickProfileFields(pending.previous_values),
      }
    : null;
  const next = mergeProposal(existing, incoming, current);

  const requestId = pending
    ? await replacePending(tx, ctx.clock.now(), pending.id, next)
    : await insertPending(
        tx,
        ctx.clock.now(),
        ctx.bookshelfId,
        membership.user_id,
        next,
      );

  return {
    result: { profileChangeRequestId: requestId },
    audit: {
      action: "profile_change.proposed",
      // The request, not the person: nothing on the person changed, and that
      // is the whole point of this command. `ApproveProfileChange` is the one
      // that audits against the user id, because that is when a person's
      // details actually move.
      entityType: "profile_change_request",
      entityId: requestId,
      before: next.previous,
      after: next.proposed,
    },
  };
};

/** The seven, and nothing else — see `PROPOSABLE_FIELDS`. */
function onlyProposable(fields: ProfilePatch): ProfilePatch {
  return Object.fromEntries(
    PROPOSABLE_FIELDS.filter((f) => fields[f] !== undefined).map((f) => [
      f,
      fields[f],
    ]),
  ) as ProfilePatch;
}

async function replacePending(
  tx: Tx,
  now: Date,
  id: string,
  next: ProposalContents,
): Promise<string> {
  await tx`
    update profile_change_requests
       set proposed_values = ${tx.json(next.proposed)},
           previous_values = ${tx.json(next.previous)},
           requested_at    = ${now}
     where id = ${id} and status = 'pending'
  `;
  return id;
}

async function insertPending(
  tx: Tx,
  now: Date,
  // `0008:8` calls this column "whose manager decides", and the answer is
  // always the shelf this call is scoped to — `ctx.bookshelfId`, never a value
  // from input. RLS's `with check` rejects anything else outright rather than
  // rescoping it, so this is belt as well as braces; taking it from input would
  // still be a value somebody could later be tempted to trust.
  bookshelfId: string,
  userId: string,
  next: ProposalContents,
): Promise<string> {
  try {
    const [row] = await tx<{ id: string }[]>`
      insert into profile_change_requests
        (user_id, bookshelf_id, proposed_values, previous_values, status, requested_at)
      values
        (${userId}, ${bookshelfId},
         ${tx.json(next.proposed)}, ${tx.json(next.previous)}, 'pending', ${now})
      returning id
    `;
    return row.id;
  } catch (e) {
    // The cross-shelf pending row this transaction cannot see. See the note in
    // this file's docstring: the index is global, the policy is per shelf, and
    // this catch is the only thing between that combination and a raw 23505.
    if (isUniqueViolation(e)) throw new RuleViolated("change_already_pending");
    throw e;
  }
}
