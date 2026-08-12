import Link from "next/link";
import type { Metadata } from "next";
import { HeartHandshake, Library, MessageSquare, Pin } from "lucide-react";
import { BigActionLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { BookCard } from "@/components/ui/book";
import { ContactList } from "@/components/ui/contact-list";
import { ShelfHeader } from "@/components/shell/public-header";
import { getAnnouncements } from "@/domain/community/queries/get-announcements";
import { getCatalogue } from "@/domain/catalogue/queries/get-catalogue";
import { loadPage } from "@/lib/page-data";
import { readShelfIdentity } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/**
 * U1 §2, and U2 §3.3 for why this page in particular is not cached.
 *
 * A shelf's home page looks like the most cacheable thing in the application —
 * every member of one parish sees the same shelf name, the same contacts and
 * the same six covers. It is not cached anyway, and the reason is worth
 * writing down rather than rediscovering: the cache key would have to include
 * the shelf *and* the viewer, because this page carries the viewer's own name
 * in its header, and it stays correct only until somebody adds one more
 * personalised element and does not update the key. The audience is a few
 * hundred people per parish and the content changes whenever a volunteer works.
 *
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` is the
 * deliverable rather than this line; it walks imports and requires the marker
 * on every route that reaches Postgres.
 */
export const dynamic = "force-dynamic";

/**
 * QA remediation Task 25. `readShelfIdentity`, the exact read the page body
 * already opens with, called again here for the same reason `sach/[slug]`'s
 * own `generateMetadata` calls `getBookDetail` a second time — Next.js runs
 * this function and the page component as two separate invocations, and there
 * is no `fetch`-level memoization over a raw SQL read to dedupe them.
 *
 * Reusing `loadPage` rather than a bespoke lookup means a guest is sent to
 * sign in and a slug naming no shelf 404s exactly as the page's own render
 * would, before either produces any HTML — `loadPage`'s own docstring is
 * where that guarantee is made once, for every caller.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shelf: string }>;
}): Promise<Metadata> {
  const { shelf: slug } = await params;

  const { shelf } = await loadPage(slug, async (tx, ctx) => ({
    shelf: await readShelfIdentity(tx, ctx),
  }));

  return { title: `${shelf.name} — OLibra` };
}

/**
 * Small integers, still through the locale. SDD §6.6: "Dates and numbers are
 * formatted through the locale, never with hand-written format strings."
 */
const NUMBER = new Intl.NumberFormat("vi-VN");

/** How many covers the "Mới thêm" row carries. */
const RECENT_COVERS = 6;

/**
 * BR:496 — "the most important page for a member, and the first thing seen
 * after signing in. **Not public.**"
 *
 * PO feedback round 1, Task 4 rewrote this page around the shelf's contacts
 * rather than its full identity block. `ShelfHeader` already carries the
 * shelf's name three lines above, in the topbar every reader page shares —
 * so a second, 30px repetition of it here (the old item 1, a `Card` headed
 * by `<h1>{shelf.name}</h1>` with location, address and a single keeper
 * underneath) was wasted vertical space repeating a fact the reader had
 * already been told. What is genuinely new information at the top of this
 * page is *who to contact*, so `ContactList` (Task 2's `bookshelf_contacts`,
 * up to three per shelf) is what the identity block shrank to, and the
 * document's own `<h1>` moved to `sr-only` rather than being deleted — the
 * page still needs exactly one heading, it just does not need to spend pixels
 * on it a second time.
 *
 * The space that freed up carries the two things a member most needs after
 * "who do I call": the shelf's own pinned or most recent announcement
 * (`getAnnouncements`, already ordered pinned-first by BR §16.1), and the two
 * quiet links out — "Tặng sách" and "Góp ý" — that were pulled in the
 * fixture-era cleanup (IMPORTANT 4, fix-report 2026-08-09-u2-shelf-and-portal)
 * because neither route was wired yet. Both are now real pages reading the
 * database, so they come back beside a real shelf's real content rather than
 * pointing into another parish's invented one.
 *
 * The one primary action stays a single `BigActionLink` into the catalogue,
 * carrying both counts ("Sách có sẵn" and "Toàn bộ tủ sách" used to be two
 * separate buttons; one link into the same destination with both numbers in
 * its sublabel says the same thing without asking a member to choose between
 * two doors that lead to one room). The "Mới thêm" cover row is unchanged.
 */
export default async function ShelfHomePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, available, recent, announcements } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      // Two reads rather than one, because the primary link's sublabel is
      // counting two different things: "có thể mượn hôm nay" is titles with a
      // borrowable copy right now, the total is every published title.
      // `getCatalogue`'s `total` is a window count over the whole filtered
      // set, so the second one carries the six "Mới thêm" covers as well
      // without a third query.
      available: await getCatalogue(tx, ctx, { scope: "available", pageSize: 1 }),
      recent: await getCatalogue(tx, ctx, {
        scope: "all",
        sort: "recent",
        pageSize: RECENT_COVERS,
      }),
      // `getAnnouncements` already orders `is_pinned desc, published_at desc`
      // (BR §16.1) — the first row is the pinned one when there is one and
      // the newest otherwise, so no second query or ordering is needed here.
      announcements: await getAnnouncements(tx, ctx),
    }),
  );

  const announcement = announcements[0] ?? null;
  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* `ShelfHeader` already carries the shelf's name; this heading exists
            so the document still has exactly one, for anything that walks the
            markup by heading rather than by eye. */}
        <h1 className="sr-only">{shelf.name}</h1>

        {shelf.contacts.length > 0 ? (
          <Card className="p-6">
            <ContactList contacts={shelf.contacts} />
          </Card>
        ) : null}

        {announcement ? (
          <Card className="mt-8 p-6">
            <div className="flex items-center gap-2">
              {announcement.isPinned ? <Pill icon={Pin} label="Ghim" /> : null}
              <span className="text-[14px] text-meta">Bản tin</span>
            </div>
            <h2 className="mt-2 text-[20px] font-semibold">{announcement.title}</h2>
            <p className="mt-2 line-clamp-3 text-[16px]">{announcement.excerpt}</p>
            <Link
              href={`${base}/thong-bao/${announcement.slug}`}
              className="mt-3 inline-flex min-h-11 items-center text-[15px] text-leather"
            >
              Đọc tiếp
            </Link>
          </Card>
        ) : null}

        {/* The one primary action. Impossible to miss (BR:499). The counts
            are titles — "đầu sách" — not copies: `getCatalogue` aggregates one
            row per title, so "cuốn", which the fixture page used, would have
            been the wrong noun over the right number. */}
        <div className="mt-8">
          <BigActionLink
            href={`${base}/danh-muc`}
            icon={Library}
            label="Xem toàn bộ tủ sách"
            sublabel={`${NUMBER.format(recent.total)} đầu sách · ${NUMBER.format(available.total)} có thể mượn hôm nay`}
            variant="primary"
          />
        </div>

        {/* The quiet links out, restored (IMPORTANT 4, fix-report,
            2026-08-09-u2-shelf-and-portal, reversed): they pointed at
            `${base}/tang-sach` and `${base}/gop-y` and neither route was
            wired, so this page — real books, real shelf, real member's name —
            ended with two links into another parish's invented content. Both
            routes read the database now (`/gop-y` posts through
            `submitFeedbackAction`; `/tang-sach` redirects to the wired
            `ho-so/tang-sach`), so the links come back beside a page that
            works. `tests/architecture/a-wired-page-renders-no-fixtures.test.ts`
            is what would catch either regressing to a fixture again. */}
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <BigActionLink
            href={`${base}/tang-sach`}
            icon={HeartHandshake}
            label="Tặng sách"
            sublabel="Góp sách cho tủ sách của giáo xứ"
            variant="outline"
          />
          <BigActionLink
            href={`${base}/gop-y`}
            icon={MessageSquare}
            label="Góp ý"
            sublabel="Gửi ý kiến cho ban quản trị"
            variant="outline"
          />
        </div>

        {recent.rows.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-[20px] font-semibold">Mới thêm</h2>
            {/* BR:500 asks for a horizontally scrollable cover row, and this is
                the one place on the page wide enough to need it: six 2:3 covers
                do not fit 375px. The scroll stays inside this container so the
                page body never scrolls sideways. */}
            <div className="-mx-6 mt-5 flex gap-5 overflow-x-auto px-6 pb-2">
              {recent.rows.map((book) => (
                <div key={book.slug} className="w-32 shrink-0 sm:w-36">
                  <BookCard
                    href={`${base}/sach/${book.slug}`}
                    title={book.title}
                    author={book.author}
                    status={statusForAvailability(book.availability)}
                    coverUrl={book.coverUrl}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
