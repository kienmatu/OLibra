import Link from "next/link";
import { AlertOctagon, Archive, Plus } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SavedNotice } from "@/components/ui/saved-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import { PHONE_PATTERN } from "@/domain/members/policy";
import type { PolicyField } from "@/domain/admin/policy";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { getAdminOverview } from "@/domain/admin/queries/get-admin-overview";
import { countPendingManagerChanges } from "@/domain/admin/queries/get-pending-manager-changes";
import {
  getShelfSettings,
  type LendingPolicy,
} from "@/domain/shelf/queries/get-shelf-settings";
import { loadAdminPage } from "@/lib/page-data";
import {
  ACTION_DONE_PARAM,
  ACTION_SCOPE_PARAM,
  param,
  refusalFrom,
  type SearchParams,
} from "@/lib/search-params";
import {
  archiveBookshelfAction,
  createBookshelfAction,
  updateBookshelfPolicyAction,
  updateBookshelfProfileAction,
} from "../admin-actions";
import { BOOKSHELF_FORM_SCOPE } from "./form-scope";
import { EDITABLE_POLICY_FIELDS } from "./policy-fields";

/**
 * Label, form-field id, and bound for each of `EDITABLE_POLICY_FIELDS` —
 * paired with `PolicyField` rather than declared as a bare array so that
 * TypeScript itself refuses a build missing an entry for any field
 * `src/domain/admin/policy.ts`'s `BOUNDS` table adds later.
 *
 * The `min`/`max` pair mirrors `checkPolicyBound`'s table exactly, per QA
 * remediation Task 15's own note further down — this is the "browser refuses
 * first" half, never the only check.
 */
const POLICY_FIELD_META: Record<
  PolicyField,
  {
    id: string;
    label: string;
    min: number;
    max: number;
    read: (policy: LendingPolicy) => number;
  }
> = {
  loan_days: {
    id: "so-ngay-muon",
    label: "Số ngày cho mượn",
    min: 1,
    max: 365,
    read: (p) => p.loanDays,
  },
  max_concurrent_loans: {
    id: "so-sach-cung-luc",
    label: "Số sách mượn cùng lúc",
    min: 1,
    max: 50,
    read: (p) => p.maxConcurrentLoans,
  },
  max_renewals: {
    id: "so-lan-gia-han",
    label: "Số lần gia hạn",
    // The one field whose floor is 0, not 1 — "no renewals" is a real policy
    // (BR §5.5), not the defect QA remediation Task 15 closed.
    min: 0,
    max: 10,
    read: (p) => p.maxRenewals,
  },
  renewal_days: {
    id: "so-ngay-gia-han",
    label: "Số ngày mỗi lần gia hạn",
    min: 1,
    max: 365,
    read: (p) => p.renewalDays,
  },
  hold_days: {
    id: "so-ngay-giu-cho",
    label: "Số ngày giữ chỗ",
    min: 1,
    max: 30,
    read: (p) => p.holdDays,
  },
  // QA remediation Task 23: `due_soon_days` was displayed on `/quan-ly/cai-dat`
  // ("Báo sắp đến hạn trước") with no form anywhere that could change it. Its
  // floor is 0, the same exception `max_renewals` gets above — warning on the
  // due date itself is a real policy, not the shape of Task 15's defect.
  due_soon_days: {
    id: "so-ngay-bao-truoc",
    label: "Báo sắp đến hạn trước",
    min: 0,
    max: 30,
    read: (p) => p.dueSoonDays,
  },
};

