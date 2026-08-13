/**
 * Which of the two independently-submittable forms `/quan-tri/tu-sach`
 * renders once a shelf is selected — profile+contacts, or lending policy —
 * a success or a refusal belongs to.
 *
 * Fix round 2 split the page's one settings form in two so a policy-only
 * save never carries a `profile` (and so never trips
 * `contact_position_1_required`, the rule this whole split exists to route
 * around). Once there were two forms sharing one URL, `admin-actions.ts`'s
 * `back()` needed a way to say *which* form a `?loi=`/`?da-luu=` belongs to
 * — see `search-params.ts`'s `ACTION_SCOPE_PARAM` for the query-string half
 * of that.
 *
 * **Named once, imported by both sides, rather than a bare string literal
 * repeated in `admin-actions.ts` (the write side) and `page.tsx` (the read
 * side).** That repetition was the actual defect a review round found: nothing
 * stopped the two files from spelling the same value two different ways, and
 * the failure mode is not a visible crash — it is silence. Before this file
 * existed, a typo on the read side (`"ho_so"` for `"ho-so"`) would fail to
 * match the value the write side sent, so `page.tsx`'s `profileRefusal` stayed
 * `null` — and because the top-of-page banner is deliberately scoped *away*
 * from any `pham-vi`-bearing refusal (it belongs to `createBookshelfAction`'s
 * unscoped one), a genuine `contact_position_1_required` refusal would render
 * nowhere on the page at all. A union type turns that typo into a compile
 * error on whichever side made it, rather than a refusal nobody can see.
 */
export type BookshelfFormScope = "ho-so" | "chinh-sach";

/**
 * One property per form, so a call site writes `BOOKSHELF_FORM_SCOPE.profile`
 * — checked by the compiler against `BookshelfFormScope` above and against
 * every other reference to the same form — rather than retyping `"ho-so"`
 * and trusting it matches.
 */
export const BOOKSHELF_FORM_SCOPE = {
  profile: "ho-so",
  policy: "chinh-sach",
} as const satisfies Record<string, BookshelfFormScope>;
