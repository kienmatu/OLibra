import { SiteFooter } from "@/components/shell/site-footer";
import { siteContact } from "@/lib/page-data";

/**
 * U1 §2, and required by
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts`, which
 * enumerates `layout` among the route files it checks — see the twin at
 * `src/app/tu-sach/[shelf]/layout.tsx` for why the reach does not propagate to
 * the pages beneath.
 */
export const dynamic = "force-dynamic";

/**
 * The footer for the seven administration screens (U6 §6).
 *
 * A super admin reading their own contact block in the footer is not the
 * strange case it first looks like: it is the only place in the application
 * that shows what a stranger on `/lien-he` will read, which makes an unfilled
 * block visible to the one person who can fill it in.
 */
export default async function AdminLayout({
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
