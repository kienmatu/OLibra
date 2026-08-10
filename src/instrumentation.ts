/**
 * The application's composition root — the one place the domain's injected
 * setters are actually set.
 *
 * `src/domain/members/registration.ts` takes a `PasswordHasher` and a verifier
 * through `setPasswordHasher` / `setPasswordVerifier`, because Argon2id lives in
 * `src/auth/password.ts` and `tests/architecture/boundaries.test.ts` forbids
 * `src/domain` importing it. Both default to throwing `NotWired`, deliberately:
 * "an unwired hasher must fail loudly rather than write a plausible-looking
 * string into `password_hash`, where nobody would notice until someone tried to
 * sign in."
 *
 * **Until U5, nothing in the running application called either setter.** The
 * test suite calls them in its own setup, so every command that hashes a
 * password was green; `grep -rn setPasswordHasher src` returned three comments
 * *about* the wiring and no call. `SetReaderCredentials` and `ChangeOwnPassword`
 * would both have thrown `password_hasher_not_wired` the first time a volunteer
 * used them in production.
 *
 * It stayed hidden because the two paths that look like they exercise it do not.
 * Registration without credentials is the ordinary case — most children never
 * supply a username — and takes the `username === null && password === null`
 * branch before the hasher is reached. Sign-in verifies through
 * `src/auth/session.ts`, which calls `verifyPassword` directly rather than
 * through the injected `verifyFor`. So the seeded accounts signed in, the crawl
 * passed, and the one thing nobody had done yet was change a password.
 *
 * **`instrumentation.ts` is Next's own startup hook**, run once per server
 * process before any request is served, which is what a composition root has to
 * be. The alternative — calling the setters from each action that needs them —
 * makes the wiring a property of whichever route happens to run first.
 *
 * The `nodejs` guard is Next's documented shape: this file is also loaded in the
 * edge runtime, where `@node-rs/argon2` is a native addon that cannot load. No
 * route in this application runs on edge, so the guard is about the bundler
 * rather than about behaviour.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { hashPassword, verifyPassword } = await import("./auth/password");
  const { setPasswordHasher, setPasswordVerifier } =
    await import("./domain/members/registration");

  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
}
