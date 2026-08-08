import Link from "next/link";
import { Lock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { ShelfHeader } from "@/components/shell/public-header";
import { messageFor } from "@/domain/kernel/errors";
import { shelf } from "@/lib/fixtures";
import { SIGN_IN_FAILED } from "@/lib/session-cookie";
import { signInAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ loi?: string; ten?: string }>;
}) {
  const { loi, ten } = await searchParams;
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
      <ShelfHeader shelf={shelf} />

      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20">
        <div className="w-full max-w-[440px] rounded-card border border-hairline bg-surface p-8">
          <h1 className="text-[28px] leading-tight font-semibold">Đăng nhập</h1>
          <p className="mt-1.5 text-meta">
            Đăng nhập để xem sách bạn đang mượn và xin mượn sách mới.
          </p>

          <form action={signInAction} className="mt-8 space-y-6">
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
