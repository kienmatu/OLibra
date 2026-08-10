import Link from "next/link";
import {
  BookOpen,
  Building2,
  Clock,
  KeyRound,
  Library,
  MapPin,
} from "lucide-react";
import { BigActionLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BookCard } from "@/components/ui/book";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
import { getCatalogue } from "@/domain/catalogue/queries/get-catalogue";
import { loadPage } from "@/lib/page-data";
import { readShelfIdentity } from "@/lib/shelf";
import { statusForAvailability } from "@/lib/status";

/**
 * U1 §2, and U2 §3.3 for why this page in particular is not cached.
 *
 * A shelf's home page looks like the most cacheable thing in the application —
 * every member of one parish sees the same shelf name, the same opening hours
 * and the same six covers. It is not cached anyway, and the reason is worth
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
 * The order down the page is that section's numbered list, and this page
 * follows it rather than an arrangement of its own. Three of its seven items
 * cannot be built in this slice, and each is left out rather than faked:
 *
 * - **2, announcements** and **6, latest approved comments** — both are B3's,
 *   and U2's own scope note excludes them. There is no `announcements` or
 *   `comments` query in `src/domain/`, and the fixture card this page used to
 *   render ("Nghỉ hè — tủ sách mở thêm chiều thứ Bảy") is content from
 *   `src/lib/fixtures.ts`, not from any parish.
 * - **4, most-borrowed books** — nothing counts loans per title. **OPS §3.2's
 *   `GetShelfHome` (`OPERATIONS.md:59`) does ask for it**, explicitly: it
 *   returns "most-borrowed row, most-active readers, latest approved comments",
 *   with "Most-borrowed ranking" listed as Derived on read. There is simply no
 *   query, and writing one is a domain change this task is not making. What the
 *   row shows instead is the shelf's most recently added titles, under the
 *   heading the catalogue's own sort control already uses for that ordering
 *   ("Mới thêm"). A row of six covers under "Sách được mượn nhiều nhất" would
 *   have been the same six covers and a false claim.
 *
 *   (Minor 10, fix-report 2026-08-09-u2-shelf-and-portal: this used to cite
 *   "OPS §3.1 defines no such operation". §3.1 is the *guest* section, so that
 *   is true and says nothing — a reader would conclude BR never asked for the
 *   row. The substitution stands; the citation was pointing at the wrong
 *   section. The missing queries are recorded against their slice in
 *   `docs/superpowers/plans/2026-08-07-olibra-backend-master.md`.)
 * - **5, most-active readers** — the same gap, named in the same `GetShelfHome`
 *   row, with a privacy edge on top: BR §5.4 makes the leaderboard opt-in per
 *   membership, so the query does not merely not exist, it has a rule attached
 *   that nothing in this slice implements.
 *
 * Item 1 (identity) and 3 (the two large buttons) are here and are real.
 *
 * **Item 7, the quiet links out, was here and is gone** (IMPORTANT 4,
 * fix-report, 2026-08-09-u2-shelf-and-portal). "Tặng sách cho tủ sách" and
 * "Gửi góp ý cho ban quản trị" pointed at `${base}/tang-sach` and
 * `${base}/gop-y`, and neither route is wired — both render `src/lib/fixtures
 * .ts`. So this page, whose whole point is that it is the first *real* thing a
 * member sees, ended with two links into another parish's invented content.
 * That is the same class of defect as items 2, 4, 5 and 6 above, arriving by a
 * different route: not faked *on* the page, but reachable in one tap *from* it,
 * which is not a distinction the person tapping can make. `ShelfHeader` carries
 * the same decision for "Thông báo" and "Trang của tôi", and the long version
 * of why the links go rather than the pages getting gated.
 */
