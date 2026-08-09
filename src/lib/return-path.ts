/**
 * Where a person was going before they were asked to sign in, and the rules
 * for carrying it without turning the sign-in form into a redirector for
 * whoever holds the address bar.
 *
 * U2 §3.1: a guest reaching a shelf page is sent to `/dang-nhap` and lands
 * back where they were going. That round trip needs the path to survive a
 * redirect, a form post and a second redirect — which means it spends most of
 * its life in a query string, and a query string is input.
 *
 * The whole module is deliberately dependency-free: `src/proxy.ts` runs
 * in the proxy runtime (Next.js 16.3's rename of the middleware convention —
 * see that file) and imports `REQUEST_PATH_HEADER` from here, so
 * anything this file reached for would be dragged in with it.
 */

/**
 * The header `src/proxy.ts` stamps the requested path onto, and the only
 * way a Server Component in the App Router can learn what URL it is rendering.
 *
 * A page knows its `params` and its `searchParams`; it does not know its own
 * pathname, and there is no `usePathname` on the server. The alternative was to
 * have every page pass its own path into `loadPage` — which makes the redirect
 * correct exactly as often as forty-six pages remember to do it, and silently
 * degrades (a guest lands on a bare sign-in form) when one of them does not.
 * `loadPage`'s own docstring already states the standard this seam is held to:
 * "a caller cannot express a read that skipped a step". Deriving the path in
 * the seam keeps that true for the return path too.
 *
 * **A client can send this header, and that changes nothing.** The proxy
 * `set`s it on every request it sees, overwriting whatever arrived; and for a
 * request the matcher does not cover, `safeReturnPath` below still refuses
 * anything that is not a same-origin path — so the worst an attacker can do by
 * forging it is choose which page of this site they themselves are sent to
 * after signing in. The validation is what makes the header's provenance
 * uninteresting, which is the property to want, because provenance is the part
 * that is easy to be wrong about.
 *
 * Prefixed `x-olibra-` rather than reusing a conventional name like
 * `x-pathname`: a header a proxy or another library might also set is a header
 * whose meaning is shared with something that does not know about this rule.
 */
export const REQUEST_PATH_HEADER = "x-olibra-path";

/**
 * The query parameter the return path travels in.
 *
 * Vietnamese, like every other parameter this app emits (`?loi=`, `?ten=`,
 * `?tu-sach=`, `?sach=`). `tiep` is the word already in the sentence this
 * redirect exists to act on — `not_authenticated`, "Bạn cần đăng nhập để tiếp
 * tục." (`src/domain/kernel/errors.ts`) — rather than a new one invented for a
 * URL.
 */
export const RETURN_TO_PARAM = "tiep";

/**
 * The query parameter naming which shelf a front-door page is about.
 *
 * The portal has put this on every directory link since U2 (`/dang-nhap
 * ?tu-sach=<slug>`) and, until IMPORTANT 3 (fix-report,
 * 2026-08-09-u2-shelf-and-portal), **nothing read it** — the sign-in page took
 * its heading from `src/lib/fixtures.ts` instead and told every visitor, from
 * every parish, that they were signing in to Đồng Tháp. A parameter no reader
 * has is a parameter that is wrong without anybody noticing, which is why this
 * is a shared constant now rather than a string literal in the one page that
 * emits it and another in the one page that consumes it.
 */
export const SHELF_PARAM = "tu-sach";

/**
 * The shelf slug a return path is inside, or `null`.
 *
 * The other half of `SHELF_PARAM`: a visitor who followed a portal link carries
 * the slug in the query string, and a visitor `loadPage` redirected off a shelf
 * page carries it inside `?tiep=/tu-sach/<slug>/…` instead. Both know which
 * parish they are going to, so the sign-in form can name it in both cases —
 * and the redirect case is the one the finding was reproduced on
 * (`curl -L /tu-sach/vinh-long/danh-muc`).
 *
 * Takes a path that `safeReturnPath` has already accepted; every route of a
 * shelf is `/tu-sach/<slug>/…` (`src/app/tu-sach/[shelf]/`), and `/tu-sach`
 * itself is the portal, which is about no single shelf and correctly yields
 * `null` here. The slug shape is `bookshelves.slug`'s: BR:179 fixes it after
 * creation and `src/domain/kernel/fold.ts` derives it, so it is lower-case
 * alphanumerics and hyphens. Anything else is refused rather than passed to a
 * query — not because the query is unsafe (it is parameterised), but because a
 * value that cannot be a slug should not become one lookup's worth of doubt.
 */
export function shelfSlugFromReturnPath(
  returnTo: string | null | undefined,
): string | null {
  if (typeof returnTo !== "string") return null;
  const match = /^\/tu-sach\/([a-z0-9-]+)(?:\/|$)/.exec(returnTo);
  return match?.[1] ?? null;
}

/**
 * A base that no real deployment can ever be, used only to make the URL parser
 * answer the question "does this value stay on this site?".
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve.
 * Nothing is ever fetched from it; it exists so `new URL(value, base).origin`
 * has something to be compared against.
 */
const PROBE_ORIGIN = "http://olibra.invalid";

/**
 * Long enough for any real path in this app, short enough that a redirect
 * cannot be used to push kilobytes through a `Location` header or a form
 * field. Every route in `src/app/` is well under a hundred characters; the
 * search string a catalogue page carries is the only variable part.
 */
const MAX_LENGTH = 512;

