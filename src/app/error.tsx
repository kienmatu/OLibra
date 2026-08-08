"use client";

import { ServerFault } from "@/components/server-fault";

/**
 * The route-level error boundary — the page a server fault actually renders.
 *
 * **Newly load-bearing.** Before U1 no page in this app could reach Postgres,
 * so no page could 500, and `src/app/loi/page.tsx`'s server-failure panel was a
 * reference sheet nothing routed to. Six screens now run SQL on every render.
 * Measured in production before this file existed: a fault rendered Next.js's
 * own default — "This page couldn't load / A server error occurred." with a
 * black Reload button, in English, in a parish system whose entire interface is
 * Vietnamese. BR §17.7 requires otherwise, and had done all along; nothing had
 * been able to reach the requirement until now.
 *
 * It sits at `src/app/error.tsx` rather than beside the lending screens because
 * the rule is not about lending: any of the forty-one pages wired in a later
 * slice gains the same failure mode the day it gains its first query, and a
 * boundary placed per-flow is one somebody forgets to copy. Next resolves the
 * nearest boundary above the segment that threw, so one at the root covers
 * everything and a flow that later wants its own can still add one.
 *
 * **What it does not catch**, stated so the gap is not mistaken for coverage:
 * a throw in the root `layout.tsx` itself (that is `global-error.tsx`, beside
 * this file), and `notFound()`, which is not a fault at all — it is
 * `src/app/not-found.tsx`, and U1 §3.4's answer for a reader who reached a
 * manager URL depends on it staying that way.
 */
export default function AppError({ reset }: { reset: () => void }) {
  return <ServerFault reset={reset} />;
}
