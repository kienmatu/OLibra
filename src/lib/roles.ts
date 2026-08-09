// Relative specifier, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: the suite imports this module directly
// and Vitest resolves no alias (`vitest.config.ts` declares none).
import type { Role } from "../domain/kernel/tenant";

/**
 * The Vietnamese word for a role, for the one place a role is *displayed*: the
 * signed-in line at the foot of the manager sidebar.
 *
 * **A translation of an enum, not new copy.** All three words are already in
 * this repository, and this file is where they meet BR §13.1's enum
 * (`src/domain/kernel/tenant.ts`) rather than a fourth place they get written:
 *
 * - `manager` → **Quản lý**, which is what `manager-shell.tsx` printed under
 *   the hard-coded name it printed before U3.
 * - `admin` → **Quản trị tủ sách**. BR §13.1 defines `admin` as "a manager who
 *   can also administer that shelf", per bookshelf — and that is exactly the
 *   role the super-admin screens already label this way, under the fixture name
 *   `shelf-admin` (`src/app/quan-tri/quan-ly-vien/page.tsx`). The fixture enum
 *   is not the domain's; the word is.
 * - `super_admin` → **Quản trị viên**, which `AdminShell` prints under its own
 *   signed-in line, and which the same fixture map uses for its network-wide
 *   `admin`.
 *
 * **`reader` and `guest` get no label, and that is a `null` rather than a
 * word.** Neither can reach a page that renders this chrome: every manager
 * query opens with `requireManager`, and `loadPage` turns the resulting
 * `RuleViolated("not_permitted")` into a 404 for a signed-in non-manager and a
 * redirect for a guest, before any HTML exists. So there is no screen on which
 * a word for them would ever be read, and inventing two — BR §13.1 supplies no
 * Vietnamese for any role — would be adding copy nobody wrote to cover a case
 * that cannot happen.
 *
 * Returning `null` for it, rather than omitting the entries and letting a
 * lookup come back `undefined`, is `statusForAvailability`'s shape in
 * `src/lib/status.ts` and it is chosen for that function's stated reason: a
 * total `Record` over the labelled roles means adding a role to `ROLE_RANK` is
 * a compile error here rather than a sidebar that silently prints nothing.
 */
export type LabelledRole = "manager" | "admin" | "super_admin";

export const ROLE_LABELS: Record<LabelledRole, string> = {
  manager: "Quản lý",
  admin: "Quản trị tủ sách",
  super_admin: "Quản trị viên",
};

/**
 * `Object.hasOwn`, never `in` — `src/lib/search-params.ts`'s `refusalFrom`
 * carries the long version. `"constructor" in ROLE_LABELS` is `true`, and the
 * lookup then returns a *function*, which React refuses to render. `Role` is a
 * closed union so nothing here can currently spell one of those eight names,
 * but the value behind it is a `membership_role` column read at request time,
 * and "the type says it cannot happen" is exactly the reasoning that shipped
 * `?loi=constructor` as an HTTP 500 on three screens.
 */
export function roleLabel(role: Role): string | null {
  return Object.hasOwn(ROLE_LABELS, role)
    ? ROLE_LABELS[role as LabelledRole]
    : null;
}
