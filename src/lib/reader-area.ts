// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: `tests/lib/profile-page-without
// -membership.test.ts` imports this module directly, and Vitest resolves no
// alias (`vitest.config.ts` declares none).
import type { TenantContext } from "../domain/kernel/tenant";

/**
 * Whether `ctx` is the one caller `src/auth/guards.ts`'s `contextFor` can
 * resolve with a role that clears every `/ho-so/*` query's `requireReader` /
 * `requireManager` rank check and yet carries no membership of *this* shelf to
 * read those five pages as: a super admin, who by design holds none
 * (`contextFor`'s own docstring — "Signed in, but not a member here" is a
 * different branch of that function, covered below).
 *
 * 2026-08-10 QA remediation, task 10. Reproduced twice, signed in as the
 * seeded super admin: `getMyProfile` (`src/domain/members/queries
 * /get-my-profile.ts`) used to be called from `/ho-so/page.tsx` with
 * `ctx.actor.membershipId ?? ""`, and Postgres raised
 * `22P02 invalid input syntax for type uuid: ""` from inside the read — a
 * bare 500 on a page reached from `ReaderTabs`, which renders "Hồ sơ" for
 * every signed-in viewer, this one included. The other four `/ho-so/*` pages
 * did not 500 for the same viewer, but they were not right either: three scope
 * their queries by `ctx.actor.userId` (which a super admin always has) and
 * rendered an ordinary empty state, and the fourth (`getMyDonations`) compares
 * `ctx.actor.membershipId` to a column with no coercion at all, so `= null`
 * simply matched no row — neither crashed, but neither told a super admin
 * anything true about why the page had nothing to say. All five pages call
 * this predicate first and show `NotAReaderNotice`
 * (`src/components/shell/reader-not-a-member.tsx`) instead, so the five tabs
 * agree with each other about what this viewer is.
 *
 * **Deliberately narrower than `ctx.actor.membershipId === null` alone.**
 * That condition is also true of a signed-in non-member: `contextFor` resolves
 * *that* caller to `role: "guest"` with a real `userId`, and `loadPage`
 * already has a considered, documented answer for them — `requireReader` /
 * `requireManager` inside each query throws `RuleViolated("not_permitted")`,
 * which `loadPage` turns into `notFound()` for the reason its own docstring
 * gives ("the shelf's contents genuinely are none of their business"; BR:91).
 * Checking `membershipId` without `role` here would run *before* that check
 * gets a chance to fire and would quietly replace its 404 with this notice for
 * a caller this task was never about — U2 §3.1 spent a whole docstring on why
 * that 404 is the right answer for exactly that person, and this function must
 * not undo it by accident.
 */
export function isMemberlessSuperAdmin(ctx: TenantContext): boolean {
  return ctx.actor.role === "super_admin" && ctx.actor.membershipId === null;
}