export default async function ShelfHomePage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, available, recent } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      // Two reads rather than one, because the two big buttons are counting
      // different things: "Sách có sẵn" is titles with a borrowable copy right
      // now, "Toàn bộ tủ sách" is every published title. `getCatalogue`'s
      // `total` is a window count over the whole filtered set, so the second
      // one carries the six covers as well without a third query.
      available: await getCatalogue(tx, ctx, { scope: "available", pageSize: 1 }),
      recent: await getCatalogue(tx, ctx, {
        scope: "all",
        sort: "recent",
        pageSize: RECENT_COVERS,
      }),
    }),
  );

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
        {/* 1. Shelf identity: where it is, when it opens, who holds the key.
            Every row below the name is conditional, because every column
            behind it is nullable — a parish onboarded last Sunday may have a
            name and nothing else, and a "Giờ mở cửa" label over a blank value
            is worse than no row at all. */}
        <Card className="p-8">
          <h1 className="text-[30px] leading-tight font-semibold">{shelf.name}</h1>

          {shelf.location ||
          shelf.address ||
          shelf.openingHours ||
          shelf.keeperName ? (
            <dl className="mt-6 space-y-4">
              {shelf.location ? (
                <div className="flex gap-3">
                  <MapPin
                    aria-hidden
                    className="mt-1 size-5 shrink-0 text-leather"
                    strokeWidth={1.75}
                  />
                  <div>
                    <dt className="text-[14px] text-meta">Địa điểm</dt>
                    <dd className="text-[16px]">{shelf.location}</dd>
                  </div>
                </div>
              ) : null}
              {/* Below "Địa điểm" and separate from it (QA remediation Task
                  22): `location` is the landmark a reader navigates by
                  ("Nhà xứ Thánh Tâm"), `address` is the street address BR:179
                  lists as its own field. Omitted when empty, the same as
                  every row here — most shelves onboarded before this task had
                  a `location` typed in and no reason yet to fill in the
                  other. */}
              {shelf.address ? (
                <div className="flex gap-3">
                  <Building2
                    aria-hidden
                    className="mt-1 size-5 shrink-0 text-leather"
                    strokeWidth={1.75}
                  />
                  <div>
                    <dt className="text-[14px] text-meta">Địa chỉ</dt>
                    <dd className="text-[16px]">{shelf.address}</dd>
                  </div>
                </div>
              ) : null}
              {shelf.openingHours ? (
                <div className="flex gap-3">
                  <Clock
                    aria-hidden
                    className="mt-1 size-5 shrink-0 text-leather"
                    strokeWidth={1.75}
                  />
                  <div>
                    <dt className="text-[14px] text-meta">Giờ mở cửa</dt>
                    <dd className="text-[16px]">{shelf.openingHours}</dd>
                  </div>
                </div>
              ) : null}
              {shelf.keeperName ? (
                <div className="flex gap-3">
                  <KeyRound
                    aria-hidden
                    className="mt-1 size-5 shrink-0 text-leather"
                    strokeWidth={1.75}
                  />
                  <div>
                    <dt className="text-[14px] text-meta">Người giữ chìa khoá</dt>
                    <dd className="text-[16px]">{shelf.keeperName}</dd>
                    {/* The phone is its own row and only when there is one:
                        `keeper_phone` is nullable independently of
                        `keeper_name`, and a `tel:` link to an empty string is
                        a tap that opens the dialler on nothing. */}
                    {shelf.keeperPhone ? (
                      <dd className="mt-0.5">
                        <PhoneLink phone={shelf.keeperPhone} size="md" />
                      </dd>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </dl>
          ) : null}
        </Card>

        {/* 3. The two primary actions. Impossible to miss (BR:499). The counts
            are titles — "đầu sách" — not copies: `getCatalogue` aggregates one
            row per title, so "cuốn", which the fixture page used, would have
            been the wrong noun over the right number. */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <BigActionLink
            href={`${base}/danh-muc`}
            icon={BookOpen}
            label="Sách có sẵn"
            sublabel={`${NUMBER.format(available.total)} đầu sách có thể mượn hôm nay`}
            variant="primary"
          />
          <BigActionLink
            href={`${base}/danh-muc?loc=tat-ca`}
            icon={Library}
            label="Toàn bộ tủ sách"
            sublabel={`${NUMBER.format(recent.total)} đầu sách`}
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

        {/* 7. **The quiet links out are gone** (IMPORTANT 4, fix-report,
            2026-08-09-u2-shelf-and-portal). They pointed at `${base}/tang-sach`
            and `${base}/gop-y`, and neither route is wired: both render
            `src/lib/fixtures.ts`, so this page — real books, real shelf, real
            member's name — handed a member two links into another parish's
            invented content. `ShelfHeader` carries the same decision for
            "Thông báo" and "Trang của tôi", and the long version of why the
            links go rather than the pages getting gated.

            "Tặng sách" was already off BR:503's list, which names only
            feedback; both come back with their own slice, next to a page that
            works. */}
      </main>
    </>
  );
}
