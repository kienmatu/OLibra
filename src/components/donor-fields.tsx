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
 * it already covers "a donor with no account" in its own hint. That is what the
 * wired caller passes today: reading the shelf's members for this picker is the
 * wave that wires the form itself, and offering a chooser before then would be
 * offering it over nothing.
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

  return (
    <div className="space-y-5 rounded-card border border-hairline bg-surface p-5">
      <div>
        <p className="text-[16px] font-semibold">Người tặng</p>
        <p className="mt-1 text-[14px] text-meta">
          Không bắt buộc — nhiều sách là mua, không phải tặng. Nếu có người tặng,
          chọn đúng MỘT trong hai cách bên dưới: chọn bạn đọc nếu người tặng đã có
          tài khoản trong tủ sách, để sách được gắn với đúng hồ sơ của bạn đọc đó;
          hoặc gõ tên nếu người tặng chưa có tài khoản. Chỉ cách chọn bạn đọc mới
          gắn được sách tặng với một hồ sơ có thật.
        </p>
      </div>

      {donors.length > 0 ? (
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
      ) : null}

      <Field
        label="Hoặc gõ tên người tặng chưa có tài khoản"
        htmlFor={outsiderFieldId}
        hint="Dùng khi người tặng không phải bạn đọc của tủ sách — ví dụ một gia đình trong xứ tặng lại sách cũ."
      >
        <Input id={outsiderFieldId} name="donorName" placeholder="vd: bác Hoà" />
      </Field>

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
