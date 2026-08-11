import { setPasswordHasher, setPasswordVerifier } from "../domain/kernel/crypto";
import { hashPassword, verifyPassword } from "../auth/password";

/**
 * Wires the calling layer's own instance of `src/domain/kernel/crypto.ts`
 * from `src/auth/password.ts`, once.
 *
 * **Why this file and not a function inside `crypto.ts` itself.** The plan
 * this task implements first wrote `ensureCryptoWired` inside the domain
 * module, reaching `src/auth/password` through a dynamic `import()` on the
 * theory that `tests/architecture/boundaries.test.ts` only forbids a
 * *static* import of `src/auth` from `src/domain/`. It does not: that test's
 * forbidden pattern is
 * `\b(?:from|import|require)\s*\(?\s*["'](?:@\/auth\/|\.\.\/(?:\.\.\/)*auth\/)`,
 * which matches `import(` exactly as it matches `import … from`. A dynamic
 * import would have failed that test, correctly — the rule it enforces (SDD
 * §3.1: the domain stays movable to a separate service, runnable under a
 * plain test runner, never touching the native Argon2id addon) does not
 * become false because the import is deferred to runtime.
 *
 * So the wiring call itself has to sit outside `src/domain/`, on the
 * application side of that boundary, where a static import of `src/auth` is
 * ordinary — `src/lib/page-data.ts` already imports from `src/auth/guards.ts`
 * for exactly this reason. This file is that one place: it is the only
 * caller of `setPasswordHasher`/`setPasswordVerifier` outside `crypto.ts`'s
 * own throwing defaults, so wiring cannot silently split across two call
 * sites that drift out of sync with each other.
 *
 * **Why every request path calls this, rather than `src/instrumentation.ts`
 * alone wiring it once.** `src/domain/kernel/crypto.ts`'s own docstring has
 * the measurement: Turbopack bundles a module imported by both the `node`
 * layer (`instrumentation.ts`) and the `react-server` layer (server actions)
 * as two separate instances, each with its own copy of `crypto.ts`'s
 * module-level `hasher`/`verifier`. Wiring the instrumentation instance never
 * reaches the server-action instance. `ensureCryptoWired()` therefore has to
 * run inside *every* layer that might need the port — which is what calling
 * it from most of `src/lib/page-data.ts`'s exported entry points achieves:
 * whichever layer's copy of this module a given request runs in, that copy
 * wires itself on its own first call.
 *
 * **Deliberately not enumerated by name here.** An earlier version of this
 * sentence named four call sites; `page-data.ts` grew to eight exports and
 * two more (`loadFrontDoorViewer`, `submitPublicCommand`) started calling
 * this without the list here ever being updated — a docstring silently
 * describing a narrower reality than the code, found in the QA remediation
 * branch's final review. `tests/architecture/the-password-hasher-is-wired
 * .test.ts` is the source of truth for which entry points wire and which two
 * (`loadAdminPage`, `loadFile`) deliberately do not, because it derives the
 * list from `page-data.ts` itself rather than a maintained enumeration —
 * read it there instead of trusting a count that can only go stale here.
 */
let wired = false;

export async function ensureCryptoWired(): Promise<void> {
  if (wired) return;
  setPasswordHasher(hashPassword);
  setPasswordVerifier(verifyPassword);
  wired = true;
}

/**
 * Test-only, and deliberately a separate function from
 * `resetCryptoForTests()` in `src/domain/kernel/crypto.ts` rather than a
 * second responsibility folded into it. `wired` is this file's own state —
 * putting it in the domain module would mean `crypto.ts` importing nothing
 * new, but knowing about a caller-side memoisation flag it does not itself
 * use, which is precisely the kind of application concern the port is
 * supposed to stay ignorant of. A suite that wants `ensureCryptoWired()` to
 * actually re-run (rather than return immediately because `wired` is still
 * `true` from an earlier test) calls both resets —
 * `tests/architecture/the-password-hasher-is-wired.test.ts` does.
 */
export function resetCryptoWiringForTests(): void {
  wired = false;
}
