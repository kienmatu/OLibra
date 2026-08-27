import {
  createObjectStore,
  type ObjectStore,
  s3ConfigFromEnv,
} from "../storage/s3";

/**
 * The one place the running application builds an `ObjectStore`.
 *
 * B5 shipped `src/storage/s3.ts` with no caller anywhere outside its own tests,
 * and said so: `createObjectStore`/`s3ConfigFromEnv` were reachable and unused.
 * This module is the first caller, and the avatar's server action
 * (`src/app/tu-sach/[shelf]/(doc-gia)/ho-so/profile-actions.ts`) is what reaches it — which
 * has a consequence beyond tidiness. B5's Docker smoke stage builds the
 * standalone server and boots it under Bun; Next traces `.next/standalone` from
 * what `src/app/` actually imports, so until something under `src/app/` reached
 * the store, `@aws-sdk/client-s3` was never traced into the image and the gate
 * could not have caught the SDK failing to load there. It can now.
 *
 * **Cached on `globalThis`, not in a module-level `let`, and behind
 * `Symbol.for`.** This is `src/db/client.ts`'s `pool()` treatment applied to the
 * second process-lifetime resource this application has, and the reasoning
 * transfers line for line: Next re-evaluates server modules on every edit in
 * development, a module-level binding dies with the old module while the client
 * it named does not, and an unregistered `Symbol()` would mint a fresh key per
 * evaluation — caching each new store under a key nothing can look up again,
 * which is the module-level `let` bug wearing a symbol's clothes.
 *
 * What is *not* the same as `pool()`: an `S3Client` holds no server-side
 * resource that leaks the way a Postgres backend does. The cost of building one
 * per request is the SigV4 credential and region resolution, plus a new
 * connection pool for the HTTP handler — real but not corrupting. The reason to
 * cache is therefore ordinary efficiency, and the reason to cache *this way* is
 * that a half-measure (a module-level `let`) is the version that looks correct
 * and silently stops working under hot reload.
 *
 * **`s3ConfigFromEnv()` is called lazily, inside the function, not at module
 * scope.** It throws on any of the seven variables being unset, and a throw at
 * module scope is a build-time failure: `next build` evaluates server modules
 * while collecting page data, and CI does not — and must not — hold production
 * S3 credentials. Deferring the read to the first call means a missing variable
 * fails the request that needed storage, loudly, with the message
 * `required()` writes, rather than failing the build of every page.
 */
const STORE_KEY = Symbol.for("olibra.storage.object-store");

type StoreCache = { [STORE_KEY]?: ObjectStore };

export function objectStore(): ObjectStore {
  const cache = globalThis as typeof globalThis & StoreCache;
  cache[STORE_KEY] ??= createObjectStore(s3ConfigFromEnv());
  return cache[STORE_KEY];
}
