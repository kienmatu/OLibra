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

export function cookieOptions(env = process.env.NODE_ENV) {
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
    maxAge: 30 * 86_400,
  };
}
