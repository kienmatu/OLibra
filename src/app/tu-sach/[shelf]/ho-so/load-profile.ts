// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports and `./profile-actions.ts` already
// carries in this same directory: `tests/lib/profile-page-without-membership
// .test.ts` imports this module directly, and Vitest resolves no alias.
import type { TenantContext } from "../../../../domain/kernel/tenant";
import type { Tx } from "../../../../domain/kernel/unit-of-work";
import {
  getMyProfile,
  type MyProfile,
} from "../../../../domain/members/queries/get-my-profile";
import { loadParishContext } from "../../../../domain/members/parish-context";
import type {
  ParishTaxonomy,
  ParishUnit,
} from "../../../../domain/members/parish-taxonomy";
import { isMemberlessSuperAdmin } from "../../../../lib/reader-area";

/**
 * Either a real profile to render, or nothing to show because the viewer is
 * not a reader of this shelf — see `isMemberlessSuperAdmin`'s own docstring
 * for exactly who that second case is and, just as importantly, who it is
 * deliberately not.
 */
export type ReaderProfileLoad =
  | { member: false }
  | {
      member: true;
      profile: MyProfile;
      taxonomy: ParishTaxonomy;
      units: ParishUnit[];
    };

/**
 * `/ho-so/page.tsx`'s own read, pulled out of the `loadPage` callback so
 * `tests/lib/profile-page-without-membership.test.ts` can call the exact
 * sequence the page runs without going through `next/headers`' `cookies()` —
 * which `loadPage` itself needs and a test has no request to supply.
 *
 * **This function is the fix for 2026-08-10 QA remediation task 10.** The
 * line that used to sit where the branch below sits was
 * `profile: await getMyProfile(tx, ctx, { membershipId: ctx.actor.membershipId
 * ?? "" })`, reachable in ordinary use — not only by a hand-typed URL — by a
 * super admin, who holds no membership anywhere by design (`../../../../auth
 * /guards.ts`'s `contextFor`). `""` is a syntactically well-formed argument
 * for a `string`, so nothing caught it before it reached
 * `where m.id = ${input.membershipId}`, and Postgres raised a raw `22P02` from
 * inside the transaction — a bare 500 on a page reached from this viewer's own
 * nav (`ReaderTabs` renders "Hồ sơ" regardless of membership). Branching on
 * `isMemberlessSuperAdmin` first, instead of coercing the id into a value the
 * query would accept, is what `tests/lib/profile-page-without-membership
 * .test.ts` pins: mutate this function back to the coercion above and that
 * suite's own falsification test fails with exactly that `22P02`.
 */
export async function loadReaderProfile(
  tx: Tx,
  ctx: TenantContext,
): Promise<ReaderProfileLoad> {
  if (isMemberlessSuperAdmin(ctx)) return { member: false };

  const parish = await loadParishContext(tx, ctx);
  const profile = await getMyProfile(tx, ctx, {
    // Not `ctx.actor.membershipId ?? ""` — see this function's own docstring.
    // `getMyProfile` accepts `string | null` for exactly this call, and the
    // branch above has already handled the one caller that reaches here with
    // `null` in ordinary use, so this is never `null` in practice; it is typed
    // to match `Actor.membershipId` rather than asserted, so a future caller
    // that reintroduces a memberless path does not silently reopen this bug.
    membershipId: ctx.actor.membershipId,
  });

  return { member: true, profile, taxonomy: parish.taxonomy, units: parish.units };
}
