import Link from "next/link";
import { Archive, Plus } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, ReadOnlyValue } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SavedNotice } from "@/components/ui/saved-notice";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { getAdminOverview } from "@/domain/admin/queries/get-admin-overview";
import { getShelfSettings } from "@/domain/shelf/queries/get-shelf-settings";
import { loadAdminPage } from "@/lib/page-data";
import {
  ACTION_DONE_PARAM,
  param,
  refusalFrom,
  type SearchParams,
} from "@/lib/search-params";
import {
  archiveBookshelfAction,
  createBookshelfAction,
  updateBookshelfSettingsAction,
} from "../admin-actions";

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
  const selectedId = param(search, "tu-sach") ?? null;
  const refusal = refusalFrom(search);
  // QA remediation Task 16: `updateBookshelfSettingsAction` now marks its own
  // success (`admin-actions.ts`'s `back(..., true)`). A bare presence check,
  // like `/gop-y`'s own `da-gui`, rather than reading a value — this page has
  // exactly one thing behind `?tu-sach=` that could just have been saved.
  const saved = param(search, ACTION_DONE_PARAM) === "1";

  const { viewer, unreadFeedback, shelves, selected } = await loadAdminPage(
    async (tx, ctx, v) => {
      const shelves = await getAdminOverview(tx, ctx);
      const named = shelves.find((s) => s.bookshelfId === selectedId) ?? null;
      return {
        viewer: v,
        unreadFeedback: await countUnreadFeedback(tx, ctx),
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
    },
  );

  return (
    <AdminShell active="tu-sach" viewer={viewer} unreadFeedback={unreadFeedback}>
      <PageHeading
        title="Tủ sách"
        subtitle={`${NUMBER.format(shelves.length)} tủ sách trong hệ thống.`}
      />

      {refusal ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
          {messageFor(refusal)}
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
                href={`/quan-tri/tu-sach?tu-sach=${shelf.bookshelfId}`}
                className="text-[16px] font-medium hover:underline"
              >
                {shelf.name}
              </Link>
              <p className="text-[14px] text-meta">
                /{shelf.slug} · {NUMBER.format(shelf.books)} đầu sách ·{" "}
                {NUMBER.format(shelf.readers)} bạn đọc
              </p>
            </div>
            {shelf.status === "active" ? null : (
              <Pill icon={Archive} label="Đã lưu trữ" tone="retired" />
            )}
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
            <Field label="Người giữ chìa khoá" htmlFor="nguoi-giu-moi">
              <Input id="nguoi-giu-moi" name="nguoi-giu" />
            </Field>
            <Field label="Số điện thoại" htmlFor="dien-thoai-moi">
              <Input
                id="dien-thoai-moi"
                name="dien-thoai"
                type="tel"
                inputMode="numeric"
                pattern={PHONE_PATTERN}
              />
            </Field>
            <Field label="Giờ mở cửa" htmlFor="gio-mo-cua-moi">
              <Input
                id="gio-mo-cua-moi"
                name="gio-mo-cua"
                placeholder="vd: Sau lễ Chúa nhật"
              />
            </Field>
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

          {saved ? <SavedNotice>Đã lưu cài đặt.</SavedNotice> : null}

          <form action={updateBookshelfSettingsAction} className="mt-6 space-y-12">
            <input type="hidden" name="tu-sach" value={selected.row.bookshelfId} />

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
                <ReadOnlyValue>/{selected.settings.profile.slug}</ReadOnlyValue>
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

              <Field label="Người giữ chìa khoá" htmlFor="nguoi-giu">
                <Input
                  id="nguoi-giu"
                  name="nguoi-giu"
                  defaultValue={selected.settings.profile.keeperName ?? ""}
                />
              </Field>

              <Field
                label="Số điện thoại"
                htmlFor="dien-thoai"
                hint="Hiện công khai trên trang tủ sách và bấm gọi được."
              >
                <Input
                  id="dien-thoai"
                  name="dien-thoai"
                  type="tel"
                  inputMode="numeric"
                  pattern={PHONE_PATTERN}
                  defaultValue={selected.settings.profile.keeperPhone ?? ""}
                />
              </Field>

              <Field label="Giờ mở cửa" htmlFor="gio-mo-cua">
                <Input
                  id="gio-mo-cua"
                  name="gio-mo-cua"
                  defaultValue={selected.settings.profile.openingHours ?? ""}
                />
              </Field>
            </section>

            <section className="space-y-6 border-t border-hairline pt-10">
              <h2 className="text-xl font-semibold">Quy định cho mượn</h2>
              <p className="text-[15px] text-meta">
                Áp dụng ngay cho tủ sách này. Quản lý tủ sách xem được nhưng không
                sửa được.
              </p>

              {/* QA remediation Task 15: `min={0}` and no `max` at all is what
                  let "Số ngày cho mượn" take `0` and save silently — every
                  loan from that shelf would then fall due the day it was
                  made. Each field's own `min`/`max` here mirrors
                  `checkPolicyBound`'s table (`src/domain/admin/policy.ts`)
                  exactly, so the browser refuses first and the domain is the
                  backstop it was already meant to be — never the only
                  check, since a number box's `min`/`max` is trivially
                  bypassed by anyone editing the request by hand. */}
              {[
                {
                  id: "so-ngay-muon",
                  label: "Số ngày cho mượn",
                  value: selected.settings.policy.loanDays,
                  min: 1,
                  max: 365,
                },
                {
                  id: "so-sach-cung-luc",
                  label: "Số sách mượn cùng lúc",
                  value: selected.settings.policy.maxConcurrentLoans,
                  min: 1,
                  max: 50,
                },
                {
                  id: "so-lan-gia-han",
                  label: "Số lần gia hạn",
                  value: selected.settings.policy.maxRenewals,
                  // The one field whose floor is 0, not 1 — "no renewals" is
                  // a real policy (BR §5.5), not the defect this task closes.
                  min: 0,
                  max: 10,
                },
                {
                  id: "so-ngay-gia-han",
                  label: "Số ngày mỗi lần gia hạn",
                  value: selected.settings.policy.renewalDays,
                  min: 1,
                  max: 365,
                },
                {
                  id: "so-ngay-giu-cho",
                  label: "Số ngày giữ chỗ",
                  value: selected.settings.policy.holdDays,
                  min: 1,
                  max: 30,
                },
              ].map((f) => (
                <Field key={f.id} label={f.label} required htmlFor={f.id}>
                  <Input
                    id={f.id}
                    name={f.id}
                    type="number"
                    min={f.min}
                    max={f.max}
                    required
                    defaultValue={f.value}
                  />
                </Field>
              ))}
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
                Lưu cài đặt
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
