import { SiteFooter } from "@/components/shell/site-footer";
import { loadPage, siteContact } from "@/lib/page-data";
import { readShelfAddressForFooter } from "@/lib/shelf";

/**
 * U1 §2, and required by
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`, which
 * enumerates `layout` among the route files it checks: this file reaches
 * Postgres through `siteContact`, so it says so.
 *
 * **The reach does not propagate downward.** That test reads each route file's
 * *own* import closure, so the pages beneath this layout are unaffected — none
 * of them acquires a marker it did not need, and the ones that already carry it
 * carry it for their own reasons, which are about a cached render leaking one
 * shelf's rows to another rather than about a footer.
 */
export const dynamic = "force-dynamic";

/**
 * The footer for a shelf's **reader** pages (U6 §6).
 *
 * **`(doc-gia)` is a route group, so it changes no URL** — `danh-muc` still
 * serves `/tu-sach/[shelf]/danh-muc`. It exists to draw a line this layout
 * could not otherwise draw: `quan-ly` sits outside the group, one level up
 * beside it, so the seventeen manager screens are not wrapped by this file.
 *
 * **Which is the point.** This layout first landed at `[shelf]/layout.tsx`,
 * where it wrapped the manager screens too, and a full-width footer running
 * underneath a fixed sidebar reads as a layout that has come apart rather than
 * as chrome — reported on sight. A manager screen is a work surface: it has a
 * sidebar carrying every destination it needs, and the parish's telephone
 * number is not one of them. The people who need the contact block are readers
 * and visitors, which is exactly who is inside this group.
 *
 * `flex min-h-dvh flex-col` with the children growing, so the footer sits at
 * the bottom of a short page rather than halfway up it.
 *
 * **`shelfAddress` (post-review fix wave, item 8) is resolved here, once, the
 * same way `contact` already is** — never inside `SiteFooter` itself, which
 * must not import anything that reaches Postgres (that component's own
 * docstring, and `tests/architecture/pages-reading-the-database-are-dynamic
 * .test.ts`, which would otherwise put every page rendering it, `/loi`
 * included, in the closure of a database read). `readShelfAddressForFooter`
 * (`src/lib/shelf.ts`) is what turns "may this viewer see it" into `null`
 * instead of a redirect for the one page in this group a guest may reach —
 * calling `readShelfIdentity` here directly would gate every page in this
 * group on a membership, and `/gop-y` (`submitFeedback`'s own docstring)
 * is explicitly not gated that way; see that function's own docstring for
 * the full argument.
 */
export default async function ReaderLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;
  const [contact, shelfAddress] = await Promise.all([
    siteContact(),
    loadPage(slug, (tx, ctx) => readShelfAddressForFooter(tx, ctx)),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter contact={contact} shelfAddress={shelfAddress} />
    </div>
  );
}
