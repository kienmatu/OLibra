import Link from "next/link";
import { Mail } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Chip } from "@/components/ui/segmented";
import { PhoneLink } from "@/components/ui/phone-link";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import {
  countUnreadFeedback,
  feedbackFilterFrom,
  getFeedbackDetail,
  getFeedbackInbox,
} from "@/domain/admin/queries/get-feedback-inbox";
import { loadAdminPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { cn } from "@/lib/utils";
import { markFeedbackReadAction, resolveFeedbackAction } from "../actions";

/**
 * The administrator's inbox — OPS §3.4's `GetFeedbackInbox` and
 * `GetFeedbackDetail`, and the first `/quan-tri` page that reads the database.
 *
 * **This closes a hole rather than adding a feature.** `submitFeedback` has been
 * live on every shelf's *Góp ý* form since B3 and is the only write in the
 * system open to a caller with no session. Nothing could read what it wrote. A
 * parish's children could send a note to the people who keep their shelf, the
 * row landed, the rate limit counted it, and no screen in the application could
 * open it.
 *
 * **A list and a detail on one page, not two routes.** BR §16.1's screen is a
 * two-pane inbox, and the selected message travels in `?tin=` — which is a
 * feedback id in a URL, so it is worth being explicit that this is safe: an id
 * names a row the administrator may already read in full, `getFeedbackDetail`
 * refuses everyone else by role, and the id itself discloses nothing (a uuid
 * that names no row renders the empty pane). What is deliberately *not* in the
 * URL is anything from the message.
 *
 * **`?trang-thai=` is narrowed before it reaches the query**, by
 * `feedbackFilterFrom`, so an unrecognised value means "no filter" rather than a
 * filter matching nothing — an empty inbox that reads as "no messages" is the
 * shape of a bug this project has already shipped twice.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Góp ý — Quản trị OLibra" };

const FILTERS = [
  { key: "new", label: "Mới" },
  { key: "read", label: "Đã đọc" },
  { key: "resolved", label: "Đã xử lý" },
] as const;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const status = feedbackFilterFrom(param(search, "trang-thai") ?? null);
  const selectedId = param(search, "tin") ?? null;
  const refusal = refusalFrom(search);

  const { viewer, unread, messages, open } = await loadAdminPage(
    async (tx, ctx, v) => {
      const messages = await getFeedbackInbox(tx, ctx, { status });
      // Nothing chosen, or a `?tin=` naming nothing: fall back to the top of
      // the list, which is the unread message the administrator came for.
      //
      // Resolved **inside the same callback**, so the whole page is one
      // read-only transaction and one instant. Two `loadAdminPage` calls would
      // have been two transactions, and the second could see a message the
      // first did not — a list and a detail pane disagreeing about what is
      // unread.
      const chosen =
        (selectedId
          ? await getFeedbackDetail(tx, ctx, { feedbackId: selectedId })
          : null) ??
        (messages[0]
          ? await getFeedbackDetail(tx, ctx, {
              feedbackId: messages[0].feedbackId,
            })
          : null);

      return {
        viewer: v,
        unread: await countUnreadFeedback(tx, ctx),
        messages,
        open: chosen,
      };
    },
  );

  const hrefFor = (next: { status?: string | null; tin?: string }) => {
    const q = new URLSearchParams();
    const s = next.status === undefined ? status : next.status;
    if (s) q.set("trang-thai", s);
    if (next.tin) q.set("tin", next.tin);
    const query = q.toString();
    return query ? `/quan-tri/gop-y?${query}` : "/quan-tri/gop-y";
  };

  return (
    <AdminShell active="gop-y" viewer={viewer} unreadFeedback={unread}>
      <div className="flex min-h-[calc(100vh-6.5rem)] flex-col border border-hairline md:flex-row">
        <aside className="flex flex-col border-hairline md:w-[340px] md:shrink-0 md:border-r">
          <div className="border-b border-hairline p-5">
            <h1 className="text-[20px] font-semibold">Góp ý</h1>
            <p className="mt-0.5 text-[14px] text-meta">
              {unread === 0 ? "Không có tin mới" : `${unread} tin mới`}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {/* No counts on the chips. A count per status is three more
                  queries for a number nobody acts on, and the one count that
                  matters — unread — is above and in the sidebar badge. */}
              <Chip href={hrefFor({ status: null })} active={status === null}>
                Tất cả
              </Chip>
              {FILTERS.map((f) => (
                <Chip
                  key={f.key}
                  href={hrefFor({ status: f.key })}
                  active={status === f.key}
                >
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>

          {messages.length === 0 ? (
            <p className="p-5 text-[14px] text-meta">Chưa có góp ý nào.</p>
          ) : (
            <ul className="flex-1 divide-y divide-hairline overflow-y-auto">
              {messages.map((m) => {
                const isOpen = m.feedbackId === open?.feedbackId;
                return (
                  <li key={m.feedbackId} className="relative">
                    {isOpen ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[3px] bg-terracotta"
                      />
                    ) : null}
                    <Link
                      href={hrefFor({ tin: m.feedbackId })}
                      className={cn(
                        "block px-5 py-3.5",
                        m.isUnread ? "bg-paper" : "opacity-60",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {m.isUnread ? (
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full bg-terracotta"
                          />
                        ) : null}
                        <p className="truncate text-[15px] font-medium">
                          {/* A guest gives a name and nothing else identifies
                              them. Empty would render a blank row. */}
                          {m.senderName || "Khách (không đăng nhập)"}
                        </p>
                      </div>
                      <p className="mt-0.5 truncate text-[15px]">
                        {m.subject || "(không có chủ đề)"}
                      </p>
                      <p className="mt-0.5 text-[13px] text-meta">
                        {m.shelfName ?? "Toàn hệ thống"} ·{" "}
                        {formatInstant(m.submittedAt)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="flex-1 p-6 md:p-8">
          {open === null ? (
            <p className="text-[15px] text-meta">Chọn một tin để đọc.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="max-w-2xl text-[24px] leading-tight font-semibold">
                  {open.subject || "(không có chủ đề)"}
                </h2>
                {open.isUnread ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
                    <Mail aria-hidden className="size-[16px]" strokeWidth={1.75} />
                    Tin mới
                  </span>
                ) : null}
              </div>

              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-meta">
                <span>{open.senderName || "Khách (không đăng nhập)"}</span>
                {open.senderContact ? (
                  <>
                    <span aria-hidden>·</span>
                    <PhoneLink phone={open.senderContact} size="sm" />
                  </>
                ) : null}
                <span aria-hidden>·</span>
                <span>{formatInstant(open.submittedAt)}</span>
                <span aria-hidden>·</span>
                <span>{open.shelfName ?? "Toàn hệ thống"}</span>
              </p>

              {/* QA remediation Task 21. `senderName` above is always what was
                  typed into "Tên của bạn" — never the signed-in account's own
                  name, which used to win silently and had an administrator
                  calling the wrong person. This line is the account, kept
                  visible rather than hidden by that fix: whenever the message
                  was sent while signed in, whether or not the typed name
                  happens to match. */}
              {open.accountName ? (
                <p className="mt-1 text-[14px] text-meta">
                  Gửi khi đang đăng nhập bằng {open.accountName}.
                </p>
              ) : null}

              {/* Plain text, not markup — the same call the announcement detail
                  page made, and here the author may be a stranger with no
                  account at all. */}
              <p className="mt-8 max-w-2xl text-[16px] leading-[1.9] whitespace-pre-line">
                {open.body}
              </p>

              <p className="mt-8 text-[14px] text-meta">
                Hệ thống không gửi email. Trả lời bằng cách gọi vào số điện thoại ở
                trên.
              </p>

              {open.handledAt ? (
                <p className="mt-2 text-[14px] text-meta">
                  {open.handledByName ?? "Ban quản trị"} đã xử lý lúc{" "}
                  {formatInstant(open.handledAt)}.
                </p>
              ) : null}

              {refusal ? (
                <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
                  {messageFor(refusal)}
                </p>
              ) : null}

              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
                {open.status === "resolved" ? null : (
                  <form action={resolveFeedbackAction}>
                    <input type="hidden" name="gop-y" value={open.feedbackId} />
                    <SubmitButton variant="primary" size="lg">
                      Đánh dấu đã xử lý
                    </SubmitButton>
                  </form>
                )}
                {open.isUnread ? (
                  <form action={markFeedbackReadAction}>
                    <input type="hidden" name="gop-y" value={open.feedbackId} />
                    <SubmitButton variant="quiet" size="md">
                      Đánh dấu đã đọc
                    </SubmitButton>
                  </form>
                ) : null}
                {/* *Lưu trữ* removed by the product owner (2026-08-09).
                    `feedback_status` has exactly three values and the table has
                    no `deleted_at`, so the button needed a migration either way
                    — and a fourth *status* ("the administrator finished with
                    it") and a *soft delete* ("stop showing it at all") are
                    different products that nothing in the requirements chose
                    between. `Đã xử lý` is the end of the line. */}
              </div>
            </>
          )}
        </main>
      </div>
    </AdminShell>
  );
}
