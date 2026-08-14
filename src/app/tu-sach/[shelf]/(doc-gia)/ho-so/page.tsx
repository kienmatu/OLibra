import { Camera, KeyRound, Lock } from "lucide-react";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PhoneConfirmDialog } from "@/components/phone-confirm-dialog";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { NotAReaderNotice } from "@/components/shell/reader-not-a-member";
import { messageFor } from "@/domain/kernel/errors";
import { atLeast } from "@/domain/kernel/tenant";
import { hasVisibleLevel2, unitOptions } from "@/domain/members/parish-taxonomy";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { PROFILE_FIELD_LABELS, proposedFields } from "@/lib/profile-labels";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { loadReaderProfile } from "./load-profile";
import {
  cancelProfileChangeAction,
  changeOwnPasswordAction,
  proposeAvatarAction,
  proposeProfileChangeAction,
} from "./profile-actions";

/**
 * The reader's own profile — BR §2's "changing your own details is a request,
 * not an edit", as a screen.
 *
 * **Two forms, because there are two different rules**, and putting them in
 * one would be the screen claiming they are the same act:
 *
 * - The verified details go through `proposeProfileChange` and wait for a
 *   manager. The current values stay in force meanwhile, which is why the
 *   pending block below says the *old* phone number is still the one being used.
 * - The password is `changeOwnPassword`, immediate: "chỉ là chìa khoá để bạn tự
 *   đăng nhập".
 *
 * The fixture version had both inside one `<form>` with one submit button,
 * which would have proposed a password change to a manager for approval.
 *
 * **The pending block reads whatever the last request was, not only a pending
 * one.** `getMyProfileChangeRequest`'s docstring is the reason: BR §15 lists no
 * notification for a profile-change decision, so revisiting this page is how a
 * reader learns they were refused — and a query that returned only pending rows
 * would make the rejection reason unreachable the moment it was written.
 *
 * **`avatar_object` is not among the fields the form posts.** It is
 * `ProposeAvatarChange`'s, and `proposeProfileChange` narrows it out anyway
 * ("so a caller that sends `avatar_object` gets it dropped rather than quietly
 * bypassing the size and content-type policy").
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Hồ sơ của bạn — OLibra" };

const STATUS_LABEL: Record<string, string> = {
  pending: "Đang chờ quản lý duyệt",
  approved: "Đã được duyệt",
  rejected: "Quản lý chưa duyệt",
  cancelled: "Bạn đã huỷ",
};

export default async function ReaderProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const { shelf, viewer, load } = await loadPage(slug, async (tx, ctx, v) => ({
    shelf: await readShelf(tx, ctx),
    viewer: v,
    // `membershipId` comes from the session, never from the URL: a reader
    // cannot ask for somebody else's profile by editing an address.
    // `requireSelfOrManager` inside the query would refuse it anyway.
    // `loadReaderProfile` (`./load-profile.ts`) is where the branch this
    // page used to skip lives now — see that module's own docstring for the
    // 500 a super admin hit here before it existed.
    load: await loadReaderProfile(tx, ctx),
  }));

  const chrome = (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
        canManage={atLeast(viewer.role, "manager")}
        isSuperAdmin={atLeast(viewer.role, "super_admin")}
      />
      <ReaderTabs shelfSlug={slug} pathname={`/tu-sach/${slug}/ho-so`} />
    </>
  );

  if (!load.member) {
    return (
      <>
        {chrome}
        <NotAReaderNotice />
      </>
    );
  }

  const { profile, taxonomy, units } = load;
  const showL1 = unitOptions(units, 1).length > 0;
  const showL2 = hasVisibleLevel2(taxonomy, units);
  const pending = profile.pendingChange;
  const fields = profile.fields;

  return (
    <>
      {chrome}

      <main className="mx-auto max-w-xl px-6 py-10">
        <PageHeading
          title="Hồ sơ của bạn"
          subtitle="Những thay đổi bạn gửi chỉ có hiệu lực sau khi quản lý duyệt."
        />

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <div className="mt-8 flex items-center gap-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center rounded-full bg-paper text-[26px] font-semibold text-leather">
            {/* The last word of a Vietnamese name is the given name. */}
            {fields.full_name?.split(" ").at(-1)?.charAt(0) ?? ""}
          </div>
          {/* B2b's avatar upload, unchanged. The form posts no identity:
              `proposeAvatarChange` takes the membership from
              `ctx.actor.membershipId`, which is a stronger position than
              posting one and comparing it — there is nothing in the request to
              rewrite. */}
          <form action={proposeAvatarAction}>
            <input type="hidden" name="tu-sach" value={slug} />
            <label className="inline-flex cursor-pointer items-center gap-2 text-[15px] font-medium text-leather">
              <Camera aria-hidden className="size-[18px]" strokeWidth={1.75} />
              Đề nghị đổi ảnh
              <input
                type="file"
                name="anh"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
              />
            </label>
            <p className="mt-1.5 text-[13px] text-meta">
              Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.
            </p>
            <SubmitButton variant="quiet" size="sm" className="mt-2">
              Gửi ảnh
            </SubmitButton>
          </form>
        </div>

        {pending ? (
          <div className="mt-8 rounded-card border border-hairline bg-paper p-4">
            <p className="text-[14px] font-semibold">
              {STATUS_LABEL[pending.status] ?? pending.status}
            </p>
            <ul className="mt-2 space-y-1 text-[14px]">
              {proposedFields(pending.proposedValues).map((f) => (
                <li key={f}>
                  {PROFILE_FIELD_LABELS[f]}:{" "}
                  <span className="font-semibold">
                    {pending.proposedValues[f] ?? "(bỏ trống)"}
                  </span>
                  {pending.previousValues[f] !== undefined ? (
                    <span className="text-meta">
                      {" "}
                      · hiện tại {pending.previousValues[f] ?? "chưa có"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {pending.status === "pending" ? (
              <>
                <p className="mt-2 text-[13px] text-meta">
                  Thông tin hiện tại vẫn được dùng cho đến khi đề nghị này được
                  duyệt.
                </p>
                <form action={cancelProfileChangeAction} className="mt-2">
                  <input type="hidden" name="tu-sach" value={slug} />
                  <input
                    type="hidden"
                    name="thanh-vien"
                    value={profile.membershipId}
                  />
                  <input type="hidden" name="yeu-cau" value={pending.id} />
                  <SubmitButton variant="ghost" size="sm">
                    Huỷ đề nghị
                  </SubmitButton>
                </form>
              </>
            ) : null}
            {/* The whole reason a rejection requires a reason: the reader reads
                it, and this page is the only place they can. */}
            {pending.status === "rejected" && pending.rejectionReason ? (
              <p className="mt-2 text-[14px]">{pending.rejectionReason}</p>
            ) : null}
          </div>
        ) : null}

        <form
          id="ho-so-form"
          action={proposeProfileChangeAction}
          className="mt-10 space-y-6"
        >
          <input type="hidden" name="tu-sach" value={slug} />
          <input type="hidden" name="thanh-vien" value={profile.membershipId} />

          <h2 className="text-xl font-semibold">Thông tin cá nhân</h2>

          <Field label="Tên thánh" required htmlFor="ten-thanh">
            <Input
              id="ten-thanh"
              name="ten-thanh"
              required
              defaultValue={fields.saint_name ?? ""}
            />
          </Field>

          <Field label="Họ và tên" required htmlFor="ho-ten">
            <Input
              id="ho-ten"
              name="ho-ten"
              required
              defaultValue={fields.full_name ?? ""}
            />
          </Field>

          {/* `type="date"`, so the value posted is an ISO `YYYY-MM-DD` and never
              a locale spelling. `02/04/2015` typed into a text box was read as
              4 February by a session whose DateStyle was `ISO, MDY` — the
              defect `assertStorableDate` exists for, and the browser control is
              what keeps it from arising here at all. */}
          <Field label="Ngày sinh" htmlFor="ngay-sinh">
            <Input
              id="ngay-sinh"
              name="ngay-sinh"
              type="date"
              defaultValue={fields.date_of_birth ?? ""}
            />
          </Field>

          <Field label="Tên cha" htmlFor="ten-cha">
            <Input
              id="ten-cha"
              name="ten-cha"
              defaultValue={fields.father_name ?? ""}
            />
          </Field>

          <Field label="Tên mẹ" htmlFor="ten-me">
            <Input
              id="ten-me"
              name="ten-me"
              defaultValue={fields.mother_name ?? ""}
            />
          </Field>

          <Field
            label="Số điện thoại"
            required
            htmlFor="dien-thoai"
            hint={
              fields.phone
                ? "Quản lý dùng số này khi cần nhắc trả sách."
                : "Để trống thì cần ghi lý do bên dưới."
            }
          >
            <Input
              id="dien-thoai"
              name="dien-thoai"
              type="tel"
              inputMode="numeric"
              pattern={PHONE_PATTERN}
              // PO feedback round 1, Task 8: not HTML `required` — see
              // `nguoi-doc/[id]/page.tsx`'s identical note. The real rule is
              // "a phone, or a reason", enforced by `PhoneConfirmDialog` and,
              // on the server, by `proposeProfileChange`'s own
              // `assertPhoneOrReason` call — fired right here, the moment
              // this very form is submitted, not deferred to a manager's
              // later approval. (`approveProfileChange` calls it again on the
              // resulting record, as a second, independent check — see
              // `profile-actions.ts`'s identical note on that call.)
              defaultValue={fields.phone ?? ""}
            />
          </Field>

          {/* PO feedback round 1, Task 8 — see `nguoi-doc/[id]/page.tsx`'s
              identical reasoning: visible and pre-filled whenever this
              reader's own record already has no phone, or a refusal just
              said so; a hidden carrier otherwise. */}
          {!fields.phone || refusal === "thieu-so-dien-thoai" ? (
            <Field
              label="Lý do chưa có số điện thoại"
              required
              htmlFor="ly-do-thieu-sdt"
            >
              {/* Fix round 1: not HTML `required` — see `nguoi-doc/[id]
                  /page.tsx`'s identical note. `ProposeProfileChange`'s
                  `assertPhoneOrReason` is the real check. */}
              <Textarea
                id="ly-do-thieu-sdt"
                name="ly-do-thieu-sdt"
                rows={3}
                defaultValue={fields.phone_missing_reason ?? ""}
              />
            </Field>
          ) : (
            <input
              type="hidden"
              name="ly-do-thieu-sdt"
              defaultValue={fields.phone_missing_reason ?? ""}
            />
          )}

          <Field
            label="Email"
            htmlFor="email"
            hint="Không bắt buộc. Hiện tủ sách chưa gửi email."
          >
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={fields.email ?? ""}
            />
          </Field>

          <div className="border-t border-hairline pt-6">
            <SubmitButton variant="primary" size="lg">
              Gửi đề nghị thay đổi
            </SubmitButton>
            <p className="mt-3 text-[14px] text-meta">
              Quản lý sẽ xem và duyệt trước khi các thông tin cá nhân ở trên đổi
              thành giá trị mới.
            </p>
          </div>
        </form>
        <PhoneConfirmDialog formId="ho-so-form" />

        {showL1 || showL2 ? (
          <section className="mt-10 space-y-4 border-t border-hairline pt-8">
            <h2 className="text-xl font-semibold">Giáo xứ</h2>

            {showL1 ? (
              <Field label={taxonomy.level1Label}>
                <ReadOnlyValue>
                  <Lock
                    aria-hidden
                    className="mr-2 size-4 text-meta"
                    strokeWidth={1.75}
                  />
                  {profile.parishUnitL1Name}
                </ReadOnlyValue>
              </Field>
            ) : null}

            {showL2 ? (
              <Field label={taxonomy.level2Label}>
                <ReadOnlyValue>
                  <Lock
                    aria-hidden
                    className="mr-2 size-4 text-meta"
                    strokeWidth={1.75}
                  />
                  {profile.parishUnitL2Name}
                </ReadOnlyValue>
              </Field>
            ) : null}

            <p className="text-[14px] text-meta">
              Muốn đổi {taxonomy.level1Label.toLowerCase()}
              {showL2 ? ` hoặc ${taxonomy.level2Label.toLowerCase()}` : ""} thì nhờ
              quản lý tủ sách giúp.
            </p>
          </section>
        ) : null}

        <form
          action={changeOwnPasswordAction}
          className="mt-10 space-y-4 border-t border-hairline pt-8"
        >
          <input type="hidden" name="tu-sach" value={slug} />
          <input type="hidden" name="thanh-vien" value={profile.membershipId} />
          <h2 className="text-xl font-semibold">Mật khẩu</h2>
          <p className="text-[14px] text-meta">
            Cũng có hiệu lực ngay — mật khẩu không phải thông tin quản lý xác minh,
            chỉ là chìa khoá để bạn tự đăng nhập.
          </p>

          <Field label="Mật khẩu hiện tại" required htmlFor="mat-khau-cu">
            <Input
              id="mat-khau-cu"
              name="mat-khau-cu"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>

          <Field label="Mật khẩu mới" required htmlFor="mat-khau-moi">
            <Input
              id="mat-khau-moi"
              name="mat-khau-moi"
              type="password"
              required
              autoComplete="new-password"
            />
          </Field>

          <SubmitButton variant="quiet" size="md">
            <KeyRound aria-hidden className="size-5" strokeWidth={1.75} />
            Đổi mật khẩu
          </SubmitButton>

          {/* The fixture named one manager and printed her telephone number on
              every shelf's page. Whom to ask is a fact about the parish that no
              query here answers, so the sentence stops at the true half. */}
          <p className="text-[14px] text-meta">
            Nếu quên mật khẩu, nhắn cho quản lý tủ sách.
          </p>
        </form>

        {/* `formatInstant`, never `formatDate` — the same distinction
            `nguoi-doc/[id]/page.tsx` carries for `approved_at`, and this is
            where getting it wrong actually shipped. `decided_at` is a
            `timestamptz` (`0008_profile_changes.sql:17`) that
            `getMyProfileChangeRequest` hands over as `decided_at::text`, so
            the value is `2026-08-13 12:57:55.697401+00` — an instant, not the
            `YYYY-MM-DD` `formatDate` documents itself for. `formatDate`
            appended `T00:00:00Z` to that, got an Invalid Date, and
            `Intl.DateTimeFormat.format` threw `RangeError` — a 500 on the
            reader's own page, for every reader whose request had been
            decided. `tests/lib/profile-page-shows-a-decided-request.test.tsx`
            renders this paragraph so it cannot come back. */}
        {pending?.decidedAt ? (
          <p className="mt-10 text-[13px] text-meta">
            Đề nghị gần nhất được xử lý ngày {formatInstant(pending.decidedAt)}.
          </p>
        ) : null}
      </main>
    </>
  );
}
