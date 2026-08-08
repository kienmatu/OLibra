"use client";

import { ServerFault } from "@/components/server-fault";
import "./globals.css";

/**
 * The boundary of last resort: a throw in the root layout itself.
 *
 * `error.tsx` beside this file renders *inside* `layout.tsx`, so it cannot
 * catch the layout failing. This one replaces the layout outright, which is why
 * it has to supply its own `<html>` and `<body>` — the pair Next would
 * otherwise have rendered is exactly what is missing.
 *
 * **It carries the stylesheet and not the fonts.** `globals.css` is an ordinary
 * import and comes along. `next/font` cannot: the loader only runs in a Server
 * Component and this file is necessarily `"use client"`, so `--font-lexend` and
 * `--font-literata` are unset here and the page falls back to the system stack.
 * That is the honest trade for a screen that only appears when the layout that
 * defines those fonts is the thing that broke, and it is still Vietnamese, on
 * the right background, saying the right sentence.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <ServerFault reset={reset} />
      </body>
    </html>
  );
}
