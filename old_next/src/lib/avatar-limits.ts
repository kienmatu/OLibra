/**
 * The two facts about an avatar upload that both sides of the network need.
 *
 * Separate from `./avatar.ts` because the profile screen's island
 * (`src/components/avatar-proposal.tsx`) is a client component and `./avatar.ts`
 * is not importable from one: it reaches `next/headers`, `next/navigation` and
 * the Postgres pool through `./page-data`. Two hand-kept copies of a limit is
 * how a screen ends up stating a number the server does not enforce, so the
 * constants live here and both sides import them.
 *
 * Nothing in this file may import anything that is not also client-safe.
 */

/**
 * OPS §4.3's `file_too_large` names the number: "Ảnh vượt quá 5 MB."
 *
 * Raised from 2 MB on 2026-08-13. Two megabytes refused the ordinary case —
 * any phone made in the last decade exceeds it — and the limit was affordable
 * only because nothing shrank the photograph. `./avatar-image.ts` now
 * centre-crops and re-encodes every upload to a 512×512 WebP of around 40 KB,
 * so what this number bounds is the *upload*, not what is kept.
 *
 * 5 MB is read as the binary megabyte, because that is what every file manager
 * a volunteer might check the size in reports.
 *
 * `serverActions.bodySizeLimit` in `next.config.ts` must stay strictly above
 * this — see `storeProposedAvatar`.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The content types accepted, ordered, for the file input's `accept` attribute
 * as well as the server's own gate.
 *
 * **`image/avif` is here and `image/heic` is not, and the difference is the
 * codec rather than the container.** The prebuilt `@img/sharp-libvips-*`
 * binaries link libheif but ship no HEVC decoder, for patent reasons; AVIF is
 * AV1 and royalty-free, so it decodes. `sharp.format.heif.input` reports `true`
 * for both, which is a fact about the container and would have shipped a broken
 * path if it had been trusted — verified against a real HEVC file, which fails
 * with "bad seek", while an AVIF round-trips.
 *
 * **Never add HEIC to this list.** It is what a browser is handed as `accept`,
 * and iOS Safari transcodes a HEIC photograph to JPEG on upload *because* this
 * list omits it. Adding it tells iOS to send the original, which nothing here
 * can decode — an attribute that looks like a convenience filter is in fact
 * what makes the iPhone path work.
 *
 * `image/jpg` is not here. It is not a real media type — browsers send
 * `image/jpeg` for a `.jpg` — and accepting a type nothing emits would only
 * widen what a hand-rolled request can claim to be.
 */
export const AVATAR_ACCEPT: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];
