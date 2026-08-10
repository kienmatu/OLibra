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
export default async function DonationRedirect({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf } = await params;
  redirect(`/tu-sach/${encodeURIComponent(shelf)}/ho-so/tang-sach`);
}
