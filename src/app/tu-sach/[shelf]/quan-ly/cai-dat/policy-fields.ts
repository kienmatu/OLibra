import type { PolicyField } from "../../../../../domain/admin/policy";

/**
 * The lending-policy fields `/quan-ly/cai-dat` shows a manager — QA
 * remediation Task 23.
 *
 * See the sibling file next to `/quan-tri/tu-sach/page.tsx`
 * (`src/app/quan-tri/tu-sach/policy-fields.ts`) for why this lives apart
 * from `page.tsx` and for the test that compares the two arrays: this one is
 * "every policy field this screen displays", that one is "every policy field
 * an administrator can change", and QA remediation Task 23 exists because a
 * manager could read one that was in this list and not in that one
 * (`due_soon_days`) with no way for anybody to act on it.
 *
 * `page.tsx`'s `.map()` over this array is what actually renders each
 * `PolicyRow`, so this list and the displayed set cannot drift apart within
 * this file — only across the two files, which is exactly what the test
 * checks for.
 */
export const DISPLAYED_POLICY_FIELDS: readonly PolicyField[] = [
  "loan_days",
  "max_concurrent_loans",
  "max_renewals",
  "renewal_days",
  "hold_days",
  "due_soon_days",
];
