import Link from "next/link";
import { Pin } from "lucide-react";
import { PageHeading } from "@/components/ui/card";
import { ShelfHeader } from "@/components/shell/public-header";
import { getAnnouncements } from "@/domain/community/queries/get-announcements";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";

/**
 * The shelf's announcements. OPS §3.2's `GetAnnouncementsList`, BR §16.1's
 * "pinned first, most recent next".
 *
 * **An announcement lapses on read, and this page does not know that.** The
 * query compares `expires_at` against `olibra_now()`, so a notice about last
 * Sunday stops showing the moment it passes with nothing having run (G5). A
 * filter written here would be a second definition of expiry that moves
 * independently of the manager's own list.
 *
 * Members only — BR:36 puts a shelf's contents behind membership, and
 * `getAnnouncements` calls `requireReader`. U2's seam turns that into a
 * sign-in redirect for a guest and a 404 for a signed-in non-member.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Thông báo của tủ sách — OLibra" };

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, announcements } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      announcements: await getAnnouncements(tx, ctx),
    }),
  );

  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="thong-bao"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeading
          title="Thông báo của tủ sách"
          subtitle={
            announcements.length === 0 ? "Hiện chưa có thông báo nào." : undefined
          }
        />

        {announcements.length > 0 ? (
          <ul className="mt-8 space-y-4">
            {announcements.map((a) => (
              <li
                key={a.id}
                className="rounded-card border border-hairline bg-surface p-5"
              >
                <div className="flex items-start gap-2">
                  {a.isPinned ? (
                    <Pin className="mt-1 size-4 shrink-0 text-meta" aria-hidden />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`${base}/thong-bao/${a.slug}`}
                      className="text-[17px] leading-snug font-semibold hover:underline"
                    >
                      {a.title}
                    </Link>
                    <p className="mt-2 text-[14px] leading-relaxed text-meta">
                      {a.excerpt}
                    </p>
                    {a.publishedAt ? (
                      <p className="mt-3 text-[13px] text-meta">
                        {formatInstant(a.publishedAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <Link href={base} className="mt-8 inline-block text-[14px] underline">
          Về trang tủ sách
        </Link>
      </main>
    </>
  );
}
