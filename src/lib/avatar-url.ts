import { objectStore } from "./object-store";

/**
 * The address a browser fetches, built from the stored key at read time.
 *
 * This is the half of `20260809_02_avatar_object.sql` that never landed. That
 * migration's own comment states the intent — "The storage key becomes the
 * stored fact; the URL is derived from it" — and names what a stored absolute
 * URL costs: "It baked `S3_PUBLIC_URL` into every row. SDD §6.8's whole claim
 * is that changing provider is a change of environment variables and nothing
 * else. A stored absolute URL makes that false: moving to R2, or putting a CDN
 * in front, would strand every avatar already written."
 *
 * It added the column and stopped. `ObjectStore.url()` then had exactly one
 * caller in the entire codebase, in `./avatar.ts`, at *write* time — so the key
 * was stored, deletion worked, and every approval still wrote a row carrying a
 * host. `20260813_01_avatar_object_only.sql` drops the URL column; this
 * function is what makes that possible.
 *
 * Server-side only, which every call site already is: `objectStore()` reads
 * `S3_*` from `process.env`.
 *
 * `null` in, `null` out, so that "render whatever the person has" is one
 * expression at every call site rather than a conditional somebody writes
 * differently each time.
 */
export function avatarUrl(key: string | null): string | null {
  return key === null ? null : objectStore().url(key);
}
