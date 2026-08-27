/**
 * Everything about how the session token is carried in the browser, kept in
 * one place so `dang-nhap/actions.ts` and the sign-out path agree on it.
 */
export const SESSION_COOKIE = "olibra_session";

/**
 * The `?loi=` marker `dang-nhap/actions.ts` redirects to on a failed sign-in.
 * A marker, not the message text itself: the page looks the actual Vietnamese
 * sentence up from the domain's own error catalogue (`messageFor`), so the
 * URL never carries anything but this fixed code.
 */
export const SIGN_IN_FAILED = "khong_dang_nhap_duoc";

/**
 * `remember` (default `true`) is M10/"Ghi nhớ đăng nhập": when the box is
 * left unchecked, the cookie carries no `maxAge` at all, which makes it a
 * session cookie the browser discards on close — the standard meaning of an
 * unchecked "remember me". The underlying row in `sessions` still lives for
 * `SESSION_DAYS` either way (`src/auth/session.ts`); this only controls how
 * long the *browser* holds on to the cookie naming it.
 */
export function cookieOptions(env = process.env.NODE_ENV, remember = true) {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: a volunteer following a link to the shelf
    // from a Zalo message should arrive signed in. `strict` would sign them
    // out on every inbound link, which reads as the site being broken.
    sameSite: "lax" as const,
    // Not in development, or nobody can sign in over http on localhost — and
    // the first response to that is to disable the flag everywhere.
    secure: env === "production",
    path: "/",
    ...(remember ? { maxAge: 30 * 86_400 } : {}),
  };
}
