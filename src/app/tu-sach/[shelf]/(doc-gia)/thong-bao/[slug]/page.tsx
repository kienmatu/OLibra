import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pin } from "lucide-react";
import { PageHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { getAnnouncementDetail } from "@/domain/community/queries/get-announcements";
import { atLeast } from "@/domain/kernel/tenant";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";
import {
  pinAnnouncementAction,
  unpinAnnouncementAction,
} from "../../../quan-ly/actions";

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

/**
 * QA remediation Task 25. `getAnnouncementDetail`, the same query and the
 * same `slug` the page body reads, returning `null` for a draft, a lapsed
 * announcement, or a slug naming nothing alike — the page's own docstring
 * gives the reason all three collapse into one 404 rather than three answers
 * that would tell a prober which case it hit. `notFound()` here on that same
 * `null` keeps the metadata path refusing exactly the way the page does.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shelf: string; slug: string }>;
}): Promise<Metadata> {
  const { shelf: shelfSlug, slug } = await params;

  const { announcement } = await loadPage(shelfSlug, async (tx, ctx) => ({
    announcement: await getAnnouncementDetail(tx, ctx, { slug }),
  }));
  if (!announcement) notFound();

  return { title: `${announcement.title} — OLibra` };
}

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
  // Task 5's seam, resolved once and reused for both the header prop and the
  // pin control below rather than a second `atLeast` call.
  const canManage = atLeast(viewer.role, "manager");

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelfSlug}
        active="thong-bao"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
        canManage={canManage}
        isSuperAdmin={atLeast(viewer.role, "super_admin")}
      />

      <main className="mx-auto max-w-2xl px-6 py-10">
        {announcement.isPinned ? (
          <div className="mb-3">
            <Pill icon={Pin} label="Ghim" />
          </div>
        ) : null}

        <PageHeading
          title={announcement.title}
          subtitle={
            announcement.publishedAt
              ? formatInstant(announcement.publishedAt)
              : undefined
          }
          action={
            canManage ? (
              <form
                action={
                  announcement.isPinned
                    ? unpinAnnouncementAction
                    : pinAnnouncementAction
                }
              >
                <input type="hidden" name="tu-sach" value={shelfSlug} />
                <input type="hidden" name="thong-bao" value={announcement.id} />
                <SubmitButton variant="ghost" size="sm">
                  {announcement.isPinned ? "Bỏ ghim" : "Ghim lên đầu"}
                </SubmitButton>
              </form>
            ) : undefined
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
