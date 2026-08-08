"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SERVER_FAULT } from "@/lib/error-states";

/**
 * What a volunteer sees when a page throws (BR §17.7).
 *
 * **A client component, because an error boundary has to be one.** React
 * recovers by re-rendering, and `reset` is a function the framework hands the
 * boundary — neither survives serialisation, so `error.tsx` and
 * `global-error.tsx` are both `"use client"` and this is the markup they share.
 *
 * The layout is `src/app/not-found.tsx`'s, deliberately: a centred `main`, the
 * icon at 48px, the heading at 28px, one primary action and a quiet way back.
 * That page is the only other full-screen error this project has routed to, and
 * a fault should not look like it came from somewhere else. The words are
 * `SERVER_FAULT`'s, which is the same object `loi/page.tsx` prints on its
 * reference sheet — see `src/lib/error-states.ts`.
 *
 * **No stack, no digest, no error message.** In production Next redacts the
 * message and hands over an opaque `digest` instead; printing it would put a
 * hex string in front of a child with no Vietnamese to explain it, and every
 * sentence on this screen has to come from `docs/` or `ERROR_MESSAGES` rather
 * than be invented here. The fault itself is already on the server's log, which
 * is where "Ban quản trị đã được báo và đang xem." points.
 */
export function ServerFault({ reset }: { reset: () => void }) {
  const { icon: Icon, heading, body, action } = SERVER_FAULT;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24 text-center">
      <Icon aria-hidden className="mb-6 size-12 text-brick" strokeWidth={1.5} />

      <h1 className="text-[28px] leading-tight font-semibold">{heading}</h1>
      <p className="mt-3 max-w-sm text-[16px] text-meta">{body}</p>

      {/* `reset()` re-renders the segment that threw. On a transient fault —
          a dropped connection, a restart mid-request — that is genuinely the
          whole fix, which is why "Thử lại" is the primary action rather than
          decoration on a dead end. */}
      <Button
        type="button"
        variant="primary"
        size="lg"
        className="mt-8"
        onClick={reset}
      >
        {action}
      </Button>

      {/* BR §17.7's "route back to safety", for the fault that does not clear.
          The wording is `not-found.tsx`'s, which is the same journey. */}
      <Link
        href="/tu-sach"
        className="mt-5 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
      >
        Về trang tủ sách
      </Link>
    </main>
  );
}
