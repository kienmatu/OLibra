import { SiteFooter } from "@/components/shell/site-footer";
import { siteContact } from "@/lib/page-data";

/**
 * U1 §2, and required by
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`, which
 * enumerates `layout` among the route files it checks: this file reaches
 * Postgres through `siteContact`, so it says so.
 *
 * **The reach does not propagate downward.** That test reads each route file's
 * *own* import closure, so the forty-odd pages beneath this layout are
 * unaffected — none of them acquires a marker it did not need, and the ones
 * that already carry it (every wired page under `/tu-sach/[shelf]`) carry it
 * for their own reasons, which are about a cached render leaking one shelf's
 * rows to another rather than about a footer.
 */
export const dynamic = "force-dynamic";

/**
 * The footer for every reader and manager page of a shelf (U6 §6).
 *
 * **A layout rather than forty edits**, and the difference is not only
 * typing: a page that forgets is a page with no footer, and there is nothing
 * in the type system that would say so. Two layouts and five front-door pages
 * is the whole surface, and the two layouts are the ones that cover the
 * pages nobody will remember to revisit.
 *
 * `flex min-h-dvh flex-col` with the children growing, so the footer sits at
 * the bottom of a short page rather than halfway up it. On a manager screen
 * that means below the sidebar-and-main row, full width — `ManagerShell` is
 * itself a `flex min-h-dvh` and becomes the growing child here.
 */
export default async function ShelfLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const contact = await siteContact();

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter contact={contact} />
    </div>
  );
}
