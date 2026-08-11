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
 */
export function SiteFooter({ contact }: { contact: FooterContact | null }) {
  // A name or a number is something to show. Hours alone is not: "Thứ Hai đến
  // Thứ Sáu, 8h–17h" under a heading reading "Liên hệ ban quản trị", with
  // nobody named and nothing to ring, tells a parish when to fail to reach
  // somebody.
  const hasContact = Boolean(contact?.name || contact?.phone);

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
