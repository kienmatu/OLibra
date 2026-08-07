import { Field, Input, Select } from "@/components/ui/field";
import { readers } from "@/lib/fixtures";
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
 */
export function DonorFields({
  idPrefix,
  selectedMemberId,
}: {
  /** Distinguishes ids between the two forms this renders on (e.g.
   *  "nguoi-tang" on Thêm sách, "them-nguoi-tang" on Thêm bản). */
  idPrefix: string;
  /** Pre-selects a member — used when a manager arrives here from "Duyệt"
   *  on the donation queue, where the donor is already known (§3). */
  selectedMemberId?: string;
}) {
  // Only a member who could plausibly be standing at the shelf handing over
  // a book counts as a donor: someone who has left has no ongoing
  // relationship to the shelf to link the gift to, and someone still
  // `pending` is not yet a member at all.
  const donors = readers.filter(
    (r) => r.membership !== "left" && r.membership !== "pending",
  );
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
