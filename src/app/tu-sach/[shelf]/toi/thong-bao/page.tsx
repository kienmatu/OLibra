import Link from "next/link";
import { PageHeading } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { getMyNotifications } from "@/domain/notifications/queries/get-my-notifications";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "../actions";

/**
 * The bell's own page. BR §15: in-app only, no email, an unread count.
 *
 * **The Vietnamese comes from the domain**, through `notificationSentence` in
 * `getMyNotifications` — never assembled here. Same rule `messageFor` and
 * `auditSentence` follow: a screen does not write its own wording for an event
 * it did not define, and `request_approved` on a child's screen would be a
 * failure rather than a fallback.
 *
 * **Read, never deleted.** Marking one read leaves the row, because the row is
 * the record that they were told — which is the whole reason a notification is
 * state rather than something computed on read (`sweep.ts` carries the long
 * version of that argument).
 */
export const dynamic = "force-dynamic";

export default async function ReaderNotificationsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, mine } = await loadPage(slug, async (tx, ctx, v) => ({
    shelf: await readShelf(tx, ctx),
    viewer: v,
    mine: await getMyNotifications(tx, ctx, { limit: 50 }),
  }));

  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="thong-bao-cua-toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />
      <ReaderTabs shelfSlug={slug} active="trang-cua-toi" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <PageHeading
            title="Thông báo"
            subtitle={
              mine.unread === 0
                ? "Em đã đọc hết rồi."
                : `Em có ${mine.unread} thông báo chưa đọc.`
            }
          />
          {mine.unread > 0 ? (
            <form action={markAllNotificationsReadAction} className="mt-2 shrink-0">
              <input type="hidden" name="tu-sach" value={slug} />
              <SubmitButton variant="outline" size="sm">
                Đánh dấu đã đọc hết
              </SubmitButton>
            </form>
          ) : null}
        </div>

        {mine.rows.length === 0 ? (
          <p className="mt-8 text-[14px] text-meta">
            Chưa có thông báo nào. Khi đơn đăng ký hoặc yêu cầu mượn của em được
            duyệt, em sẽ thấy ở đây.
          </p>
        ) : (
          <ul className="mt-8 divide-y divide-hairline rounded-card border border-hairline bg-surface">
            {mine.rows.map((n) => (
              <li
                key={n.id}
                className={
                  n.readAt
                    ? "px-4 py-4"
                    : // Unread carries a tint *and* a marker word, never colour
                      // alone — BR §17.1's second principle.
                      "bg-held/5 px-4 py-4"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-[15px] leading-snug">
                    {n.sentence}
                  </p>
                  {!n.readAt ? (
                    <span className="shrink-0 text-[12px] font-semibold text-held">
                      Mới
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-meta">
                    {formatInstant(n.createdAt)}
                  </span>
                  {!n.readAt ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="tu-sach" value={slug} />
                      <input type="hidden" name="thong-bao" value={n.id} />
                      <SubmitButton variant="quiet" size="sm">
                        Đánh dấu đã đọc
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Link
          href={`${base}/toi`}
          className="mt-8 inline-block text-[14px] underline"
        >
          Về trang của tôi
        </Link>
      </main>
    </>
  );
}
