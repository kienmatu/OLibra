import { type ErrorCode, ValidationFailed } from "../kernel/errors";

/**
 * BR §5.5's lending-policy numbers, bounded — QA remediation Task 15.
 *
 * **The defect this closes.** Measured on 2026-08-10: setting "Số ngày cho
 * mượn" to `0` at `/quan-tri/tu-sach?tu-sach=<id>` and pressing "Lưu" wrote
 * `settings.loan_days = 0` with no error and no confirmation — every loan from
 * that shelf would then fall due the day it was made, and `max_concurrent_
 * loans = 0` would silently stop all borrowing the same way. The two admin
 * forms' `<input type="number" min="0">` had no `max`, and
 * `updateBookshelfSettings` and `updateSystemDefaults` each checked only "a
 * safe integer, not negative" inline — `0` satisfied both. The `min`/`max`
 * mirrored onto the two forms is the convenience; this table is the fix, the
 * same relationship `errors.ts:11-16` states for every refusal in this
 * application: the domain owns the rule, and a form merely repeats it.
 *
 * **One table, not two.** `updateBookshelfSettings`
 * (`./commands/bookshelves.ts`) writes five of these six fields, per shelf;
 * `updateSystemDefaults` (`./commands/system-settings.ts`) writes three of
 * them, as the policy a *newly created* shelf starts with. Both commands
 * write the same numbers under the same names — `loan_days` means the same
 * thing whichever command sets it — so bounding it twice, once per command,
 * is exactly the shape of drift `loanDaysFor`/`holdDaysFor`
 * (`../circulation/settings.ts`) already warns about for the read side: "two
 * copies of 'coalesce to 3' is how one of them later stops matching." A third
 * caller (Task 23's plan already names `due_soon_days` joining both admin
 * forms) inherits the same six-number table rather than being handed a
 * decision to make about a seventh copy.
 *
 * **A function that throws, not a `Block`-returning predicate.** Every other
 * `policy.ts` in this codebase (`../circulation/policy.ts`,
 * `../catalogue/policy.ts`) returns `{ blocked, reason }` so a screen can ask
 * "may I?" *before* the confirm step, per BR §16.3. Neither admin form has a
 * pre-submit "will this be refused?" moment to answer — both already threw
 * inline at the point of writing, and this is that same call, factored out
 * rather than reshaped. Introducing a `Block` return here would be inventing
 * a capability nobody asked for, in the direction `simplify` would flag on
 * review.
 *
 * **`max_renewals` and `due_soon_days` are the two fields whose floor is 0,
 * not 1.** BR §5.5 lets a shelf configure "no renewals allowed", and OPS's
 * notification sweep may legitimately be told to warn a reader on the due
 * date itself — `0` is a real policy for both, not the shape of the defect
 * this task closes. The QA brief states the exception in as many words: "each
 * of `loan_days`, `max_concurrent_loans`, `max_renewals`, `renewal_days`,
 * `hold_days`, `due_soon_days` rejected at `0` (except `max_renewals`, where
 * `0` legitimately means 'no renewals')" — and `due_soon_days` is the second
 * one, found while giving `max_renewals` its own floor rather than reusing
 * `min: 1` for every field.
 */

export type PolicyField =
  | "loan_days"
  | "max_concurrent_loans"
  | "max_renewals"
  | "renewal_days"
  | "hold_days"
  | "due_soon_days";

const BOUNDS: Record<PolicyField, { min: number; max: number; code: ErrorCode }> = {
  loan_days: { min: 1, max: 365, code: "loan_days_out_of_range" },
  max_concurrent_loans: {
    min: 1,
    max: 50,
    code: "max_concurrent_loans_out_of_range",
  },
  max_renewals: { min: 0, max: 10, code: "max_renewals_out_of_range" },
  renewal_days: { min: 1, max: 365, code: "renewal_days_out_of_range" },
  hold_days: { min: 1, max: 30, code: "hold_days_out_of_range" },
  due_soon_days: { min: 0, max: 30, code: "due_soon_days_out_of_range" },
};

/**
 * Every field the table above bounds, in declaration order.
 *
 * QA remediation Task 23. `EDITABLE_POLICY_FIELDS`
 * (`src/app/quan-tri/tu-sach/policy-fields.ts`) and `DISPLAYED_POLICY_FIELDS`
 * (its sibling next to `/quan-ly/cai-dat`) are each their own, independently
 * declared list — that independence is what lets
 * `tests/architecture/every-shown-policy-is-editable.test.ts` catch one
 * drifting from the other. This export is the third leg: both of those lists
 * are also checked against this one, so a field bounded here and shown or
 * edited on neither screen — or the two screens coincidentally agreeing on
 * the same *wrong* subset — is caught too, not only disagreement between them.
 */
export const ALL_POLICY_FIELDS: readonly PolicyField[] = Object.keys(
  BOUNDS,
) as PolicyField[];

/**
 * Refuses `value` unless it is a whole number inside `field`'s own range —
 * the code named is `field`'s own, per the docstring above, so a manager
 * reads which of six numbers was wrong and what range would have been
 * accepted.
 *
 * **`Number.isSafeInteger` first, and unconditionally.** `1.5` and `NaN` both
 * sit inside every field's numeric bound by ordinary comparison, so a check
 * written as two comparisons alone would wave them through — the same
 * `1e21`-shaped concern `pageNumber` (`src/lib/search-params.ts`) and
 * `wholeNumber` (`quan-ly/actions.ts`) each guard their own numeric input
 * against, stated here because this is the one place all six of these
 * particular numbers converge before they reach Postgres.
 */
export function checkPolicyBound(field: PolicyField, value: number): void {
  const bound = BOUNDS[field];
  if (!Number.isSafeInteger(value) || value < bound.min || value > bound.max) {
    throw new ValidationFailed(bound.code, field);
  }
}
