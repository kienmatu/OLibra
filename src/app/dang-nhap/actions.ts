"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason
// `src/app/tu-sach/[shelf]/quan-ly/actions.ts` and `src/lib/page-data.ts` both
// record: `tests/lib/sign-in-return-path.test.ts` imports this module and
// Vitest resolves no alias. U2 §3.1 makes this function the last thing between
// a hand-edited `?tiep=` and a redirect off this site, and that refusal is only
// worth writing down if it is the *shipped* function a test can reach.
import { pool } from "../../db/client";
import { RuleViolated } from "../../domain/kernel/errors";
import { systemClock } from "../../domain/kernel/clock";
import { isSuperAdminUser, landingShelfFor } from "../../auth/guards";
import { signIn, signOut } from "../../auth/session";
import { RETURN_TO_PARAM, safeReturnPath } from "../../lib/return-path";
import {
  SESSION_COOKIE,
  SIGN_IN_FAILED,
  cookieOptions,
} from "../../lib/session-cookie";

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
  /**
   * Where `loadPage` was sending this person before it asked them to sign in
   * (U2 §3.1), carried through the form by `dang-nhap/page.tsx`.
   *
   * Validated here even though the page validated it before rendering the
   * field. A form field is input: `formData` is whatever was posted, and
   * nothing about having been rendered by this app is checkable at this end.
   * This is the call site that actually hands a value to `redirect`, so this
   * is the one that has to be right — `safeReturnPath` refuses an absolute
   * URL, a protocol-relative one and anything that is not a path at all, which
   * is what stands between a sign-in form and being a redirector to somebody
   * else's site (see `src/lib/return-path.ts`).
   */
  const returnTo = safeReturnPath(String(formData.get(RETURN_TO_PARAM) ?? ""));

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

  // U1: the process-wide pool, not a connection of this action's own. It is
  // never `end()`ed — see `pool()` — which is why the `finally` that used to
  // sit on the try below is gone rather than moved: closing it here would
  // close it for every page render too.
  const sql = pool();
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
      /**
       * Task 6 (2026-08-10 QA remediation): a super admin belongs to no
       * shelf by design (`landingShelfFor`'s own docstring), so without this
       * a fresh install's only administrator resolved to `shelfSlug: null`
       * exactly like a reader belonging to none, and landed on the empty
       * portal with no route into `/quan-tri` short of typing the URL.
       *
       * Checked only when `shelfSlug` is null — a member of exactly one
       * shelf is already answered, and `isSuperAdminUser` is a query this
       * branch has no use for.
       */
      const isSuperAdmin = shelfSlug ? false : await isSuperAdminUser(sql, userId);
      return { ok: true as const, token, shelfSlug, isSuperAdmin };
    } catch (err) {
      if (err instanceof RuleViolated && err.code === "sign_in_failed") {
        return { ok: false as const };
      }
      throw err;
    }
  })();

  // `redirect()` throws internally — kept outside the try/catch above so
  // that throw is never mistaken for a failed sign-in.
  if (!outcome.ok) {
    // M11: the username survives a failed attempt — retyping a password is
    // a reasonable ask, retyping a username too is not, for this audience.
    const params = new URLSearchParams({ loi: SIGN_IN_FAILED });
    if (username) params.set("ten", username);
    // The destination survives a failed attempt too — otherwise a mistyped
    // password quietly turns "back to where you were going" into "back to the
    // front door", which reads as the link having been wrong rather than the
    // password.
    if (returnTo) params.set(RETURN_TO_PARAM, returnTo);
    redirect(`/dang-nhap?${params.toString()}`);
  }

  const jar = await cookies();
  jar.set(
    SESSION_COOKIE,
    outcome.token,
    cookieOptions(process.env.NODE_ENV, remember),
  );
  /**
   * The page they were trying to reach wins over `landingShelfFor` — and,
   * as of Task 6, over the super-admin destination below it too. Not a
   * contradiction of IMPORTANT 6: that rule answers "where should a
   * freshly-signed-in person land when nothing else says", and a return path
   * is something else saying. It can perfectly well be a shelf they turn out
   * not to belong to — someone who followed a portal link to the wrong parish
   * — and `loadPage` answers that with a 404 rather than sending them back
   * here, which is what keeps this from being a loop (see that function's
   * docstring, and `tests/lib/page-data.test.ts`, which walks the round trip).
   */
  if (returnTo) redirect(returnTo);
  if (outcome.shelfSlug) redirect(`/tu-sach/${outcome.shelfSlug}`);
  // Task 6: the portal was every super admin's landing page until now,
  // fresh install or not — indistinguishable there from a reader who belongs
  // to no shelf, which is still exactly where that reader lands.
  redirect(outcome.isSuperAdmin ? "/quan-tri" : "/tu-sach");
}

/**
 * Ends the session in the database, not only in the browser — clearing the
 * cookie alone would leave the row in `sessions` valid for anyone who still
 * has the token (e.g. a proxy log, a shared computer's history).
 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Same pool, same reason (see `signInAction` above): shared and never
  // closed, so there is nothing here to unwind in a `finally`.
  if (token) await signOut(pool(), token);

  jar.delete(SESSION_COOKIE);
  redirect("/");
}
