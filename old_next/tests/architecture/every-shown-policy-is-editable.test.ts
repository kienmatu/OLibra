import { expect, test } from "vitest";
import { ALL_POLICY_FIELDS, type PolicyField } from "../../src/domain/admin/policy";
import { EDITABLE_POLICY_FIELDS } from "../../src/app/quan-tri/tu-sach/policy-fields";
import { DISPLAYED_POLICY_FIELDS } from "../../src/app/tu-sach/[shelf]/quan-ly/cai-dat/policy-fields";

/**
 * QA remediation Task 23: "every policy shown is a policy editable."
 *
 * **The defect this closes.** `/quan-ly/cai-dat` listed "Báo sắp đến hạn
 * trước — 3 ngày" (`due_soon_days`) next to five other lending-policy rows,
 * under the sentence "Chỉ quản trị viên mới đổi được các mục này" — a
 * promise that an administrator, somewhere, can change what this row shows.
 * No admin form had the field. A manager reading that row had no way to
 * know the number was unchangeable by anyone, and an administrator asked to
 * change it had no screen that offered to.
 *
 * **Two independently declared arrays, not one constant compared to
 * itself.** `EDITABLE_POLICY_FIELDS` (`src/app/quan-tri/tu-sach
 * /policy-fields.ts`) is the literal array that page's own `.map()` renders
 * its six `<Field>` inputs from; `DISPLAYED_POLICY_FIELDS` (the sibling next
 * to `/quan-ly/cai-dat/page.tsx`) is the literal array that page's own
 * `.map()` renders its six `<PolicyRow>`s from. Each is authored in its own
 * file, next to the page it drives, and each is what actually produces that
 * page's rendered fields — not a parallel list somebody has to remember to
 * keep in sync by hand. Editing one file's array without the other is
 * exactly the change this test exists to catch, and "the check can see both
 * halves of what it compares" below proves it does: it is not a test that
 * imports one constant twice and confirms it equals itself.
 *
 * This branch has twice shipped an architecture test that could not fail —
 * once because the thing it walked was empty, once because the regex it
 * matched could never match the real spelling. The second test in this file
 * is that same falsification check, applied here: it breaks the property on
 * *data this test constructs itself*, so proving the comparison can fail
 * costs nothing and needs no source file edited and reverted by hand.
 *
 * **`ALL_POLICY_FIELDS` is the third leg, not a redundant one.** Two lists
 * that agree with each other but have both quietly dropped a field — say,
 * a future Task 24 adds a seventh lending-policy number and both pages'
 * arrays are hand-edited to add it except one is missed on both screens by
 * the same person in the same sitting — would pass a two-way comparison
 * while still being wrong. `ALL_POLICY_FIELDS`
 * (`src/domain/admin/policy.ts`) is the bound table's own key list, checked
 * against independently of either page.
 */

function asSortedArray(fields: readonly PolicyField[]): string[] {
  return [...fields].sort();
}

test("the set of policy fields /quan-ly/cai-dat shows a manager equals the set /quan-tri/tu-sach lets an administrator edit", () => {
  expect(asSortedArray(DISPLAYED_POLICY_FIELDS)).toEqual(
    asSortedArray(EDITABLE_POLICY_FIELDS),
  );
});

test("both screens' lists are the bound table's own fields, no more and no fewer", () => {
  // The guard `ALL_POLICY_FIELDS`'s own docstring names: the two-way
  // comparison above cannot see a field both screens agree to omit, or a
  // stray one both screens agree to invent. This can.
  expect(asSortedArray(EDITABLE_POLICY_FIELDS)).toEqual(
    asSortedArray(ALL_POLICY_FIELDS),
  );
  expect(asSortedArray(DISPLAYED_POLICY_FIELDS)).toEqual(
    asSortedArray(ALL_POLICY_FIELDS),
  );
});

test("neither screen's array names the same field twice", () => {
  // A duplicate would pass the set-equality checks above silently — two
  // copies of `due_soon_days` and zero of `hold_days` sorts to a different
  // array than the canonical six, so that particular duplicate is already
  // caught, but a duplicate of a field that is *also* present once elsewhere
  // would not be. Checked directly rather than relied upon.
  expect(new Set(EDITABLE_POLICY_FIELDS).size).toBe(EDITABLE_POLICY_FIELDS.length);
  expect(new Set(DISPLAYED_POLICY_FIELDS).size).toBe(
    DISPLAYED_POLICY_FIELDS.length,
  );
});

test("the check can see both halves of what it compares", () => {
  // `tests/architecture/the-front-door-shows-no-keeper-contact.test.ts` names
  // the failure mode this guards against: an assertion of `toEqual` between
  // two lists that happen to both be empty (or both wrong the same way)
  // passes for the wrong reason. Both real lists are non-empty and six long —
  // the size the QA brief's own bound table fixes — so this is not that.
  expect(EDITABLE_POLICY_FIELDS.length).toBe(6);
  expect(DISPLAYED_POLICY_FIELDS.length).toBe(6);

  // And the comparison genuinely distinguishes an unequal pair — proof that
  // a future edit to either page's array, in either direction, is a red
  // test rather than a check nothing could ever fail. Built from copies of
  // the real arrays rather than a fixed literal, so this stays a faithful
  // rehearsal of "one screen's array grew or shrank by one field" even if
  // the six real fields change names later.
  const oneFieldMissing = EDITABLE_POLICY_FIELDS.slice(1);
  expect(asSortedArray(oneFieldMissing)).not.toEqual(
    asSortedArray(DISPLAYED_POLICY_FIELDS),
  );

  const oneFieldRepeated = [...DISPLAYED_POLICY_FIELDS, DISPLAYED_POLICY_FIELDS[0]];
  expect(new Set(oneFieldRepeated).size).not.toBe(oneFieldRepeated.length);
});
