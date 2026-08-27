import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { SavedNotice } from "@/components/ui/saved-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { getSystemSettings } from "@/domain/admin/queries/get-admin-overview";
import { countPendingManagerChanges } from "@/domain/admin/queries/get-pending-manager-changes";
import { loadAdminPage } from "@/lib/page-data";
import {
  ACTION_DONE_PARAM,
  param,
  refusalFrom,
  type SearchParams,
} from "@/lib/search-params";
import {
  updateSiteContactAction,
  updateSystemDefaultsAction,
} from "../admin-actions";

/**
 * OPS §3.4's `GetSystemSettings`, and the two commands that write it.
 *
 * **Two forms, because there are two different things.** The contact block is
 * what a stranger reads on `/lien-he`; the defaults decide what a *newly
 * created* shelf starts with. One form with one button would have implied they
 * are saved together, and one of the two is public.
 *
 * **"Chỉ áp dụng cho tủ sách mở mới" is the most important sentence on this
 * page.** `updateSystemDefaults` changes no existing shelf — `createBookshelf`
 * copies these three values into the new shelf's own settings, and every command
 * that reads a policy reads that per-shelf bag. Without the sentence, a screen
 * headed "Mặc định cho tủ sách mới" is still read as "the settings", and an
 * administrator lowering the loan period would expect every parish to follow.
 *
 * **The language and timezone are read-only and always were.** OPS §3.4 lists
 * the timezone as read-only in as many words; the fixture rendered a `<Select>`
 * for the language with one option in it, which is a control that cannot be
 * operated dressed as one that can.
 *
 * **Each form confirms its own save, by name.** QA remediation Task 16 gave
 * three other silent writes a `SavedNotice`; this page's own two were carried
 * over into Task 17 (2026-08-10 QA remediation), which found them still
 * redirecting with no marker. Both land on this same URL, so `?da-luu=` here
 * carries which form saved (`"lien-he"`/`"mac-dinh"`) rather than the bare
 * `1` a page with only one thing to confirm can afford — the identical reason
 * `quan-ly/page.tsx`'s own dashboard distinguishes `"cho-muon"`/`"nhan-tra"`.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Cài đặt hệ thống — Quản trị OLibra" };

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const refusal = refusalFrom(search);
  const saved = param(search, ACTION_DONE_PARAM);

  const { viewer, unreadFeedback, pendingManagerChanges, settings } =
    await loadAdminPage(async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      pendingManagerChanges: await countPendingManagerChanges(tx, ctx),
      settings: await getSystemSettings(tx, ctx),
    }));

  return (
    <AdminShell
      active="cai-dat"
      viewer={viewer}
      counts={{ unreadFeedback, pendingManagerChanges }}
    >
      <PageHeading
        title="Cài đặt hệ thống"
        subtitle="Thông tin liên hệ và các giá trị mặc định của hệ thống."
      />

      {refusal ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
          {messageFor(refusal)}
        </p>
      ) : null}

      <div className="mt-8 max-w-2xl space-y-12">
        <form action={updateSiteContactAction} className="space-y-6">
          <h2 className="text-xl font-semibold">Liên hệ ban quản trị</h2>
          <p className="text-[15px] text-meta">
            Thông tin này hiện công khai ở trang Liên hệ, cho những giáo xứ muốn mở
            tủ sách mới.
          </p>

          <Field label="Tên người phụ trách" htmlFor="lien-he-ten">
            <Input
              id="lien-he-ten"
              name="ten-lien-he"
              defaultValue={settings.contactName ?? ""}
            />
          </Field>
          <Field
            label="Số điện thoại"
            htmlFor="lien-he-dien-thoai"
            hint="Số này hiện công khai và bấm gọi được."
          >
            <Input
              id="lien-he-dien-thoai"
              name="dien-thoai"
              type="tel"
              inputMode="numeric"
              pattern={PHONE_PATTERN}
              defaultValue={settings.contactPhone ?? ""}
            />
          </Field>
          <Field label="Giờ liên hệ" htmlFor="lien-he-gio">
            <Input
              id="lien-he-gio"
              name="gio-lien-he"
              defaultValue={settings.contactHours ?? ""}
            />
          </Field>

          {saved === "lien-he" ? (
            <SavedNotice>Đã lưu thông tin liên hệ.</SavedNotice>
          ) : null}

          <SubmitButton variant="primary" size="lg">
            Lưu thông tin liên hệ
          </SubmitButton>
        </form>

        <form
          action={updateSystemDefaultsAction}
          className="space-y-6 border-t border-hairline pt-12"
        >
          <h2 className="text-xl font-semibold">Mặc định cho tủ sách mới</h2>
          {/* The sentence this page turns on — see the file header. */}
          <p className="text-[15px] text-meta">
            Chỉ áp dụng cho tủ sách mở mới. Các tủ sách đang hoạt động giữ nguyên
            quy định của mình.
          </p>

          {/* QA remediation Task 15: `min={1}` with no `max` let this box
              take an unbounded number and, worse, a sibling box on
              `/quan-tri/tu-sach` took `0` and saved it silently. The `max`
              added to each field here mirrors `checkPolicyBound`'s table
              (`src/domain/admin/policy.ts`) — the browser refuses first, the
              domain is the backstop for anyone bypassing this form. */}
          <Field label="Số ngày cho mượn" required htmlFor="so-ngay-muon">
            <Input
              id="so-ngay-muon"
              name="so-ngay-muon"
              type="number"
              min={1}
              max={365}
              required
              defaultValue={settings.defaultLoanDays}
            />
          </Field>
          <Field label="Số sách mượn cùng lúc" required htmlFor="so-sach-cung-luc">
            <Input
              id="so-sach-cung-luc"
              name="so-sach-cung-luc"
              type="number"
              min={1}
              max={50}
              required
              defaultValue={settings.defaultMaxConcurrentLoans}
            />
          </Field>
          {/* QA remediation Task 23: this form carried only three of the six
              per-shelf policy numbers a new shelf inherits — measured live,
              a new shelf's "Số lần gia hạn" and "Số ngày mỗi lần gia hạn"
              came only from `renewalSettingsFor`'s own read-time fallback
              (1, 7), never from a decision visible on this page. Same
              `min`/`max` mirroring as the three fields above, from the
              identical table. */}
          <Field label="Số lần gia hạn" required htmlFor="so-lan-gia-han">
            <Input
              id="so-lan-gia-han"
              name="so-lan-gia-han"
              type="number"
              // The one field whose floor is 0, not 1 — "no renewals" is a
              // real policy (BR §5.5), the same exception `/quan-tri/tu-sach`
              // gives it.
              min={0}
              max={10}
              required
              defaultValue={settings.defaultMaxRenewals}
            />
          </Field>
          <Field label="Số ngày mỗi lần gia hạn" required htmlFor="so-ngay-gia-han">
            <Input
              id="so-ngay-gia-han"
              name="so-ngay-gia-han"
              type="number"
              min={1}
              max={365}
              required
              defaultValue={settings.defaultRenewalDays}
            />
          </Field>
          <Field label="Số ngày giữ chỗ" required htmlFor="so-ngay-giu-cho">
            <Input
              id="so-ngay-giu-cho"
              name="so-ngay-giu-cho"
              type="number"
              min={1}
              max={30}
              required
              defaultValue={settings.defaultHoldDays}
            />
          </Field>
          {/* QA remediation Task 23's other half: `/quan-ly/cai-dat` showed
              "Báo sắp đến hạn trước" as if it were a policy like the other
              five, with no admin form anywhere that could change it — not
              even this one, the screen that decides what a *new* shelf
              starts with. */}
          <Field label="Báo sắp đến hạn trước" required htmlFor="so-ngay-bao-truoc">
            <Input
              id="so-ngay-bao-truoc"
              name="so-ngay-bao-truoc"
              type="number"
              min={0}
              max={30}
              required
              defaultValue={settings.defaultDueSoonDays}
            />
          </Field>

          {saved === "mac-dinh" ? (
            <SavedNotice>Đã lưu giá trị mặc định.</SavedNotice>
          ) : null}

          <SubmitButton variant="primary" size="lg">
            Lưu giá trị mặc định
          </SubmitButton>
        </form>

        <section className="space-y-6 border-t border-hairline pt-12">
          <h2 className="text-xl font-semibold">Ngôn ngữ và múi giờ</h2>
          {/* Read-only, and rendered as such. The fixture showed a `<Select>`
              with one option — a control that cannot be operated, dressed as
              one that can. */}
          <Field label="Ngôn ngữ">
            <ReadOnlyValue>Tiếng Việt</ReadOnlyValue>
          </Field>
          <Field label="Múi giờ">
            <ReadOnlyValue>{settings.timezone}</ReadOnlyValue>
          </Field>
          <p className="text-[14px] text-meta">
            Hệ thống hiện chỉ hỗ trợ tiếng Việt và múi giờ Việt Nam.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
