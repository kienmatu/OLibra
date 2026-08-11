import { Field, Input, Select } from "@/components/ui/field";
import { systemClock } from "@/domain/kernel/clock";

/**
 * Provenance on the physical object (§3 of the refinements design; BR §5.4).
 * Shared by the two catalogue forms — "Thêm sách" and "Thêm bản" — so the
 * donor question is answered once rather than twice, and so both forms
 * default "Ngày nhận" to the same today.
 *
 * A `<select>` of members, not a text input with a `<datalist>`: a datalist
 * always submits a string, so there was never a way to tell "chose member
 * Maria Vũ Khánh Linh" from "typed those words" — and `book_copies
 * .acquired_from_membership_id` (the whole reason this field exists) could
 * never be written. Two explicit, either/or controls fix that: the select
 * carries the member's id, the text input is only for a donor with no
 * account.
 *
 * `today` comes from `systemClock.today()` (Asia/Ho_Chi_Minh), not
 * `new Date().toISOString()`: the latter is UTC, so between 00:00 and 07:00
 * local time it silently defaults to yesterday — and 07:00 Sunday is exactly
 * when a volunteer is at the shelf cataloguing a donation.
 *
 * **`donors` is a parameter, and it used to be `readers` from
 * `src/lib/fixtures.ts`** (U3 wave 1, found by this slice's extension of
 * `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` to the chrome a
 * wired page renders). This component is rendered by
 * `quan-ly/sach/[id]`, which has been wired since C1 — so the "Thêm bản" form
 * on a page of one parish's real books offered a donor list of eleven invented
 * children from another parish, and would have written one of their ids into
 * `book_copies.acquired_from_membership_id` the day that form was given an
 * action. Nothing in either route file named the fixtures, which is why no
 * check saw it.
 *
 * **An empty list renders no member picker at all**, rather than a `<select>`
 * whose only option is "— Không chọn —". A control that cannot be chosen from
 * is not the same control with less in it, and the outsider text field beside
 * it already covers "a donor with no account" in its own hint. This is no
 * longer a live case for either caller — Task 11 (QA remediation) gave
 * "Thêm bản" its own `action` and, in the same change, its own real read of
 * the shelf's members, matching what "Thêm sách" already did — but the branch
 * stays: an empty list is still the honest answer for a shelf with no active
 * members at all, and a `<select>` with nothing to choose from would be worse
 * than no control.
 *
 * ── The radio-driven disclosure (QA remediation Task 19) ────────────────────
 *
 * "Chọn đúng MỘT trong hai cách" was this component's own copy from the start,
 * and nothing here — or in `createBook`/`addCopies` — ever enforced it:
 * filling the `<select>` *and* the text input together wrote both
 * `acquired_from` and `acquired_from_membership_id` onto every copy.
 * `assertSingleDonor` (`src/domain/catalogue/policy.ts`) is the authoritative
 * fix; this is its mirror, in the shape `checkPolicyBound`'s `min`/`max` on the
 * two admin forms and `assertPhone`'s `pattern` already established for this
 * codebase — a form that repeats the domain's rule rather than owning it.
 *
 * **Two radios, shown-one-at-a-time, no JavaScript.** This app renders no
 * client script (AGENTS.md), so "mirror the guard in the form" cannot mean an
 * `onChange` handler clearing the other field. `condition-picker.tsx` already
 * solved the identical problem — a `has-checked:`/`group-has-[...]:` pair,
 * Tailwind v4's first-class `:has()` variant, toggling visibility purely in
 * CSS — and this reuses that exact mechanism rather than inventing a second
 * one. Neither radio is checked by default (unless a donation-queue caller
 * pre-selected a member, in which case the "member" radio starts checked),
 * which is what makes "donor omitted entirely" still representable: nothing
 * chosen, both panels hidden, both underlying inputs empty.
 *
 * **This mirror is a UX convenience, not the guarantee.** A volunteer who
 * types a name, then changes their mind and switches to the member radio,
 * leaves the now-hidden text input holding what they typed — `display:none`
 * does not remove a field from form submission, only `disabled` does, and
 * disabling on switch needs JavaScript this app does not ship. That case still
 * reaches `assertSingleDonor` and is still refused, with the same Vietnamese
 * sentence a raw POST would get. The radios make the *common* mistake — filling
 * both on purpose, not noticing the form's own instruction — impossible to
 * commit through the UI; the domain is what makes the rare one impossible to
 * commit at all. That is the same relationship every other mirrored rule in
 * this codebase has with its domain check (`errors.ts`'s own opening
 * docstring), stated here because this is the one mirror that cannot close the
 * gap completely by construction.
 */
