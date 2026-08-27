import type { PolicyField } from "../../../domain/admin/policy";

/**
 * The lending-policy fields `/quan-tri/tu-sach`'s editor renders — QA
 * remediation Task 23.
 *
 * **Why this lives apart from `page.tsx` rather than as a local constant
 * inside it.** `page.tsx` imports `next/link`, `AdminShell` and
 * `loadAdminPage`, none of which a plain unit test should have to resolve
 * just to answer "which six fields does this page let an administrator
 * edit" — the same reason `admin-actions.ts` sits beside its page rather
 * than inside it (see that file's own header). Kept here, `page.tsx`'s
 * `.map()` over `EDITABLE_POLICY_FIELDS` is what actually renders the form,
 * so this array and the rendered set of fields cannot drift apart *within*
 * this file — and `tests/architecture/every-shown-policy-is-editable
 * .test.ts` imports this module directly to compare it, across files,
 * against its sibling next to `/quan-ly/cai-dat`, which is the comparison
 * that actually matters: the defect this task closes was one screen's field
 * list silently outrunning the other's, and two independently declared
 * arrays are what lets that be caught by a test rather than rediscovered
 * live.
 *
 * BR §5.5's six numbers all sit in this list, not five: QA remediation
 * Task 22's sibling task, Task 23, is exactly the one that noticed
 * `due_soon_days` was displayed to a manager (`/quan-ly/cai-dat`'s "Báo sắp
 * đến hạn trước" row) with no admin form anywhere that could change it —
 * see `src/domain/admin/policy.ts`'s own docstring on why this joins the
 * shared bound table rather than inventing a second one.
 */
export const EDITABLE_POLICY_FIELDS: readonly PolicyField[] = [
  "loan_days",
  "max_concurrent_loans",
  "max_renewals",
  "renewal_days",
  "hold_days",
  "due_soon_days",
];
