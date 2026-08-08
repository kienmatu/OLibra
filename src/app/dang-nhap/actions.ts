"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connect } from "@/db/client";
import { RuleViolated } from "@/domain/kernel/errors";
import { systemClock } from "@/domain/kernel/clock";
import { landingShelfFor } from "@/auth/guards";
import { signIn, signOut } from "@/auth/session";
import {
  SESSION_COOKIE,
  SIGN_IN_FAILED,
  cookieOptions,
} from "@/lib/session-cookie";

// A "use server" file may only export async functions, so the `?loi=`
// marker itself lives in session-cookie.ts and is only re-used here.

/**
 * Signs a reader in and drops the session cookie, or sends them back to the
 * form with an inline error (BR §17.7 — a business-rule violation is a
 * friendly message, never a thrown error or a redirect to an error page).
 *
 * `RuleViolated("sign_in_failed")` is thrown for a wrong password, an
 * unknown username and an account with no credentials at all (INV-14) alike
 * — same code, same message, same redirect, so neither case tells a caller
 * which one happened.
 */
export async function signInAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // M10: "Ghi nhớ đăng nhập" now actually does something — see cookieOptions'
  // `remember` parameter. A checkbox with no `name` is never submitted, which
  // is why the field carries one now.
  const remember = formData.get("remember") === "on";

  // M8: DATABASE.md §4.1 promises "who signed in from where" is answerable
  // from `sessions.user_agent`/`ip_address` — that was only true once these
  // were actually read and written somewhere. `x-forwarded-for` is read
  // rather than a socket address because a Next.js server action has no
  // direct client connection to read one from; whatever sits in front of
  // this deployment (compose.yaml has nothing today) is responsible for
  // setting it truthfully, the same trust boundary every `x-forwarded-for`
  // consumer has.
  const hdrs = await headers();
  const userAgent = hdrs.get("user-agent");
  const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const sql = connect();
  const outcome = await (async () => {
    try {
      const { token, userId } = await signIn(sql, {
        username,
        password,
        clock: systemClock,
        userAgent,
        ipAddress,
      });
      // IMPORTANT 6: where next depends on how many shelves this person
      // belongs to, not on a fixture. See landingShelfFor's own comment for
      // why a single admin-scoped query answers this safely.
      const shelfSlug = await landingShelfFor(sql, userId);
      return { ok: true as const, token, shelfSlug };
    } catch (err) {
      if (err instanceof RuleViolated && err.code === "sign_in_failed") {
        return { ok: false as const };
      }
      throw err;
    } finally {
      await sql.end();
    }
  })();

  // `redirect()` throws internally — kept outside the try/catch above so
  // that throw is never mistaken for a failed sign-in.
  if (!outcome.ok) {
    // M11: the username survives a failed attempt — retyping a password is
    // a reasonable ask, retyping a username too is not, for this audience.
    const params = new URLSearchParams({ loi: SIGN_IN_FAILED });
    if (username) params.set("ten", username);
    redirect(`/dang-nhap?${params.toString()}`);
  }

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    outcome.token,
    cookieOptions(process.env.NODE_ENV, remember),
  );
  redirect(outcome.shelfSlug ? `/tu-sach/${outcome.shelfSlug}` : "/tu-sach");
}

/**
 * Ends the session in the database, not only in the browser — clearing the
 * cookie alone would leave the row in `sessions` valid for anyone who still
 * has the token (e.g. a proxy log, a shared computer's history).
 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    const sql = connect();
    try {
      await signOut(sql, token);
    } finally {
      await sql.end();
    }
  }

  jar.delete(SESSION_COOKIE);
  redirect("/");
}
