import Link from "next/link";
// Relative, not the `@/` alias — this file is exercised by
// `tests/components/site-footer.test.tsx` and `vitest.config.ts` configures no
// `resolve.alias` for `@/`. `public-header.tsx`, `reader-tabs.tsx` and
// `ui/phone-link.tsx` all carry the identical note for the identical reason: an
// alias import here would make the component unimportable under Vitest, not
// merely untested.
import { PhoneLink } from "../ui/phone-link";

/**
 * What the footer can say about the people who run the installation.
 *
 * **Structural, rather than `SiteContact` imported from
 * `src/domain/admin/queries/get-admin-overview.ts`.** That module reaches
 * Postgres, and `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`
 * walks a route's imports *transitively* — so importing the type here, even as
 * `import type`, would put every page that renders this footer in the closure
 * of a database module. `/loi` is the page that argument is really about: an
 * error screen that reaches for the database cannot render the failure it
 * exists to report. `ShellViewer` in `manager-shell.tsx` is declared
 * structurally for exactly this reason and states it at length.
 *
 * The query's own `SiteContact` assigns to this structurally, so the two cannot
 * drift in the direction that matters: renaming a field there breaks every
 * caller that passes one here.
 */
export interface FooterContact {
  name: string | null;
  phone: string | null;
  hours: string | null;
}

/**
 * The shelf's own address, as the footer knows it — post-review fix wave,
 * item 8.
 *
 * **Member-only, and this is the field that makes the whole prop
 * disclosure-sensitive.** `address` is the street address `/quan-tri/tu-sach`
 * and `/quan-ly/cai-dat` both label "Địa chỉ" and BR §16.1 withholds from
 * anyone without a membership of the shelf — the same rule
 * `readShelfIdentity` (`src/lib/shelf.ts`) already enforces with its own
 * `requireReader` before either column leaves the database. `location` is
 * also read from there rather than from the public portal directory that
 * happens to expose it too: this component has one source for both fields,
 * and it is the member-gated one, so nothing here has to reason about which
 * of two callers' disclosure rules applies.
 *
 * **This type is structural, the same way `FooterContact` is, and for the
 * identical reason** stated on that interface: importing `ShelfIdentity` from
 * `src/lib/shelf.ts` would work today, but this file must stay free of
 * anything that could later pull `src/lib/page-data` into its own closure —
 * see this file's top docstring for why `/loi` is the page that argument is
 * really about.
 */
export interface FooterShelfAddress {
  location: string | null;
  address: string | null;
}

/**
 * The footer, on every page a reader or a visitor can reach.
 *
 * It replaces `FrontDoorFooter`, which rendered on four pages — `/`,
 * `/tu-sach`, `/lien-he`, `/loi` — and was hardcoded to a wordmark, two links
 * and a copyright. Reader shelf pages, seventeen manager screens and seven
 * administration screens had no footer at all, and the contact details a super
 * admin fills in at `/quan-tri/cai-dat` were displayed by exactly one page in
 * the application.
 *
 * **`contact` is a prop and this component reaches nothing**, which is the
 * whole of how it can be rendered anywhere at all: a footer that queried would
 * put `lib/page-data` in the import closure of every page rendering it, `/loi`
 * included, and that page has to render when the database is the thing that
 * failed.
 *
 * Two kinds of caller read it through `siteContact()` and pass it down: the
 * reader route group's layout (`src/app/tu-sach/[shelf]/(doc-gia)/layout.tsx`),
 * which covers every page of a shelf a reader can see, and the four front-door
 * pages, which have no shared layout to put it in. See `siteContact` in
 * `src/lib/page-data.ts` for why the read short-circuits when there is no
 * database configured at all.
 *
 * **Not on the management screens.** `/quan-ly/*` sits outside that route
 * group and `/quan-tri` has no such layout, both deliberately — see the
 * group's own layout for the argument. A full-width footer running underneath
 * a fixed sidebar reads as a layout that has come apart, and a work surface
 * that carries every destination it needs in its sidebar does not need the
 * parish's telephone number at the bottom.
 *
 * **`null` is a real case, not a fallback** — the same sentence
 * `ShelfHeader`'s `viewerName` docstring writes about its own prop. `/loi`
 * passes it deliberately, and a contact whose three columns are all null (a
 * fresh installation, before anybody has filled the block in) renders the same
 * way: the footer keeps its links and its copyright, and there is no heading
 * over three blank lines.
 *
 * **`shelfAddress` (post-review fix wave, item 8) is the one new prop, and it
 * carries the same "reached nothing itself" guarantee as `contact` for the
 * identical reason.** It is `undefined` on every one of the six front-door
 * routes (`/`, `/tu-sach`, `/lien-he`, `/dang-nhap`, `/dang-ky`, `/loi`) —
 * there is no shelf on any of them, and none of those pages' call sites pass
 * it — and it is `null` on a shelf page rendered for anyone this component's
 * caller decided is not a signed-in member of that shelf. Both render
 * identically: no address block. The caller is `src/app/tu-sach/[shelf]/
 * (doc-gia)/layout.tsx`, which resolves it from `readShelfIdentity` behind
 * that function's own `requireReader`, catching exactly the refusal a
 * non-member produces rather than gating a second time in a different shape
 * here — this component still renders nothing for either "no shelf" or "no
 * membership", but it is not the thing telling the two apart.
 */
