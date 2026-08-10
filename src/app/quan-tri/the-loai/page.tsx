import { Plus } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { getCategoriesAdmin } from "@/domain/catalogue/queries/get-categories-admin";
import { loadAdminPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import {
  archiveCategoryAction,
  createCategoryAction,
  renameCategoryAction,
} from "../admin-actions";

/**
 * Task 2 (QA remediation) — the screen `categories` never had.
 *
 * OPS never named a `GetCategoriesAdmin`/`CreateCategory` pair because
 * `categories` shipped as reference data seeded once by `src/db/seed.ts` and
 * never meant to be edited from the running application. That held on every
 * machine that ever ran the seed script and broke completely on one that
 * had not: a fresh install has an empty table, "Thể loại" on "Thêm sách mới"
 * is `required`, and there was no form anywhere that could ever fill it in.
 * `src/app/tu-sach/[shelf]/quan-ly/sach/moi/page.tsx`'s own docstring already
 * names `readCategoryOptions` as reading "every global category", so this
 * screen needs nothing else wired for a category created here to show up
 * there the next time that page renders — `dynamic = "force-dynamic"` on
 * both is what makes "the next time" mean the very next request.
 *
 * **Modelled on `../tu-sach/page.tsx`** — the closest existing sibling, also a
 * global, cross-shelf administration list with a `<details>` disclosure for
 * "create" and a per-row `<details>` for the destructive action.
 * `../quan-ly-vien/page.tsx` supplies the per-row pattern for a second,
 * *non*-destructive action (there, "promote"; here, "rename") sitting beside
 * it in the same row.
 *
 * **No edit for the slug**, for the reason `create-category.ts` and
 * `rename-category.ts` both give: it is an internal handle
 * (`create-book.ts`'s `categorySlug` field posts it, not a name and not an
 * id), and moving it would silently repoint every book already catalogued
 * under the old one.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Thể loại — Quản trị OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

export default async function AdminCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const refusal = refusalFrom(await searchParams);

  const { viewer, unreadFeedback, categories } = await loadAdminPage(
    async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      categories: await getCategoriesAdmin(tx, ctx),
    }),
  );

  return (
    <AdminShell active="the-loai" viewer={viewer} unreadFeedback={unreadFeedback}>
      <PageHeading
        title="Thể loại"
        subtitle={`${NUMBER.format(categories.length)} thể loại trong hệ thống.`}
      />

      {refusal ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
          {messageFor(refusal)}
        </p>
      ) : null}

      <ul className="mt-8 divide-y divide-hairline rounded-card border border-hairline">
        {categories.map((category) => (
          <li key={category.id} className="p-4">
            <div className="min-w-0">
              <p className="text-[16px] font-medium">{category.name}</p>
              <p className="text-[14px] text-meta">
                /{category.slug} · {NUMBER.format(category.bookCount)} đầu sách
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-5">
              <details>
                <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
                  Đổi tên
                </summary>
                <form
                  action={renameCategoryAction}
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="the-loai" value={category.id} />
                  <Field label="Tên mới" required htmlFor={`ten-${category.id}`}>
                    <Input
                      id={`ten-${category.id}`}
                      name="ten"
                      required
                      defaultValue={category.name}
                      className="max-w-64"
                    />
                  </Field>
                  <SubmitButton variant="quiet" size="sm">
                    Lưu tên
                  </SubmitButton>
                </form>
              </details>

              <details>
                <summary className="cursor-pointer list-none text-[14px] text-brick underline [&::-webkit-details-marker]:hidden">
                  Lưu trữ thể loại này
                </summary>
                <form action={archiveCategoryAction} className="mt-3 space-y-3">
                  <input type="hidden" name="the-loai" value={category.id} />
                  <p className="max-w-md text-[14px] text-meta">
                    Chỉ lưu trữ được khi không còn sách nào thuộc thể loại này. Đổi
                    thể loại cho những cuốn sách đó trước nếu cần.
                  </p>
                  <SubmitButton variant="danger" size="sm">
                    Xác nhận lưu trữ
                  </SubmitButton>
                </form>
              </details>
            </div>
          </li>
        ))}
      </ul>

      {categories.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">Chưa có thể loại nào.</p>
      ) : null}

      <details className="mt-10 max-w-2xl">
        <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control bg-terracotta px-5 text-[16px] font-semibold text-white [&::-webkit-details-marker]:hidden">
          <Plus aria-hidden className="size-5" strokeWidth={1.75} />
          Thêm thể loại mới
        </summary>
        <form
          action={createCategoryAction}
          className="mt-4 space-y-6 rounded-card border border-hairline bg-surface p-5"
        >
          <Field label="Tên thể loại" required htmlFor="ten-moi">
            <Input
              id="ten-moi"
              name="ten"
              required
              placeholder="vd: Truyện tranh"
            />
          </Field>
          <SubmitButton variant="primary" size="lg">
            Thêm thể loại
          </SubmitButton>
        </form>
      </details>
    </AdminShell>
  );
}
