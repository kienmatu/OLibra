/**
 * The application's startup hook — a `node`-layer warm-up, not the wiring
 * itself.
 *
 * This used to be the one place `src/domain/members/registration.ts`'s
 * injected setters were actually set, on the theory that `register()` runs
 * once per server process, before any request, which is what a composition
 * root has to be. **It was not**, and the reason is Turbopack layering rather
 * than anything wrong with that reasoning in isolation: Next builds this file
 * into the `node` layer and every server action into the `react-server`
 * layer, and a module imported by both — `src/domain/kernel/crypto.ts`
 * (formerly the setters living directly in `registration.ts`) — is bundled
 * into both, as two separate instances with two separate copies of every
 * module-level binding. Calling `setPasswordHasher` here wired only the
 * `node` layer's copy; `registerMembershipAction` ran in the `react-server`
 * layer's copy, which stayed at its throwing default for the life of the
 * process. Confirmed live by a QA sweep on 10/08/2026: this file's own
 * startup log reported the hasher wired while `POST /dang-ky` 500'd for
 * every reader who supplied a username and password, `NotWired` all the way
 * up the stack from `hasher` in `registration.ts`.
 *
 * **The fix is `src/lib/page-data.ts`.** Its four entry points —
 * `loadPage`, `loadPublicPage`, `submitCommand`, `submitAdminCommand` — each
 * call `ensureCryptoWired()` as their first statement, which is what
 * guarantees the request path: whichever layer's copy of `crypto.ts` a given
 * request actually runs in, that copy wires itself on its own first call,
 * rather than depending on a different layer having already done it.
 *
 * This file still calls the same function, belt-and-braces: it warms the
 * `node` layer before the first request arrives, which is a real (if small)
 * saving of one `import()` on a cold start, and it is harmless — the port
 * being wired earlier via this function does not stop `page-data.ts` also
 * getting to check the idempotent flag on `wired` the way it does for every
 * other request. It is no longer the mechanism the request path depends on
 * being correct.
 *
 * **Why a gap here goes unnoticed for so long in the product** — this bug
 * and the one before it (`grep -rn setPasswordHasher src` once returned
 * three comments *about* wiring and no call at all) — is recorded in
 * `src/domain/kernel/crypto.ts`'s own docstring, not repeated here: in
 * short, registration without credentials never reaches `hashFor`, and
 * sign-in verifies through `src/auth/session.ts` directly rather than
 * through this port, so the one path that ever needed it wired was
 * "somebody types a password" — the path nobody had tried.
 *
 * The `nodejs` guard is Next's documented shape: this file is also loaded in
 * the edge runtime, where `@node-rs/argon2` is a native addon that cannot
 * load. No route in this application runs on edge, so the guard is about the
 * bundler rather than about behaviour.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureCryptoWired } = await import("./lib/crypto-wiring");
  await ensureCryptoWired();
}
