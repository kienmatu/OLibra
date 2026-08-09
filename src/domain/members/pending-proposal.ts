import type { JSONValue } from "postgres";
import { isUniqueViolation, RuleViolated } from "../kernel/errors";
import type { TenantContext } from "../kernel/tenant";
import type { Tx } from "../kernel/unit-of-work";
import { pickProfileFields, type ProfilePatch } from "./profile-fields";
import type { ProposalContents } from "./profile-proposals";

/**
 * The one place a *pending* `profile_change_requests` row is read and written.
 *
 * Two commands create proposals — `ProposeProfileChange` and
 * `ProposeAvatarChange` — and OPS §4.3 calls the second "the file-carrying case
 * rather than a separate lifecycle" of the first. Two copies of that lifecycle
 * would be two things that can disagree, and this module exists because both of
 * the things they could disagree about are silent when they do:
 *
 * **1. The cross-shelf `23505`.** `profile_change_requests_one_pending` is
 * `unique (user_id) where status = 'pending'` — global across shelves — while
 * the table is RLS-scoped per shelf. A reader with memberships at two parishes
 * who has a pending request at the first and proposes at the second: the select
 * cannot see the blocking row (RLS hides it), the insert therefore runs, and the
 * index rejects it. Without the catch below that surfaces as a raw
 * `PostgresError` out of the driver, which OPS §2 forbids.
 * `change_already_pending` — "Bạn đang có một yêu cầu thay đổi chờ duyệt." —
 * has been in `errors.ts` unreferenced since before this slice and is the honest
 * sentence for a case OPS never described, so no new Vietnamese is written.
 *
 * **2. `avatar_object` surviving a proposal that is not about the photograph.**
 * This is the failure that made the extraction necessary rather than merely
 * tidy. `proposed_values` carries the proposed image's storage key so that
 * rejecting or cancelling the request can delete the object instead of leaving
 * it orphaned (OPS §4.3). `pickProfileFields` deliberately drops that key — it
 * is not a column of `users` and must never be written to one — so a command
 * that rebuilt `proposed_values` out of `pickProfileFields`' result alone would
 * silently *erase* the key while keeping the `avatar_url` that names the same
 * object. A reader who proposes a photograph and then corrects their phone
 * number would leave behind an image nothing can ever delete. `carryAvatar`
 * below is the answer, and it is one function rather than a rule two commands
 * have to remember.
 *
 * Why not in `./profile-proposals.ts`, where the merge lives: that module is
 * pure, and its purity is the point — it holds the product reading about how two
 * proposals combine, testable without a database. This one takes a `Tx`.
 */

/**
 * The jsonb key under which a proposed photograph's storage key is kept.
 *
 * **`avatar_object`, not `avatar_key`**, and the name is load-bearing rather
 * than a matter of taste. `kernel/audit.ts`'s `FORBIDDEN` list matches `key` as
 * a whole token, so an `avatar_key` anywhere in an audited payload throws
 * `RuleViolated("audit_forbidden_field")` — and `ProposeAvatarChange` audits
 * exactly this payload. The obvious name is a landmine that goes off at the
 * first audit write, in a command whose tests would otherwise all pass; the
 * name avoids it, where remembering would not have.
 */
export const AVATAR_OBJECT = "avatar_object";

/** A pending row, split into the parts each caller needs. */
export interface PendingProposal {
  id: string;
  contents: ProposalContents;
  /** Null when no photograph has been proposed, or when one arrived as a bare URL. */
  avatarObject: string | null;
}

/**
 * The reader's pending request at *this* shelf, or null.
 *
 * RLS scopes this to `ctx.bookshelfId`, which is also why "or null" is not the
 * same claim as "this person has no pending request anywhere" — see the
 * cross-shelf note in this module's header.
 */
export async function readPendingProposal(
  tx: Tx,
  userId: string,
): Promise<PendingProposal | null> {
  const [row] = await tx<
    { id: string; proposed_values: unknown; previous_values: unknown }[]
  >`
    select id, proposed_values, previous_values
      from profile_change_requests
     where user_id = ${userId} and status = 'pending'
  `;
  if (!row) return null;
  return {
    id: row.id,
    contents: {
      proposed: pickProfileFields(row.proposed_values),
      previous: pickProfileFields(row.previous_values),
    },
    avatarObject: avatarObjectOf(row.proposed_values),
  };
}

/**
 * Reads the storage key out of a `proposed_values` bag, defensively.
 *
 * `jsonb` with no check constraint behind it (DATABASE.md §4.11 names that as
 * the price of the design), so a row written by an older version of the
 * application — or by hand — may hold anything at all here. Anything that is not
 * a non-empty string is "no object": the callers use this value to decide what
 * to *delete*, and a number coerced to a string is a key that names either
 * nothing or somebody else's object.
 */
export function avatarObjectOf(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[AVATAR_OBJECT];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** `proposed_values` as it is stored: the patch, plus the photograph's key. */
function carryAvatar(
  proposed: ProfilePatch,
  avatarObject: string | null,
): JSONValue {
  return avatarObject === null
    ? { ...proposed }
    : { ...proposed, [AVATAR_OBJECT]: avatarObject };
}

/**
 * Replaces the pending row, or inserts one — OPS §4.3's "proposing again while
 * one is pending **replaces** it rather than creating a second… this is normal,
 * specified behavior, not a failure".
 *
 * `requested_at` is written from `ctx.clock`, never left to the column default.
 * The default is `now()` on the *database* host (DATABASE.md §6, two clocks in
 * one transaction) and this is a timestamp the domain means: a test with a
 * `fixedClock` must be able to make a request look a week old without waiting a
 * week. `updated_at` on this table is written by `set_updated_at()` from SQL
 * `now()` and will not agree with it under a fixed clock — that is the rule, not
 * a bug, and no test may assert otherwise.
 */
export async function writePendingProposal(
  tx: Tx,
  ctx: TenantContext,
  args: {
    userId: string;
    pending: PendingProposal | null;
    next: ProposalContents;
    avatarObject: string | null;
  },
): Promise<string> {
  const now = ctx.clock.now();
  const proposed = carryAvatar(args.next.proposed, args.avatarObject);

  if (args.pending) {
    await tx`
      update profile_change_requests
         set proposed_values = ${tx.json(proposed)},
             previous_values = ${tx.json(args.next.previous)},
             requested_at    = ${now}
       where id = ${args.pending.id} and status = 'pending'
    `;
    return args.pending.id;
  }

  // `bookshelf_id` is `ctx.bookshelfId` and never a value from input.
  // `0008:8` calls that column "whose manager decides", and the answer is
  // always the shelf this call is scoped to. RLS's `with check` rejects
  // anything else outright rather than rescoping it, so this is belt as well as
  // braces — but a value taken from input would still be one somebody could
  // later be tempted to trust.
  try {
    const [row] = await tx<{ id: string }[]>`
      insert into profile_change_requests
        (user_id, bookshelf_id, proposed_values, previous_values, status, requested_at)
      values
        (${args.userId}, ${ctx.bookshelfId},
         ${tx.json(proposed)}, ${tx.json(args.next.previous)},
         'pending', ${now})
      returning id
    `;
    return row.id;
  } catch (e) {
    // The cross-shelf pending row this transaction cannot see. See this
    // module's header: the index is global, the policy is per shelf, and this
    // catch is the only thing between that combination and a raw 23505.
    if (isUniqueViolation(e)) throw new RuleViolated("change_already_pending");
    throw e;
  }
}
