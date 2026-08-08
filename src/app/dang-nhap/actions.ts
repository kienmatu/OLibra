"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connect } from "@/db/client";
import { RuleViolated } from "@/domain/kernel/errors";
import { systemClock } from "@/domain/kernel/clock";
import { signIn, signOut } from "@/auth/session";
import { shelf } from "@/lib/fixtures";
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
 * `RuleViolated("not_authenticated")` is thrown for both a wrong password
 * and an account with no credentials at all (INV-14) — same code, same
 * message, same redirect, so neither case tells a caller which one happened.
 */
export async function signInAction(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const sql = connect();
  const outcome = await (async () => {
    try {
      const { token } = await signIn(sql, {
        username,
        password,
        clock: systemClock,
      });
      return { ok: true as const, token };
    } catch (err) {
      if (err instanceof RuleViolated && err.code === "not_authenticated") {
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
    redirect(`/dang-nhap?loi=${SIGN_IN_FAILED}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, outcome.token, cookieOptions());
  redirect(`/tu-sach/${shelf.slug}`);
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
