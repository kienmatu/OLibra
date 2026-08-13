import { PROFILE_FIELDS, type ProfileField } from "@/domain/members/profile-fields";

/**
 * The Vietnamese label for each of `PROFILE_FIELDS`, for the one screen that
 * has to name them: BR §16.3's profile-change queue, "one card per proposed
 * change, showing the current value and the proposed one side by side".
 *
 * **Not new copy.** Every one of the eight words is already shipped, and this
 * file is where they meet the domain's field names rather than a ninth place
 * they get written — the same argument `src/lib/roles.ts` makes for the three
 * role words:
 *
 * - `saint_name` → **Tên thánh**, `full_name` → **Họ và tên**, `date_of_birth`
 *   → **Ngày sinh**, `phone` → **Số điện thoại**, `email` → **Email** — all
 *   five from `tu-sach/[shelf]/ho-so/page.tsx`, the reader's own form,
 *   which is the screen these proposals are made on.
 * - `father_name` → **Tên cha**, `mother_name` → **Tên mẹ** — from
 *   `quan-ly/nguoi-doc/[id]`'s profile table and from the registration form.
 * - `avatar_url` → **Ảnh đại diện** — the label the fixture version of this
 *   very queue used for its photograph row.
 * - `phone_missing_reason` → **Lý do chưa có số điện thoại** — new copy, PO
 *   feedback round 1 Task 7: the interface requires a phone even though the
 *   column stays nullable, and this is the label for the reason a manager
 *   types when one genuinely is not there.
 *
 * A total `Record<ProfileField, string>` rather than a lookup that may miss, so
 * a tenth field added to `PROFILE_FIELDS` is a compile error here instead of a
 * card that renders a change with no name on it. `tests/lib/profile-labels.test
 * .ts` asserts the two lists agree, because the compiler cannot see a label
 * that has quietly become the wrong word.
 */
export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  saint_name: "Tên thánh",
  full_name: "Họ và tên",
  date_of_birth: "Ngày sinh",
  father_name: "Tên cha",
  mother_name: "Tên mẹ",
  phone: "Số điện thoại",
  phone_missing_reason: "Lý do chưa có số điện thoại",
  email: "Email",
  avatar_url: "Ảnh đại diện",
};

/**
 * The fields a request actually proposes, in `PROFILE_FIELDS`' own order.
 *
 * **The order matters and must not be the object's.** `proposed_values` is
 * `jsonb`, so its key order is whatever the writer happened to serialise —
 * which would make two cards for the same pair of fields list them differently,
 * on a screen whose whole job is a side-by-side comparison a manager reads
 * quickly. Iterating `PROFILE_FIELDS` gives one order everywhere, and it is the
 * order BR §5.3 lists the person's facts in.
 *
 * A field is *named* when its key is present, which is not the same as its
 * value being set: `null` means "clear it" and is a change worth showing, while
 * an absent key means the reader proposed nothing about it. That is the split
 * `domain/members/profile-fields.ts` settled for the write path, applied here to
 * the read.
 */
export function proposedFields(
  proposed: Partial<Record<ProfileField, string | null>>,
): ProfileField[] {
  return PROFILE_FIELDS.filter((field) => proposed[field] !== undefined);
}
