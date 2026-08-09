import { type NextRequest, NextResponse } from "next/server";
import { REQUEST_PATH_HEADER } from "./lib/return-path";

/**
 * Stamps the requested path onto the request, so the page-data seam can send a
 * guest to sign in and back again.
 *
 * **Why the app has middleware at all, when it had none.** U2 §3.1 requires
 * that a guest reaching a shelf page lands on `/dang-nhap` and returns to where
 * they were going. A Server Component in the App Router is handed `params` and
 * `searchParams` and is not told its own URL; there is no server equivalent of
 * `usePathname`. The two ways to close that are for every page to pass its own
 * path into `loadPage`, or for the request to carry it. The first makes the
 * redirect correct only where somebody remembered — forty-one pages are still
 * to be wired, and a page that forgets produces no error, just a visitor
 * deposited on a bare sign-in form. `src/lib/page-data.ts` is built on the
 * opposite principle ("a caller cannot express a read that skipped a step"),
 * so the path is derived once, here, where no page can leave it out.
 *
 * **It does nothing else, deliberately.** No session lookup, no redirect, no
 * authorisation. Every access decision in this project is made in Postgres by
 * RLS and in the domain by `requireReader`/`requireManager`, and BR §13.3 is
 * explicit that the interface is never the security control. Middleware that
 * started deciding who may see what would be a fourth answer to that question,
 * running before the database is consulted and with no transaction to be
 * consistent with. It also cannot reach the database: this runs in the
 * middleware runtime, where `postgres.js` does not, which is a good reason to
 * keep the responsibility exactly this small.
 *
 * `NextResponse.next({ request: { headers } })` rewrites the *request* headers
 * the route then sees; the header never reaches the browser. `set` overwrites,
 * so a client sending `x-olibra-path` of its own has it discarded for every
 * request the matcher covers — and for anything it does not cover,
 * `safeReturnPath` still refuses everything except a same-origin path. See
 * `src/lib/return-path.ts` for why that makes the header's provenance
 * uninteresting rather than merely unlikely to be abused.
 *
 * The search string is included because it is part of where somebody was
 * going: a volunteer who typed a search and was asked to sign in should get
 * their results back, not an empty form.
 */
export function middleware(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(
    REQUEST_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.next({ request: { headers } });
}

/**
 * Everything except the framework's own asset routes.
 *
 * `_next/static` and `_next/image` are served from the build output and never
 * render a page, so running on them is pure cost on every image and every
 * chunk. `favicon.ico` is the same. Nothing else is excluded: a route added
 * later should be covered by default, because the failure of *not* being
 * covered — a guest redirected to a sign-in form that forgot where they were
 * going — is silent, and the failure of being covered needlessly is a header
 * nobody reads.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
