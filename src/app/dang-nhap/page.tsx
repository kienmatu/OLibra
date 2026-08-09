import Link from "next/link";
import { Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
import { messageFor } from "@/domain/kernel/errors";
import { shelf } from "@/lib/fixtures";
import { RETURN_TO_PARAM, safeReturnPath } from "@/lib/return-path";
import { ACTION_ERROR_PARAM, param, type SearchParams } from "@/lib/search-params";
import { SIGN_IN_FAILED } from "@/lib/session-cookie";
import { signInAction } from "./actions";

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
          for why the member links are withheld rather than merely inert. */}
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelf.slug}
        viewerName={null}
      />

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
            <Link href="/dang-ky" className="font-medium text-sage hover:underline">
              Đăng ký tài khoản mới
            </Link>
          </div>
        </div>

        <p className="mt-6 max-w-md text-center text-[14px] text-meta">
          Quên mật khẩu thì nhắn cho quản lý tủ sách — cô {shelf.keeper}{" "}
          <PhoneLink phone={shelf.phone} size="sm" className="align-baseline" />
        </p>
      </main>
    </>
  );
}