/**
 * A path this app is willing to send somebody to, or `null`.
 *
 * Two failures to refuse, and they fail differently:
 *
 * - **An open redirect.** `?tiep=https://evil.example` — or `//evil.example`,
 *   which is protocol-relative and reads as an absolute URL to every browser
 *   while looking like a path to a `startsWith("/")` check. A sign-in form
 *   that honours either one is a credential-phishing primitive with this
 *   project's domain in front of it: the victim signs in on the real site and
 *   is handed to somebody else's.
 * - **A value that is not a path at all.** `redirect()` takes whatever it is
 *   given, and a malformed one surfaces as an exception from inside a render.
 *   OPS §2's "a command never fails with a bare 500 or an unstructured
 *   exception" applies to a hand-edited URL exactly as it does to a
 *   hand-edited form field.
 *
 * The origin comparison is what actually decides it, rather than a list of
 * prefixes to forbid. A denylist of `//`, `/\`, `https:` and the rest is a
 * guess about how many spellings of "somewhere else" exist; the URL parser
 * already knows all of them, including the ones this project has not thought
 * of — `/\evil.example` resolves to `http://evil.example` under the WHATWG
 * rules browsers implement, because a backslash is a path separator there, and
 * a hand-written check that had not heard of that would pass it through.
 *
 * The checks in front of it are the cases where asking the parser is the wrong
 * question rather than a redundant one: a value that does not begin with `/`
 * is a *relative* path, which resolves against the probe origin perfectly well
 * and then means something different depending on which page the redirect is
 * issued from; and a control character is refused before it can reach a
 * `Location` header, where a bare CR or LF is a response-splitting primitive
 * regardless of what the path after it says.
 *
 * Returns `pathname + search`, not the caller's string: the parser has already
 * normalised `..` segments and percent-encoding, and returning its answer
 * rather than the input means what is validated is what is used. The fragment
 * is dropped because a browser never sends one to a server, so a `#` here
 * could only have been typed by hand.
 *
 * **That last invariant did not hold, and `safeReturnPath` below is where it is
 * repaired** (IMPORTANT 6, fix-report, 2026-08-09-u2-shelf-and-portal). The
 * origin check runs on the resolution of the *input*, and the string returned
 * is the *post-normalisation* one — and normalisation can carry a value back
 * across the boundary the check just cleared:
 *
 * ```
 * resolveReturnPath("/..//evil.example")       -> "//evil.example"
 * resolveReturnPath("/a/..//evil.example")     -> "//evil.example"
 * resolveReturnPath("/..//user@evil.example/") -> "//user@evil.example/"
 * ```
 *
 * `/..` pops nothing off the root and is dropped, leaving a leading `//`, which
 * is protocol-relative: `new URL("//evil.example", "https://olibra.example
 * /dang-nhap").href` is `https://evil.example/`. Each of those three is a value
 * this function *returned* and would itself *refuse*, which is "what is
 * validated is what is used" being false in the one direction that matters.
 *
 * Not exploitable as the app is wired. `dang-nhap/page.tsx` normalises before
 * rendering the hidden field, so the form carries the already-refused form, and
 * reaching `signInAction` with the raw value needs a cross-origin POST to a
 * Server Action, which Next.js blocks. What was broken is the contract of the
 * function whose whole job is to be the last line — and `actions.ts`'s comment
 * calls its own second check redundant on the strength of that contract.
 */
function resolveReturnPath(value: string): string | null {
  if (value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;

  return `${url.pathname}${url.search}`;
}

/**
 * A path this app is willing to send somebody to, or `null` — see
 * `resolveReturnPath` above for the whole of what is refused and why.
 *
 * **The answer is put back through the check, and that is the whole of the
 * addition.** `resolveReturnPath` decides on its input and returns the
 * normalised form; those are not the same string, so deciding on one and
 * returning the other is exactly the gap. Running it a second time on its own
 * output and insisting the two agree is the invariant written as code instead
 * of as a sentence: `/..//evil.example` normalises to `//evil.example`, the
 * second pass refuses that outright, the two disagree, and the value is
 * refused.
 *
 * A fixed-point check rather than one more rule ("refuse a pathname beginning
 * `//`"), for the reason the origin comparison is already preferred to a
 * denylist above: a rule is a guess about how many spellings of "somewhere
 * else" survive normalisation, and this is the property itself. Whatever a
 * future change to the URL parser makes normalisation do, what comes back is
 * still something this function accepts — because it just asked it.
 *
 * Two passes, not a loop, and the loop would be theatre: every output begins
 * with `/`, and re-normalising an already-normalised path is the identity
 * unless it begins `//`, which the second pass rejects rather than rewrites.
 * `tests/lib/return-path.test.ts` asserts the property directly over the whole
 * attack corpus rather than trusting that argument.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const resolved = resolveReturnPath(value);
  if (resolved === null) return null;
  return resolveReturnPath(resolved) === resolved ? resolved : null;
}

/**
 * The sign-in URL to send a guest to, carrying where they were going when it
 * is somewhere this app is willing to send them back to.
 *
 * A refused return path is not an error the visitor should see: they are being
 * sent to sign in either way, and the only difference is whether the form
 * remembers their destination. Dropping it silently lands them on
 * `/dang-nhap`, and `signInAction` then sends them to their own shelf if they
 * belong to exactly one (`landingShelfFor`) — which for a member of one parish
 * is where they were going anyway.
 */
export function signInPathFor(returnTo: string | null | undefined): string {
  const safe = safeReturnPath(returnTo);
  if (!safe) return "/dang-nhap";
  return `/dang-nhap?${RETURN_TO_PARAM}=${encodeURIComponent(safe)}`;
}