export function DonorFields({
  idPrefix,
  selectedMemberId,
  donors,
}: {
  /** Distinguishes ids between the two forms this renders on (e.g.
   *  "nguoi-tang" on Thêm sách, "them-nguoi-tang" on Thêm bản). */
  idPrefix: string;
  /** Pre-selects a member — used when a manager arrives here from "Duyệt"
   *  on the donation queue, where the donor is already known (§3). */
  selectedMemberId?: string;
  /**
   * The members this shelf may attribute a gift to. Empty means "this page
   * cannot say", and the picker is then absent — never a list from somewhere
   * else.
   *
   * The caller decides who qualifies. The rule the fixture caller applies, and
   * the one a wired caller should: only a member who could plausibly be
   * standing at the shelf handing over a book — someone who has left has no
   * ongoing relationship to link the gift to, and someone still `pending` is
   * not yet a member at all.
   */
  donors: { id: string; fullName: string }[];
}) {
  const today = systemClock.today();

  const memberFieldId = `${idPrefix}-thanh-vien`;
  const outsiderFieldId = `${idPrefix}-ngoai`;
  const dateFieldId = `${idPrefix}-ngay-nhan`;
  const modeFieldName = `${idPrefix}-cach-chon`;
  const modeMemberId = `${idPrefix}-cach-thanh-vien`;
  const modeOutsiderId = `${idPrefix}-cach-ngoai`;

  return (
    <div className="space-y-5 rounded-card border border-hairline bg-surface p-5">
      <div>
        <p className="text-[16px] font-semibold">Người tặng</p>
        <p className="mt-1 text-[14px] text-meta">
          Không bắt buộc — nhiều sách là mua, không phải tặng.
          {donors.length > 0
            ? " Nếu có người tặng, chọn đúng MỘT trong hai cách bên dưới: chọn bạn đọc nếu người tặng đã có tài khoản trong tủ sách, để sách được gắn với đúng hồ sơ của bạn đọc đó; hoặc gõ tên nếu người tặng chưa có tài khoản. Chỉ cách chọn bạn đọc mới gắn được sách tặng với một hồ sơ có thật."
            : " Nếu có người tặng, gõ tên — tủ sách này chưa có bạn đọc nào để chọn."}
        </p>
      </div>

      {donors.length > 0 ? (
        // `group` scopes the two `group-has-[...]` selectors below to this
        // radio pair and nobody else's — the same scoping note
        // `condition-picker.tsx` gives for why it is value-based rather than
        // id-based (this component can render twice in one page load across
        // different forms, each with its own `idPrefix`, but Tailwind still
        // generates the utility classes from literal text at build time).
        <div className="group space-y-4">
          <fieldset>
            <legend className="text-[15px] font-medium">Cách chọn</legend>
            <div className="mt-2 flex flex-wrap gap-5">
              <label
                htmlFor={modeMemberId}
                className="flex min-h-11 items-center gap-2.5 text-[15px]"
              >
                <input
                  type="radio"
                  id={modeMemberId}
                  name={modeFieldName}
                  value="thanhvien"
                  defaultChecked={selectedMemberId !== undefined}
                  className="size-5 accent-terracotta"
                />
                Chọn bạn đọc đã có tài khoản
              </label>
              <label
                htmlFor={modeOutsiderId}
                className="flex min-h-11 items-center gap-2.5 text-[15px]"
              >
                <input
                  type="radio"
                  id={modeOutsiderId}
                  name={modeFieldName}
                  value="ngoai"
                  className="size-5 accent-terracotta"
                />
                Gõ tên người chưa có tài khoản
              </label>
            </div>
          </fieldset>

          {/* Hidden until "Chọn bạn đọc" is checked. */}
          <div className="hidden group-has-[input[value=thanhvien]:checked]:block">
            <Field
              label="Chọn bạn đọc đã có tài khoản"
              htmlFor={memberFieldId}
              hint="Dùng khi người tặng là một bạn đọc của tủ sách."
            >
              <Select
                id={memberFieldId}
                name="donorMembershipId"
                defaultValue={selectedMemberId ?? ""}
              >
                <option value="">— Không chọn —</option>
                {donors.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Hidden until "Gõ tên" is checked. */}
          <div className="hidden group-has-[input[value=ngoai]:checked]:block">
            <Field
              label="Gõ tên người tặng chưa có tài khoản"
              htmlFor={outsiderFieldId}
              hint="Dùng khi người tặng không phải bạn đọc của tủ sách — ví dụ một gia đình trong xứ tặng lại sách cũ."
            >
              <Input
                id={outsiderFieldId}
                name="donorName"
                placeholder="vd: bác Hoà"
              />
            </Field>
          </div>
        </div>
      ) : (
        // No members to choose from at all — the radios would offer a choice
        // between "pick from a list with nothing in it" and "type a name",
        // which is not a real choice. Only the text field can ever be filled,
        // so there is nothing for assertSingleDonor to disambiguate here.
        <Field
          label="Gõ tên người tặng"
          htmlFor={outsiderFieldId}
          hint="Dùng khi người tặng không phải bạn đọc của tủ sách — ví dụ một gia đình trong xứ tặng lại sách cũ."
        >
          <Input id={outsiderFieldId} name="donorName" placeholder="vd: bác Hoà" />
        </Field>
      )}

      <Field
        label="Ngày nhận"
        htmlFor={dateFieldId}
        hint="Mặc định là hôm nay. Có thể đổi vì sách tặng thường được vào sổ trễ vài tuần sau khi nhận."
      >
        <Input
          id={dateFieldId}
          name="acquiredOn"
          type="date"
          defaultValue={today}
          className="max-w-52"
        />
      </Field>
    </div>
  );
}