/**
 * OPS §3.4's `GetBookshelvesList` and `GetBookshelfSettings`, with §4.5's three
 * commands behind them.
 *
 * **A list, and one shelf's editor when `?tu-sach=` names one.** The shipped
 * screen was a settings form with no way to choose whose settings it was: it
 * rendered one fixture shelf's fields and a "Lưu trữ" button, on a route called
 * *Tủ sách* that is plural. The list is what makes the form's subject a fact
 * about the request rather than about the file.
 *
 * **`getShelfSettings` is reused rather than a second admin query written.**
 * OPS lists `GetBookshelfSettings` separately because its *caller* differs, but
 * the rows are the same rows, and two queries over one table is how the manager's
 * read-only view and the administrator's editor come to disagree about what a
 * shelf's loan period is. It is called through `loadAdminPage`, whose context
 * carries no shelf — so the id is passed explicitly and the `where` in that
 * query is what selects the row.
 *
 * **The slug is shown and cannot be edited.** It is immutable in the database
 * and read-only in OPS §3.4; a shelf's address appears on printed notices and in
 * a parish's bookmarks.
 *
 * **`?tu-sach=` names a slug, not a `bookshelfId` (QA remediation T27).** It
 * used to be the UUID — a stable key, since a shelf's id never changes
 * either, but not one an administrator can read, type or recognise on sight,
 * and not what the summary line under each shelf's name showed either
 * (`/{slug}`, not the shelf's own address). The slug is exactly as stable —
 * `20260808_02_bookshelf_slug_immutable.sql` is what makes it a legitimate
 * key at all, the same guarantee `resolveShelfId` (`src/auth/guards.ts`)
 * already leans on — and it is the one thing on this page a person could
 * actually recognise in the address bar. `updateBookshelfProfileAction` and
 * `updateBookshelfPolicyAction` both still receive the real id (a hidden
 * field, `selected.row.bookshelfId`, never in a URL): only the query string
 * that names *which* shelf's editor to open changed, not what
 * `updateBookshelfSettings` is called with.
 *
 * **The identity/contacts form and the lending-policy form are two `<form>`s,
 * not one (Fix round 2).** They used to be a single form that always posted a
 * `profile` — contacts included — alongside the policy numbers, so a shelf the
 * migration deliberately left with no contact rows (its own note: "inventing
 * a volunteer is worse than an incomplete record") could not change its loan
 * period without a super admin first naming somebody, because contact 1 is
 * mandatory and every save carried the whole form. Splitting the `<form>` is
 * what makes `updateBookshelfPolicyAction` free of `profile` entirely, so a
 * policy-only save never trips `contact_position_1_required`. Each keeps its
 * own `ACTION_SCOPE_PARAM` scope (`BOOKSHELF_FORM_SCOPE.profile` /
 * `.policy`, `./form-scope.ts`) on both the success and the refusal
 * redirect, so a refusal from one form never renders beside the other's
 * fields — see `admin-actions.ts`'s `back()` for where that scope is
 * attached.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Tủ sách — Quản trị OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

export default async function AdminBookshelvesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const selectedSlug = param(search, "tu-sach") ?? null;
  const refusal = refusalFrom(search);
  // Fix round 2: which of the two forms below a refusal or a save belongs to
  // — `admin-actions.ts`'s `back()` writes the identical value
  // (`BOOKSHELF_FORM_SCOPE.profile` / `.policy`) as the refusal's
  // `ACTION_SCOPE_PARAM` and as the success `ACTION_DONE_PARAM` value, so
  // each form reads one field to answer both "did I just fail?" and "did I
  // just succeed?" without the other form's result leaking into it.
  // `createBookshelfAction`'s own refusal carries neither param.
  const doneValue = param(search, ACTION_DONE_PARAM);
  const refusalScope = param(search, ACTION_SCOPE_PARAM);
  const profileRefusal =
    refusalScope === BOOKSHELF_FORM_SCOPE.profile ? refusal : null;
  const profileSaved = doneValue === BOOKSHELF_FORM_SCOPE.profile;
  const policyRefusal =
    refusalScope === BOOKSHELF_FORM_SCOPE.policy ? refusal : null;
  const policySaved = doneValue === BOOKSHELF_FORM_SCOPE.policy;
  // Neither form above claims this refusal — either it is
  // `createBookshelfAction`'s own (no scope at all, the ordinary case), or
  // `refusalScope` names something that is not a `BookshelfFormScope` at all
  // (a hand-edited `?pham-vi=`). Both fall back to the banner below rather
  // than vanishing: a refusal that matches no known scope must still render
  // *somewhere*, not nowhere.
  const unscopedRefusal =
    refusalScope !== BOOKSHELF_FORM_SCOPE.profile &&
    refusalScope !== BOOKSHELF_FORM_SCOPE.policy
      ? refusal
      : null;

  const { viewer, unreadFeedback, pendingManagerChanges, shelves, selected } =
    await loadAdminPage(async (tx, ctx, v) => {
      const shelves = await getAdminOverview(tx, ctx);
      const named = shelves.find((s) => s.slug === selectedSlug) ?? null;
      return {
        viewer: v,
        unreadFeedback: await countUnreadFeedback(tx, ctx),
        pendingManagerChanges: await countPendingManagerChanges(tx, ctx),
        shelves,
        // Read only when the id names a shelf this administrator just listed —
        // so a `?tu-sach=` naming nothing renders the list rather than a 404 or
        // an empty form.
        selected: named
          ? {
              row: named,
              settings: await getShelfSettings(tx, {
                ...ctx,
                bookshelfId: named.bookshelfId,
              }),
            }
          : null,
      };
    });

  return (
    <AdminShell
      active="tu-sach"
      viewer={viewer}
      counts={{ unreadFeedback, pendingManagerChanges }}
    >
      <PageHeading
        title="Tủ sách"
        subtitle={`${NUMBER.format(shelves.length)} tủ sách trong hệ thống.`}
      />

      {/* Not conditioned on `selected` — it renders whenever a refusal
          matches neither form's scope below, which in the ordinary case is
          `createBookshelfAction`'s own refusal (no `ACTION_SCOPE_PARAM` at
          all, and `selected` is null because that action never redirects
          with `?tu-sach=`) and, as a fallback rather than a silent swallow,
          any refusal whose `ACTION_SCOPE_PARAM` names something that is not
          a `BookshelfFormScope` — a hand-edited URL, since neither form ever
          writes one. */}
      {unscopedRefusal ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
          {messageFor(unscopedRefusal)}
        </p>
      ) : null}

      <ul className="mt-8 divide-y divide-hairline rounded-card border border-hairline">
        {shelves.map((shelf) => (
          <li
            key={shelf.bookshelfId}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <Link
                href={`/quan-tri/tu-sach?tu-sach=${encodeURIComponent(shelf.slug)}`}
                className="text-[16px] font-medium hover:underline"
              >
                {shelf.name}
              </Link>
              <p className="text-[14px] text-meta">
                /tu-sach/{shelf.slug} · {NUMBER.format(shelf.books)} đầu sách ·{" "}
                {NUMBER.format(shelf.readers)} bạn đọc
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {shelf.hasContacts ? null : (
                <Pill
                  icon={AlertOctagon}
                  label="Chưa có người liên hệ"
                  tone="overdue"
                />
              )}
              {shelf.status === "active" ? null : (
                <Pill icon={Archive} label="Đã lưu trữ" tone="retired" />
              )}
            </div>
          </li>
        ))}
      </ul>

      {selected === null ? (
        <details className="mt-10 max-w-2xl">
          <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control bg-terracotta px-5 text-[16px] font-semibold text-white [&::-webkit-details-marker]:hidden">
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            Mở tủ sách mới
          </summary>
          <form
            action={createBookshelfAction}
            className="mt-4 space-y-6 rounded-card border border-hairline bg-surface p-5"
          >
            <Field label="Tên tủ sách" required htmlFor="ten-moi">
              <Input id="ten-moi" name="ten" required />
            </Field>
            <Field
              label="Đường dẫn"
              htmlFor="dia-chi-web"
              hint="Để trống thì hệ thống tự đặt theo tên. Không đổi được về sau."
            >
              <Input
                id="dia-chi-web"
                name="dia-chi-web"
                placeholder="vd: vinh-long"
              />
            </Field>
            <Field label="Địa điểm" htmlFor="dia-diem-moi">
              <Input id="dia-diem-moi" name="dia-diem" placeholder="vd: Nhà xứ" />
            </Field>
            <Field label="Địa chỉ" htmlFor="dia-chi-moi">
              <Input id="dia-chi-moi" name="dia-chi" />
            </Field>
            <fieldset className="space-y-6 border-t border-hairline pt-6">
              <legend className="text-[16px] font-semibold">Người liên hệ</legend>
              <p className="text-[14px] text-meta">
                Người liên hệ thứ nhất là bắt buộc. Hai người sau có thể để trống.
              </p>

              <Field
                label="Họ tên người liên hệ 1"
                required
                htmlFor="lien-he-1-ten-moi"
              >
                <Input id="lien-he-1-ten-moi" name="lien-he-1-ten" required />
              </Field>
              <Field
                label="Số điện thoại người liên hệ 1"
                htmlFor="lien-he-1-sdt-moi"
              >
                <Input
                  id="lien-he-1-sdt-moi"
                  name="lien-he-1-sdt"
                  type="tel"
                  inputMode="numeric"
                  pattern={PHONE_PATTERN}
                />
              </Field>
              <Field
                label="Vai trò người liên hệ 1"
                htmlFor="lien-he-1-vai-tro-moi"
              >
                <Input
                  id="lien-he-1-vai-tro-moi"
                  name="lien-he-1-vai-tro"
                  placeholder="Người giữ chìa khoá"
                />
              </Field>

              <Field label="Họ tên người liên hệ 2" htmlFor="lien-he-2-ten-moi">
                <Input id="lien-he-2-ten-moi" name="lien-he-2-ten" />
              </Field>
              <Field
                label="Số điện thoại người liên hệ 2"
                htmlFor="lien-he-2-sdt-moi"
              >
                <Input
                  id="lien-he-2-sdt-moi"
                  name="lien-he-2-sdt"
                  type="tel"
                  inputMode="numeric"
                  pattern={PHONE_PATTERN}
                />
              </Field>
              <Field
                label="Vai trò người liên hệ 2"
                htmlFor="lien-he-2-vai-tro-moi"
              >
                <Input
                  id="lien-he-2-vai-tro-moi"
                  name="lien-he-2-vai-tro"
                  placeholder="Quản lý tủ sách"
                />
              </Field>

              <Field label="Họ tên người liên hệ 3" htmlFor="lien-he-3-ten-moi">
                <Input id="lien-he-3-ten-moi" name="lien-he-3-ten" />
              </Field>
              <Field
                label="Số điện thoại người liên hệ 3"
                htmlFor="lien-he-3-sdt-moi"
              >
                <Input
                  id="lien-he-3-sdt-moi"
                  name="lien-he-3-sdt"
                  type="tel"
                  inputMode="numeric"
                  pattern={PHONE_PATTERN}
                />
              </Field>
              <Field
                label="Vai trò người liên hệ 3"
                htmlFor="lien-he-3-vai-tro-moi"
              >
                <Input id="lien-he-3-vai-tro-moi" name="lien-he-3-vai-tro" />
              </Field>
            </fieldset>
            <p className="text-[14px] text-meta">
              Tủ sách mới nhận quy định cho mượn mặc định của hệ thống. Sửa lại được
              sau.
            </p>
            <SubmitButton variant="primary" size="lg">
              Mở tủ sách
            </SubmitButton>
          </form>
        </details>
      ) : (
        <div className="mt-10 max-w-2xl">
          <Link href="/quan-tri/tu-sach" className="text-[14px] underline">
            ← Về danh sách tủ sách
          </Link>

          {/* Fix round 2: identity + contacts, and lending policy, are two
              independent forms now — each with its own submit, its own
              refusal rendered beside its own fields, and its own success
              notice — so a policy save never carries a `profile` (contacts
              included) and never trips `contact_position_1_required` for a
              shelf the migration deliberately left with none. See this
              page's own docstring above and `admin-actions.ts`'s two actions
              for the reasoning. */}
          <form action={updateBookshelfProfileAction} className="mt-6 space-y-12">
            <input type="hidden" name="tu-sach" value={selected.row.bookshelfId} />
            {/* QA remediation T27: the id above is what `updateBookshelfSettings`
                needs to find the row — that has not changed. This is what
                `updateBookshelfProfileAction` redirects back to afterwards,
                now that `?tu-sach=` on this page names a slug rather than the
                id; the slug cannot change mid-request (it is immutable), so
                carrying it as a second hidden field is exactly as reliable as
                the id was for that purpose. */}
            <input
              type="hidden"
              name="tu-sach-slug"
              value={selected.settings.profile.slug}
            />

            {profileRefusal ? (
              <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
                {messageFor(profileRefusal)}
              </p>
            ) : null}
            {profileSaved ? (
              <SavedNotice>Đã lưu thông tin tủ sách.</SavedNotice>
            ) : null}

            <section className="space-y-6">
              <h2 className="text-xl font-semibold">Thông tin chung</h2>

              <Field label="Tên tủ sách" required htmlFor="ten">
                <Input
                  id="ten"
                  name="ten"
                  required
                  defaultValue={selected.settings.profile.name}
                />
              </Field>

              <Field label="Đường dẫn">
                <ReadOnlyValue>
                  /tu-sach/{selected.settings.profile.slug}
                </ReadOnlyValue>
              </Field>

              <Field label="Địa điểm" htmlFor="dia-diem">
                <Input
                  id="dia-diem"
                  name="dia-diem"
                  defaultValue={selected.settings.profile.location ?? ""}
                />
              </Field>

              {/* QA remediation Task 22. Until this task, no screen rendered
                  `address` at all — `getShelfSettings`'s own docstring said so
                  in as many words, and the field existed here only because
                  `updateBookshelfSettings` writes the whole profile in one
                  statement, so a form that omitted it would clear it on every
                  save. It is now rendered on the shelf's own home page
                  (`src/app/tu-sach/[shelf]/page.tsx`, "Địa chỉ", below "Địa
                  điểm") and correctly labelled on `/quan-ly/cai-dat`, which
                  used to show *this* field's sibling, `location`, under this
                  same label. */}
              <Field label="Địa chỉ" htmlFor="dia-chi">
                <Input
                  id="dia-chi"
                  name="dia-chi"
                  defaultValue={selected.settings.profile.address ?? ""}
                />
              </Field>
            </section>

            <section className="space-y-6 border-t border-hairline pt-10">
              <h2 className="text-xl font-semibold">Người liên hệ</h2>
              <p className="text-[14px] text-meta">
                Người liên hệ thứ nhất là bắt buộc. Hai người sau có thể để trống.
              </p>

              {[1, 2, 3].map((position) => {
                const contact = selected.settings.profile.contacts.find(
                  (c) => c.position === position,
                );
                return (
                  <div key={position} className="space-y-6">
                    <Field
                      label={`Họ tên người liên hệ ${position}`}
                      required={position === 1}
                      htmlFor={`lien-he-${position}-ten`}
                    >
                      <Input
                        id={`lien-he-${position}-ten`}
                        name={`lien-he-${position}-ten`}
                        required={position === 1}
                        defaultValue={contact?.name ?? ""}
                      />
                    </Field>
                    <Field
                      label={`Số điện thoại người liên hệ ${position}`}
                      htmlFor={`lien-he-${position}-sdt`}
                    >
                      <Input
                        id={`lien-he-${position}-sdt`}
                        name={`lien-he-${position}-sdt`}
                        type="tel"
                        inputMode="numeric"
                        pattern={PHONE_PATTERN}
                        defaultValue={contact?.phone ?? ""}
                      />
                    </Field>
                    <Field
                      label={`Vai trò người liên hệ ${position}`}
                      htmlFor={`lien-he-${position}-vai-tro`}
                    >
                      <Input
                        id={`lien-he-${position}-vai-tro`}
                        name={`lien-he-${position}-vai-tro`}
                        placeholder={
                          position === 1 ? "Người giữ chìa khoá" : undefined
                        }
                        defaultValue={contact?.roleLabel ?? ""}
                      />
                    </Field>
                  </div>
                );
              })}
            </section>

            <div className="border-t border-hairline pt-10">
              <SubmitButton variant="outline" size="lg">
                Lưu thông tin tủ sách
              </SubmitButton>
            </div>
          </form>

          {/* A second, independent `<form>` — see the note above the first
              one. `variant="outline"` above and `variant="primary"` below are
              a deliberate choice, not a default: BR §17/AGENTS.md's "one
              primary action per screen" means solid terracotta may appear
              only once here, and the lending policy — the save this whole fix
              is about freeing from the contact rule — is the one that keeps
              it. */}
          <form
            action={updateBookshelfPolicyAction}
            className="mt-12 space-y-12 border-t border-hairline pt-12"
          >
            <input type="hidden" name="tu-sach" value={selected.row.bookshelfId} />
            <input
              type="hidden"
              name="tu-sach-slug"
              value={selected.settings.profile.slug}
            />

            {policyRefusal ? (
              <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
                {messageFor(policyRefusal)}
              </p>
            ) : null}
            {policySaved ? (
              <SavedNotice>Đã lưu quy định cho mượn.</SavedNotice>
            ) : null}

            <section className="space-y-6">
              <h2 className="text-xl font-semibold">Quy định cho mượn</h2>
              <p className="text-[15px] text-meta">
                Áp dụng ngay cho tủ sách này. Quản lý tủ sách xem được nhưng không
                sửa được.
              </p>

              {/* QA remediation Task 15: `min={0}` and no `max` at all is what
                  let "Số ngày cho mượn" take `0` and save silently — every
                  loan from that shelf would then fall due the day it was
                  made. Each field's own `min`/`max` (in `POLICY_FIELD_META`
                  above) mirrors `checkPolicyBound`'s table
                  (`src/domain/admin/policy.ts`) exactly, so the browser
                  refuses first and the domain is the backstop it was already
                  meant to be — never the only check, since a number box's
                  `min`/`max` is trivially bypassed by anyone editing the
                  request by hand.

                  Mapped from `EDITABLE_POLICY_FIELDS` (`./policy-fields.ts`)
                  rather than a literal array here (QA remediation Task 23):
                  that file is what `tests/architecture/
                  every-shown-policy-is-editable.test.ts` compares against
                  `/quan-ly/cai-dat`'s own field list, and the comparison is
                  only honest if this is the array actually driving the
                  form. */}
              {EDITABLE_POLICY_FIELDS.map((field) => {
                const meta = POLICY_FIELD_META[field];
                return (
                  <Field key={field} label={meta.label} required htmlFor={meta.id}>
                    <Input
                      id={meta.id}
                      name={meta.id}
                      type="number"
                      min={meta.min}
                      max={meta.max}
                      required
                      defaultValue={meta.read(selected.settings.policy)}
                    />
                  </Field>
                );
              })}
            </section>

            <section className="space-y-4 border-t border-hairline pt-10">
              <h2 className="text-xl font-semibold">Bình luận</h2>
              <label className="flex items-center gap-3 text-[16px]">
                <input
                  type="checkbox"
                  name="cho-binh-luan"
                  className="size-5"
                  defaultChecked={selected.settings.policy.commentsEnabled}
                />
                Cho phép bạn đọc bình luận
              </label>
              <label className="flex items-center gap-3 text-[16px]">
                <input
                  type="checkbox"
                  name="binh-luan-can-duyet"
                  className="size-5"
                  defaultChecked={selected.settings.policy.commentsRequireApproval}
                />
                Bình luận cần quản lý duyệt trước khi hiển thị
              </label>
            </section>

            <div className="border-t border-hairline pt-10">
              <SubmitButton variant="primary" size="lg">
                Lưu quy định cho mượn
              </SubmitButton>
            </div>
          </form>

          {selected.row.status === "active" ? (
            <details className="mt-10 border-t border-hairline pt-10">
              <summary className="cursor-pointer list-none text-[15px] font-medium text-brick underline [&::-webkit-details-marker]:hidden">
                Lưu trữ tủ sách này
              </summary>
              <form action={archiveBookshelfAction} className="mt-3 space-y-3">
                <input
                  type="hidden"
                  name="tu-sach"
                  value={selected.row.bookshelfId}
                />
                <p className="max-w-md text-[15px] text-meta">
                  Lưu trữ sẽ ẩn tủ sách khỏi cổng, nhưng giữ lại toàn bộ dữ liệu và
                  lịch sử. Sau khi lưu trữ, không ai vào được tủ sách này bằng đường
                  dẫn — kể cả quản lý của tủ sách.
                </p>
                <SubmitButton variant="danger" size="md">
                  Xác nhận lưu trữ
                </SubmitButton>
              </form>
            </details>
          ) : null}
        </div>
      )}
    </AdminShell>
  );
}
