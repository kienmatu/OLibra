import { Check } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import {
  countCommentsByStatus,
  getPendingComments,
  getRecentlyApprovedComments,
} from "@/domain/community/queries/get-comments";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import {
  approveCommentAction,
  hideCommentAction,
  rejectCommentAction,
} from "../actions";

/**
 * BR §16.3's moderation screen — INV-9's gate, with a manager behind it.
 *
 * **INV-9 is not enforced here and must not be.** "A comment is publicly
 * visible only when approved" lives in `getBookComments`' `status = 'approved'`
 * predicate and in the partial index behind it (`0006_community.sql:24`); this
 * page is where a manager *changes* the status, which is a different thing from
 * where the rule is kept. A screen that filtered would be a second definition of
 * visibility that a book page could disagree with.
 *
 * **The counts are queried, not counted from the lists on screen.** The queue
 * below is every pending comment, so `pending` could have been `queue.length` —
 * but *Đã duyệt* is capped at ten and `Đã từ chối` / `Đã ẩn` are not fetched at
 * all, so three of the four chips would have had to be invented or the cap
 * removed. `countCommentsByStatus` answers all four in one statement.
 *
 * **The chips do not filter.** They are the shape of the shipped screen and they
 * report four numbers; making them navigate would mean three more list queries
 * for archives a shelf of a few hundred books does not accumulate. A manager
 * looking for one specific old comment is looking at the book's page.
 */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

export default async function CommentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const { shelf, viewer, counts, queue, approved, byStatus } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      queue: await getPendingComments(tx, ctx),
      approved: await getRecentlyApprovedComments(tx, ctx, { limit: 10 }),
      byStatus: await countCommentsByStatus(tx, ctx),
    }),
  );

  const chips: { label: string; n: number }[] = [
    { label: "Chờ duyệt", n: byStatus.pending },
    { label: "Đã duyệt", n: byStatus.approved },
    { label: "Đã từ chối", n: byStatus.rejected },
    { label: "Đã ẩn", n: byStatus.hidden },
  ];

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="binh-luan"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Bình luận chờ duyệt"
          subtitle={
            queue.length === 0
              ? "Không có bình luận nào đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt."
              : `${NUMBER.format(queue.length)} bình luận đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt.`
          }
        />

        {refusal ? (
          <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2.5 text-[15px] text-meta">
          {chips.map((c) => (
            <span key={c.label} className="rounded-control bg-surface px-3 py-1.5">
              {c.label} ({NUMBER.format(c.n)})
            </span>
          ))}
        </div>

        {queue.map((comment) => (
          <Card key={comment.id} className="space-y-6">
            <div className="rounded-control bg-paper p-3 text-[15px]">
              <span className="text-meta">Bình luận về </span>
              <BookTitle className="text-[16px]">{comment.title}</BookTitle>
            </div>

            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-paper text-[16px] font-semibold text-leather"
              >
                {/* The last word of a Vietnamese name is the given name. */}
                {comment.authorName.split(" ").at(-1)?.charAt(0) ?? ""}
              </span>
              <div>
                <p className="text-[16px] font-medium">{comment.authorName}</p>
                <p className="text-[14px] text-meta">
                  gửi {formatInstant(comment.createdAt)}
                </p>
              </div>
            </div>

            {/* Rendered as text, escaped by React. BR §5.4: comments are plain
                text. The query returns the body raw on purpose — stripping tags
                there would silently rewrite what a child wrote, and
                `inv-09-comment-visibility.test.ts` pins that with a `<script>`
                body. */}
            <p className="text-[19px] leading-relaxed whitespace-pre-line">
              {comment.body}
            </p>

            <div className="flex flex-wrap items-start gap-4 border-t border-hairline pt-6">
              <form action={approveCommentAction}>
                <input type="hidden" name="tu-sach" value={slug} />
                <input type="hidden" name="binh-luan" value={comment.id} />
                <SubmitButton
                  icon={<Check aria-hidden className="size-5" strokeWidth={1.75} />}
                >
                  Duyệt bình luận
                </SubmitButton>
              </form>

              {/* Same `<details>` as the registration queue's reject, for the
                  same reason: the reason is required and asking for it in place
                  keeps the decision on the card being read. */}
              <details className="min-w-0">
                <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-5 text-[16px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
                  Từ chối
                </summary>
                <form
                  action={rejectCommentAction}
                  className="mt-3 w-full max-w-md space-y-3"
                >
                  <input type="hidden" name="tu-sach" value={slug} />
                  <input type="hidden" name="binh-luan" value={comment.id} />
                  <Field
                    label="Lý do từ chối"
                    required
                    htmlFor={`ly-do-${comment.id}`}
                    hint="Bạn đọc sẽ thấy lý do này."
                  >
                    <Input id={`ly-do-${comment.id}`} name="ly-do" required />
                  </Field>
                  <SubmitButton variant="danger" size="md">
                    Xác nhận từ chối
                  </SubmitButton>
                </form>
              </details>
            </div>
          </Card>
        ))}

        <section>
          <h2 className="text-[15px] font-semibold text-meta">Đã duyệt gần đây</h2>
          {approved.length === 0 ? (
            <p className="mt-3 text-[15px] text-meta">Chưa có bình luận nào.</p>
          ) : (
            <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
              {approved.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[14px] font-semibold text-leather"
                  >
                    {c.authorName.split(" ").at(-1)?.charAt(0) ?? ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px]">
                      <span className="font-medium">{c.authorName}</span>{" "}
                      <span className="text-meta">· </span>
                      <BookTitle className="text-[14px]">{c.title}</BookTitle>
                    </p>
                    <p className="line-clamp-1 text-[14px] text-meta">{c.body}</p>
                  </div>
                  {/* The button `hideComment` never had a way to reach. Until
                      this list existed, an approved comment left the queue and
                      nothing could name it again. */}
                  <form action={hideCommentAction} className="shrink-0">
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="binh-luan" value={c.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Ẩn
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ManagerShell>
  );
}
