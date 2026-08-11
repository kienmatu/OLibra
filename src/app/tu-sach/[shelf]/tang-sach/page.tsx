import { redirect } from "next/navigation";

/**
 * **Two donation pages existed, and only one of them should.**
 *
 * The fixture era shipped `/tu-sach/[shelf]/tang-sach` and
 * `/tu-sach/[shelf]/toi/tang-sach` (now `/tu-sach/[shelf]/ho-so/tang-sach` —
 * Task 7, 2026-08-10 QA remediation) as separate screens for the same act: a
 * reader offering books. U4 wired the second, because OPS §3.2's `GetMyDonations`
 * is scoped to `ctx.actor.membershipId` — the list of *my* offers and what
 * happened to each — which puts it under `ho-so/` with the reader's other pages
 * and behind the reader tabs. That left this one rendering invented rows beside
 * a real one, reachable from a bookmark.
 *
 * Deleting the route would 404 anyone holding that address, which is the wrong
 * answer for a URL this application itself published. A redirect keeps it
 * working and leaves exactly one screen to maintain.
 *
 * `permanent: false`. The path is a product decision rather than a fact about
 * the resource, and a 308 is cached by browsers indefinitely — a later slice
 * that wanted a public, non-reader-facing donation page would have to fight
 * every visitor's cache to get this URL back.
 */
// Never actually shipped to a browser — this page redirects before any
// content, `generateMetadata` included, would render — but the guard test
// requires every `page.tsx` to declare one, and a static object costs nothing
// on a route that exists only to 308 elsewhere. Matches the destination's own
// tab identity (`ho-so/tang-sach/page.tsx`) so a build that briefly served
// this page's own metadata before Next.js applied the redirect would not read
// as a step backwards.
export const metadata = { title: "Tặng sách cho tủ sách — OLibra" };

export default async function DonationRedirect({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf } = await params;
  redirect(`/tu-sach/${encodeURIComponent(shelf)}/ho-so/tang-sach`);
}
