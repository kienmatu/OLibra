import Link from "next/link";
import { Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FrontDoorHeader, ShelfHeader } from "@/components/shell/public-header";
import { messageFor } from "@/domain/kernel/errors";
import { findPublicShelf } from "@/domain/portal/queries/find-public-shelf";
import { loadPublicPage } from "@/lib/page-data";
import {
  RETURN_TO_PARAM,
  SHELF_PARAM,
  safeReturnPath,
  shelfSlugFromReturnPath,
} from "@/lib/return-path";
import { ACTION_ERROR_PARAM, param, type SearchParams } from "@/lib/search-params";
import { SIGN_IN_FAILED } from "@/lib/session-cookie";
import { signInAction } from "./actions";

/**
 * U1 §2. This page reads the database now (`findPublicShelf`), and the shelf it
 * names comes out of the query string, so a cached render would show one
 * parish's visitor another parish's name — the exact defect this page is being
 * fixed for, reintroduced by the cache instead of by a fixture.
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` is what
 * enforces it.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  // Not a record of optional strings: `?ten=a&ten=b` arrives as an array, and
  // this page hands two of these straight to React. See `@/lib/search-params`.
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const loi = param(search, ACTION_ERROR_PARAM);
  const ten = param(search, "ten");
  /**
   * Where this visitor was going when `loadPage` sent them here (U2 §3.1).
   *
   * Validated on the way in as well as on the way out, because between the two
   * it is rendered into a form field: a value that reached
   * `signInAction`'s `redirect` would be refused there anyway, but a value
   * that failed only there would have been shown to the visitor as if the site
   * intended to send them to it. `safeReturnPath` is one rule in one place —
   * see `src/lib/return-path.ts` for what it refuses and why.
   */
  const returnTo = safeReturnPath(param(search, RETURN_TO_PARAM));

  /**
   * Which parish this visitor is signing in to, or `null` if nothing says.
   *
   * IMPORTANT 3 (fix-report, 2026-08-09-u2-shelf-and-portal). This header used
   * to render `shelf.name` from `src/lib/fixtures.ts`, which is always Đồng
   * Tháp. Confirmed live: `curl -L /tu-sach/vinh-long/danh-muc` follows U2's
   * new redirect and lands on a sign-in page headed "Tủ sách Đồng Tháp", and
   * the same for Cần Thơ and Bến Tre. The fixture header pre-dates this slice;
   * what U2 changed is that *every* shelf page now redirects here, so a
   * mismatch that used to be unreachable became the ordinary path.
   *
   * Two sources, because there are two ways in and each carries the answer in
   * a different place: the portal puts `?tu-sach=<slug>` on every directory
   * link (`src/app/tu-sach/page.tsx`), and `loadPage`'s redirect puts the shelf
   * page's own path in `?tiep=`. `SHELF_PARAM` wins when both are present —
   * it is the more direct statement of intent, and the two agree on every
   * journey that produces both.
   *
   * **The slug is not trusted to be a name.** It is looked up, and only a row
   * that comes back — active, undeleted, through the same guest-callable path
   * and the same least-privileged role as the portal directory itself — is
   * rendered. A hand-typed `?tu-sach=` naming nothing yields `null` and the
   * front-door header, not a heading of the visitor's own choosing.
   */
  const shelfSlug = param(search, SHELF_PARAM) ?? shelfSlugFromReturnPath(returnTo);
  const shelf = shelfSlug
    ? await loadPublicPage((tx) => findPublicShelf(tx, { slug: shelfSlug }))
    : null;

  // The same generic sentence for a wrong password, an unknown username and
  // an account with no credentials at all (INV-14) — neither case should
  // tell a visitor which one happened. `sign_in_failed`, not
  // `not_authenticated`: that code's sentence is "you need to sign in to
  // continue", written for a stranger reaching a page that requires a
  // session, not for someone who just tried and failed (IMPORTANT 3).
  const signInError =
    loi === SIGN_IN_FAILED ? messageFor("sign_in_failed") : undefined;

  return (
    <>
      {/* No viewer, by definition: this is the form somebody fills in because
          they are not signed in. The header then shows the shelf's name and a
          "Đăng nhập" button instead of member navigation — see `ShelfHeader`
          for why the member links are withheld rather than merely inert.

          Nothing named a shelf — somebody typed `/dang-nhap`, or followed the
          front door's own "Đăng nhập" button — so there is no parish to name
          and the front-door header is the honest one. Naming a shelf anyway is
          what this page did before, and it named the wrong one. */}
      {shelf ? (
        <ShelfHeader
          shelfName={shelf.name}
          shelfSlug={shelf.slug}
          viewerName={null}
        />
      ) : (
        <FrontDoorHeader viewerName={null} isSuperAdmin={false} />
      )}

      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20">
        <div className="w-full max-w-[440px] rounded-card border border-hairline bg-surface p-8">
          <h1 className="text-[28px] leading-tight font-semibold">Đăng nhập</h1>
          <p className="mt-1.5 text-meta">
            {/* The catalogue's own sentence for this exact situation, not one
                written here: `errors.ts` pairs `not_authenticated` with "Bạn
                cần đăng nhập để tiếp tục." and says in the same breath that it
                is "shown when a stranger reaches a page that requires a
                session" — which is precisely who arrives with a return path.
                `errors.ts:11-16`: a screen calls `ERROR_MESSAGES[code]` rather
                than writing its own wording for a rule it did not define. */}
            {returnTo
              ? messageFor("not_authenticated")
              : "Đăng nhập để xem sách bạn đang mượn và xin mượn sách mới."}
          </p>

          <form action={signInAction} className="mt-8 space-y-6">
            {/* Where to go back to, carried across the post. Rendered only
                when `safeReturnPath` accepted it, so the form never offers
                `signInAction` a value that function would have to refuse —
                it refuses it again anyway, because a form field is input.

                First, and it has to be somewhere the spacing cannot see. This
                Tailwind (4.3.3) compiles `space-y-*` to
                `:where(& > :not(:last-child))` with `margin-block-end` — read
                out of `node_modules/tailwindcss/dist/lib.js`, not assumed from
                v3's `> :not([hidden]) ~ :not([hidden])`. So a `display: none`
                input in first position is handed a margin that has nothing to
                apply to, while the same input in *last* position would push
                the submit button's own 24px gap back into the layout. */}
            {returnTo ? (
              <input type="hidden" name={RETURN_TO_PARAM} value={returnTo} />
            ) : null}
            <Field label="Tên đăng nhập" required htmlFor="ten-dang-nhap">
              <Input
                id="ten-dang-nhap"
                name="username"
                icon={User}
                placeholder="vd: lan.nguyen"
                // M11: a failed attempt used to lose whatever was typed here.
                defaultValue={ten}
              />
            </Field>

            <Field label="Mật khẩu" required htmlFor="mat-khau" error={signInError}>
              <Input
                id="mat-khau"
                name="password"
                type="password"
                icon={Lock}
                invalid={Boolean(signInError)}
              />
            </Field>

            <div className="flex items-center justify-between gap-4">
              <label className="inline-flex min-h-11 items-center gap-2 text-[15px]">
                <input
                  type="checkbox"
                  name="remember"
                  className="size-[18px] rounded-control border-hairline accent-sage"
                />
                Ghi nhớ đăng nhập
              </label>
              <Link
                href="#"
                className="inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
              >
                Quên mật khẩu?
              </Link>
            </div>

            <Button type="submit" variant="primary" size="lg" className="w-full">
              Đăng nhập
            </Button>
          </form>

          <div className="mt-8 border-t border-hairline pt-6 text-center text-[15px]">
            <span className="text-meta">Chưa có tài khoản? </span>
            {/* The shelf travels with the link when this page knows one, so a
                visitor who followed a portal link into their own parish's
                sign-in lands on their own parish's form. Without it `/dang-ky`
                asks them to choose, which is the honest answer when nothing on
                this request names a shelf. */}
            <Link
              href={
                shelf
                  ? `/dang-ky?tu-sach=${encodeURIComponent(shelf.slug)}`
                  : "/dang-ky"
              }
              className="font-medium text-sage hover:underline"
            >
              Đăng ký tài khoản mới
            </Link>
          </div>
        </div>

        {/* **The keeper's name and phone number are gone from this page, not
            corrected to the right parish's** (IMPORTANT 3). The line read
            "Quên mật khẩu thì nhắn cho quản lý tủ sách — cô {keeper} {phone}",
            with the number as a live `tel:` link, on a page with no session —
            which is the exact pair §3.2 of this slice's plan argues the portal
            must withhold, and that `readShelfIdentity` gates behind
            `requireReader`. BR §16.1 puts keeper contact on the shelf's *own*
            page, which is member-only: "a person with no membership has no
            business knowing them." A stranger one hop from the portal is
            precisely that person, so there is nothing to render here for them
            and no wording that would make it acceptable.

            Deliberately not replaced with a shelf-less alternative ("liên hệ
            ban quản trị", say). That is new Vietnamese, and the sentence it
            would replace is one nobody can act on without a phone number
            anyway; `/lien-he` is already in the front door's footer and is
            where site-wide contact belongs (OPS §3.1's `GetSiteContact`).
            "Quên mật khẩu?" above the button is a real screen a later slice
            owes; inventing a stopgap sentence here would be one more thing for
            it to unpick. */}
      </main>
    </>
  );
}
