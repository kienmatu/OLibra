import { expect, test } from "vitest";
import { PROFILE_FIELDS } from "../../src/domain/members/profile-fields";
import { PROFILE_FIELD_LABELS, proposedFields } from "../../src/lib/profile-labels";

/**
 * The profile-change queue names eight fields, and every one of the eight words
 * is copy this project already shipped somewhere else. What a type cannot hold
 * is *that* — `Record<ProfileField, string>` proves a label exists and says
 * nothing about whether it is still the right word, or whether the list and the
 * domain's have drifted apart in the direction the compiler cannot see.
 */

test("every field the domain writes has a label, and no label names a field it does not", () => {
  // The `Record` type already makes the forward direction a compile error. The
  // reverse — a label left behind after a field is removed from
  // `PROFILE_FIELDS` — is not, and it would sit in this file looking correct.
  expect(Object.keys(PROFILE_FIELD_LABELS).sort()).toEqual(
    [...PROFILE_FIELDS].sort(),
  );
});

test("the labels are the words already shipped elsewhere in the app", () => {
  // Pinned rather than trusted: `src/lib/roles.ts` records the same rule for the
  // three role words, and its reason applies here — the risk is not a missing
  // label, it is somebody writing a *new* Vietnamese sentence for a field the
  // reader's own form already names.
  expect(PROFILE_FIELD_LABELS).toEqual({
    saint_name: "Tên thánh",
    full_name: "Họ và tên",
    date_of_birth: "Ngày sinh",
    father_name: "Tên cha",
    mother_name: "Tên mẹ",
    phone: "Số điện thoại",
    email: "Email",
    avatar_url: "Ảnh đại diện",
  });
});

test("a proposal lists its fields in the domain's order, not the object's", () => {
  // `proposed_values` is `jsonb`, so key order is whatever the writer
  // serialised. Two cards proposing the same pair would otherwise list them
  // differently, on a screen whose whole job is a side-by-side comparison read
  // at speed.
  expect(proposedFields({ phone: "0912345678", saint_name: "Maria" })).toEqual([
    "saint_name",
    "phone",
  ]);
});

test("a field proposed as null is a change, and an absent one is not", () => {
  // `null` means "clear it" — a reader removing an email they no longer use is
  // a real proposal a manager has to decide. `undefined` is a field the request
  // said nothing about. `domain/members/profile-fields.ts` settled that split
  // for the write path; a queue that showed the two alike would either hide a
  // deletion or invent a change.
  expect(proposedFields({ email: null })).toEqual(["email"]);
  expect(proposedFields({ email: undefined })).toEqual([]);
  expect(proposedFields({})).toEqual([]);
});
