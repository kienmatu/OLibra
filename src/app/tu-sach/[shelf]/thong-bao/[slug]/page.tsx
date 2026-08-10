import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/ui/card";
import { ShelfHeader } from "@/components/shell/public-header";
import { getAnnouncementDetail } from "@/domain/community/queries/get-announcements";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";

/**
 * One announcement in full. OPS §3.2's `GetAnnouncementDetail`.
 *
 * **A lapsed announcement 404s rather than rendering**, which is the half that
 * makes the list's filter a rule instead of a presentation choice: if pasting
 * the URL still showed it, expiry would only be true of the index page. The
 * query applies the same `olibra_now()` comparison and returns `null` for a
 * draft, a lapsed one, or a slug naming nothing alike — RLS has already removed
 * another shelf's, so telling those apart would confirm it exists.
 */
export const dynamic = "force-dynamic";

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}) {
  const { shelf: shelfSlug, slug } = await params;

  const { shelf, viewer, announcement } = await loadPage(
    shelfSlug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      announcement: await getAnnouncementDetail(tx, ctx, { slug }),
    }),
  );

  if (!announcement) notFound();

  const base = `/tu-sach/${shelfSlug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelfSlug}
        active="thong-bao"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <PageHeading
          title={announcement.title}
          subtitle={
            announcement.publishedAt
              ? formatInstant(announcement.publishedAt)
              : undefined
          }
        />

        {/* The body is rendered as text, not as markup. `announcements.body` is
            described as "rich" in the schema but nothing in this application
            has ever written anything but plain text into it, and rendering it
            as HTML would turn a manager's typing into an injection surface on
            a page every member of the parish reads. When a rich editor lands,
            it brings its own sanitiser and its own argument. */}
        <div className="mt-8 text-[16px] leading-relaxed whitespace-pre-line">
          {announcement.body}
        </div>

        <Link
          href={`${base}/thong-bao`}
          className="mt-10 inline-block text-[14px] underline"
        >
          Về danh sách thông báo
        </Link>
      </main>
    </>
  );
}
