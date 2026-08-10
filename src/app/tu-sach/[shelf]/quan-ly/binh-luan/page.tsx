import { Check } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FilterChips } from "@/components/ui/filter-chips";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import {
  type CommentStatus,
  countCommentsByStatus,
  getPendingComments,
  getRecentComments,
} from "@/domain/community/queries/get-comments";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
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
 * **The counts are still queried, not counted from the list on screen.**
 * `countCommentsByStatus` answers all four chip numbers in one statement,
 * regardless of which single status this render also fetched a list for — see
 * below for why it is only ever one.
 *
 * **The chips filter now** (Task 14, 2026-08-10 QA remediation), reversing what
 * this docstring said until then: "making them navigate would mean three more
 * list queries for archives a shelf of a few hundred books does not
 * accumulate." That argument was about *browsing* years of decided comments,
 * and it still holds — `getRecentComments` stays capped at ten and unpaged, on
 * purpose, for exactly that reason. What changed is narrower: those four chips
 * were the only navigation this screen had for its own four states, and three
 * of them led nowhere — a manager could approve or reject a *pending* comment
 * and then never see it again short of a query, which is the actual defect the
 * QA sweep filed, not a request for a browsable archive.
 *
 * **Only one list is ever fetched, never four.** `selected` decides whether
 * `loadPage` below calls `getPendingComments` or `getRecentComments`, so a
 * click on a chip costs the one query its own list needs, no more than before
 * this task and no less.
 *
 * **There is no "Tất cả" chip, unlike `nguoi-doc`'s and `thong-bao`'s.** The
 * four statuses partition `comments` and nothing here reads all of them
 * combined without a fifth query this task does not add — a merged list would
 * either lie (silently be one status's list wearing an "every comment" label)
 * or cost exactly what the paragraph above argues against. So an absent or
 * unrecognised `?trang-thai=` resolves to `"pending"` — this screen's own
 * pre-existing default view — rather than to `undefined` the way
 * `statusFromParam` and `announcementStatusFromParam` resolve to "no filter".
 * `commentStatusFromParam` below is the same shape with a concrete fallback in
 * place of an absent one, for that one reason, and it is still the same
 * guarantee the QA sweep checked on the reader list: a hand-typed
 * `?trang-thai=deleted` renders a known, working view rather than a `22P02` or
 * a blank screen.
 *
 * **Rejected and hidden comments render read-only.** Neither status has a
 * command that moves it anywhere else — `rejectComment` only accepts a
 * `pending` row and `hideComment` only an `approved` one — so those two tabs
 * reuse the compact list "Đã duyệt gần đây" always rendered, minus the "Ẩn"
 * button, which stays only where a command exists to back it.
 */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

const STATUS = "trang-thai";

const COMMENT_STATUS_LABEL: Record<CommentStatus, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Đã từ chối",
  hidden: "Đã ẩn",
};

/** The heading above whichever list is showing — was a fixed "Bình luận chờ
 *  duyệt" before this page had more than one list to show. */
const COMMENT_STATUS_TITLE: Record<CommentStatus, string> = {
  pending: "Bình luận chờ duyệt",
  approved: "Bình luận đã duyệt",
  rejected: "Bình luận đã từ chối",
  hidden: "Bình luận đã ẩn",
};

const COMMENT_STATUS_SLUG: Record<CommentStatus, string> = {
  pending: "cho-duyet",
  approved: "da-duyet",
  rejected: "da-tu-choi",
  hidden: "da-an",
};

/** The reverse of `COMMENT_STATUS_SLUG`, derived rather than written a second
 *  time — two hand-written copies is how a slug and the status it names drift
 *  apart. */
const COMMENT_STATUS_PARAM: Record<string, CommentStatus> = Object.fromEntries(
  Object.entries(COMMENT_STATUS_SLUG).map(([status, slug]) => [
    slug,
    status as CommentStatus,
  ]),
);

/**
 * `?trang-thai=` → a status, always one. See this page's own docstring for why
 * the fallback is the concrete `"pending"` rather than `undefined`, unlike
 * `statusFromParam` (`src/lib/membership-status.ts`) and
 * `announcementStatusFromParam` (`../thong-bao/page.tsx`). `Object.hasOwn`, not
 * `in`, for the reason both of those already carry: `in` walks the prototype
 * chain, so `?trang-thai=constructor` would otherwise resolve to a function
 * rather than to the safe default.
 */
function commentStatusFromParam(raw: string | undefined): CommentStatus {
  if (raw !== undefined && Object.hasOwn(COMMENT_STATUS_PARAM, raw)) {
    return COMMENT_STATUS_PARAM[raw];
  }
  return "pending";
}

export default async function CommentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refusal = refusalFrom(search);
  const selected = commentStatusFromParam(param(search, STATUS));

  const { shelf, viewer, counts, list, byStatus } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      byStatus: await countCommentsByStatus(tx, ctx),
      list:
        selected === "pending"
          ? await getPendingComments(tx, ctx)
          : await getRecentComments(tx, ctx, { status: selected, limit: 10 }),
    }),
  );

  const listHref = `/tu-sach/${slug}/quan-ly/binh-luan`;

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
          title={COMMENT_STATUS_TITLE[selected]}
          subtitle={
            byStatus.pending === 0
              ? "Không có bình luận nào đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt."
              : `${NUMBER.format(byStatus.pending)} bình luận đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt.`
          }
        />

        {refusal ? (
          <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            chips={(["pending", "approved", "rejected", "hidden"] as const).map(
              (status) => ({
                label: COMMENT_STATUS_LABEL[status],
                href: `${listHref}?${STATUS}=${COMMENT_STATUS_SLUG[status]}`,
                active: selected === status,
                count: byStatus[status],
              }),
            )}
          />
        </div>

        {selected === "pending" ? (
          list.map((comment) => (
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
                    icon={
                      <Check aria-hidden className="size-5" strokeWidth={1.75} />
                    }
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
          ))
        ) : list.length === 0 ? (
          <p className="text-[15px] text-meta">Chưa có bình luận nào.</p>
        ) : (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {list.map((c) => (
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
                {/* Only the approved tab offers this: `hideComment` refuses
                    anything that is not already `approved` (`pendingComment`'s
                    own check in `comment-moderation.ts`), so a rejected or
                    hidden row has no command this button could post to. */}
                {selected === "approved" ? (
                  <form action={hideCommentAction} className="shrink-0">
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="binh-luan" value={c.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Ẩn
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ManagerShell>
  );
}