export function SiteFooter({
  contact,
  shelfAddress,
}: {
  contact: FooterContact | null;
  shelfAddress?: FooterShelfAddress | null;
}) {
  // A name or a number is something to show. Hours alone is not: "Thứ Hai đến
  // Thứ Sáu, 8h–17h" under a heading reading "Liên hệ ban quản trị", with
  // nobody named and nothing to ring, tells a parish when to fail to reach
  // somebody.
  const hasContact = Boolean(contact?.name || contact?.phone);
  // Same rule, one field over: a shelf that has filled in neither gets no
  // heading either — `readShelfIdentity`'s own docstring calls a `dt` over a
  // blank `dd` worse than no row, and this is that argument at the footer.
  const hasShelfAddress = Boolean(shelfAddress?.location || shelfAddress?.address);

  return (
    <footer className="mt-24 border-t border-hairline bg-paper">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="text-lg font-semibold">OLibra</span>
          <nav className="mt-3 flex flex-wrap gap-4 text-[14px] text-meta">
            <Link href="/" className="hover:text-ink">
              Trang chủ
            </Link>
            <Link href="/tu-sach" className="hover:text-ink">
              Tìm tủ sách
            </Link>
            <Link href="/lien-he" className="hover:text-ink">
              Liên hệ
            </Link>
          </nav>
        </div>

        {hasShelfAddress ? (
          <div className="md:text-right">
            {/* "Địa điểm"/"Địa chỉ" — the exact two labels
                `quan-ly/cai-dat/page.tsx` and `quan-tri/tu-sach/page.tsx`
                already use for `location`/`address`, so a manager reading
                either screen recognises the words here rather than meeting a
                third pair of names for the same two facts. */}
            <p className="text-[13px] font-semibold tracking-wide text-leather uppercase">
              Địa chỉ tủ sách
            </p>
            {shelfAddress?.location ? (
              <p className="mt-2 text-[15px]">{shelfAddress.location}</p>
            ) : null}
            {shelfAddress?.address ? (
              <p className="mt-0.5 text-[14px] text-meta">{shelfAddress.address}</p>
            ) : null}
          </div>
        ) : null}

        {hasContact ? (
          <div className="md:text-right">
            <p className="text-[13px] font-semibold tracking-wide text-leather uppercase">
              Liên hệ ban quản trị
            </p>
            {contact?.name ? (
              <p className="mt-2 text-[15px]">{contact.name}</p>
            ) : null}
            {/* Never plain text. `PhoneLink` also refuses to build a `tel:`
                out of a value that does not parse as a number — see its own
                docstring for the row this footer could otherwise turn into a
                tap target that dials nothing. */}
            {contact?.phone ? (
              <div className="mt-0.5 flex md:justify-end">
                <PhoneLink phone={contact.phone} size="sm" />
              </div>
            ) : null}
            {contact?.hours ? (
              <p className="mt-0.5 text-[14px] text-meta">{contact.hours}</p>
            ) : null}
          </div>
        ) : null}

        <span className="text-[14px] text-meta md:self-end">© 2026 OLibra</span>
      </div>
    </footer>
  );
}
