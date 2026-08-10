import { NotWired } from "./errors";

export type PasswordHasher = (plain: string) => Promise<string>;
export type PasswordVerifier = (plain: string, hash: string) => Promise<boolean>;

/**
 * The domain's crypto port, and the one module allowed to hold it.
 *
 * **Why this module exists rather than a `let` in `registration.ts`, where
 * `hasher`/`verifier` used to live.** Next builds the server twice — once for
 * `instrumentation.ts` (the `node` layer) and once for React Server
 * Components and server actions (the `react-server` layer) — and a module
 * imported by both is bundled into both, as two instances with two copies of
 * every module-level binding. Wiring performed in one is invisible to the
 * other. Measured on 10/08/2026: instrumentation reported `hashFor` wired
 * while `registerMembershipAction` threw `NotWired` in the same process,
 * confirmed live by a QA sweep — `POST /dang-ky` returned 500 for every
 * reader who supplied a username and password.
 *
 * The fix is not a different place to put the `let` — moving it here changes
 * nothing about *which* module Turbopack bundles twice. The fix is that
 * **every request path wires itself** before it needs the port, via
 * `ensureCryptoWired()` (`src/lib/crypto-wiring.ts`) called from
 * `src/lib/page-data.ts`'s four entry points. That call is idempotent and
 * costs one boolean check after the first request in each layer —
 * `src/instrumentation.ts` still calls it too, as a belt-and-braces warm-up
 * for the `node` layer, but it is no longer what makes the request path work.
 *
 * **`ensureCryptoWired` itself lives in `src/lib/`, not here, and that is
 * deliberate rather than an oversight.** It needs `hashPassword`/
 * `verifyPassword` from `src/auth/password`, and
 * `tests/architecture/boundaries.test.ts` forbids `src/domain/` importing
 * `src/auth` in any form — static, dynamic, or `require` — because Argon2id
 * is a native addon and the domain must stay runnable under a plain test
 * runner, movable to a separate service (SDD §3.1). This module stays on the
 * domain side of that line: types, the two throwing defaults, the setters,
 * and `hashFor`/`verifyFor`, which read the current binding at call time so a
 * later wiring call sticks. Only `./errors` is imported.
 */
let hasher: PasswordHasher = () => {
  throw new NotWired("password_hasher_not_wired");
};

let verifier: PasswordVerifier = async () => {
  throw new NotWired("password_verifier_not_wired");
};

/**
 * Injected once, from `src/lib/crypto-wiring.ts`, rather than threaded
 * through `RegistrationInput`, which would put a function into the same
 * object a command's inputs are logged and validated from.
 *
 * The default throws. An unwired hasher must fail loudly rather than write a
 * plausible-looking string into `password_hash`, where nobody would notice
 * until someone tried to sign in.
 *
 * `NotWired`, not `RuleViolated("not_permitted")` (M7, fix-report,
 * 2026-08-08-b2-members): the latter reads to a real caller as an ordinary
 * permission refusal — "Bạn không có quyền thực hiện việc này." — which is
 * exactly the wrong sentence for a boot-time wiring bug, and registration
 * *without* credentials keeps working regardless (most children never supply
 * a username), so the bug would otherwise surface far downstream, at the
 * first password anyone typed, dressed up as a business rule. See
 * `NotWired`'s own docstring for the rest of the reasoning, shared with
 * `verifier` below.
 */
export function setPasswordHasher(next: PasswordHasher): void {
  hasher = next;
}

export function setPasswordVerifier(next: PasswordVerifier): void {
  verifier = next;
}

/** Read at call time, so a later wiring call sticks. */
export function hashFor(plain: string): Promise<string> {
  return hasher(plain);
}

/**
 * A password verifier, injected for the same reason the hasher is.
 *
 * M7 (fix-report, 2026-08-08-b2-members): an unwired verifier must still
 * never turn rule 2 into a back door, so it does not start *approving*
 * matches just because nobody wired it — but silently returning `false` was
 * the wrong way to stay safe. From outside, "no match" is indistinguishable
 * from a correctly wired verifier rejecting a genuinely wrong password: every
 * username-reuse attempt (BR §5.3) would fail closed to `username_taken`
 * forever, with nothing telling anyone the feature never worked. `NotWired`
 * keeps the same safe outcome — a caller still never gets treated as a match
 * — while making the cause impossible to miss: this only throws on the path
 * that would otherwise have compared a supplied password against a real
 * stored hash, i.e. exactly when the verifier would actually have had
 * something to do.
 */
export function verifyFor(plain: string, hash: string): Promise<boolean> {
  return verifier(plain, hash);
}

/**
 * Test-only: puts both back to their throwing defaults, so a suite can assert
 * the unwired state still throws before asserting wiring fixes it.
 *
 * Resets only this module's bindings. `src/lib/crypto-wiring.ts` keeps its
 * own `wired` flag and its own `resetCryptoWiringForTests()` — a test that
 * wants `ensureCryptoWired()` to actually re-call these setters, rather than
 * return immediately because it already ran once, has to reset both, which
 * `tests/architecture/the-password-hasher-is-wired.test.ts` does.
 */
export function resetCryptoForTests(): void {
  hasher = () => {
    throw new NotWired("password_hasher_not_wired");
  };
  verifier = async () => {
    throw new NotWired("password_verifier_not_wired");
  };
}
