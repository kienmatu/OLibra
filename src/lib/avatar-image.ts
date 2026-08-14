import sharp from "sharp";
import { ValidationFailed } from "../domain/kernel/errors";

/**
 * The image half of an avatar upload: decode, centre-crop to a square, resize,
 * re-encode as WebP.
 *
 * Separate from `./avatar.ts` — which owns policy, storage and the ordering
 * against a transaction — so that what happens to the *pixels* can be tested
 * without a database or an object store, and so `avatar.ts` keeps one job.
 *
 * ── Why each call in the chain is there ──────────────────────────────────
 *
 * **`.rotate()` with no argument applies EXIF orientation.** A phone records a
 * portrait photograph as landscape pixels plus a tag; without this the stored
 * crop is sideways, which is the single most common way an avatar upload ships
 * broken. Applying it here also *consumes* it, so the stored file needs no tag
 * to be read correctly by anything.
 *
 * **`fit: "cover"` with `position: "centre"` is the crop.** The shorter edge is
 * scaled to `AVATAR_EDGE` and the overflow on the longer edge is trimmed
 * equally from both sides — for a photograph of a person, the middle is where
 * the person is.
 *
 * This is also what closes OPS §4.3's "square", open since B2b: that paragraph
 * asked for square photographs while recording that "square" had no sentence,
 * no code and no source, and that "a refusal a reader cannot be told the reason
 * for is worse than no refusal". Cropping dissolves the question — photographs
 * become square without anything being refused, so the missing Vietnamese
 * sentence is never needed.
 *
 * **Metadata is dropped**, because sharp discards it unless asked for
 * `withMetadata()`. That is not incidental here. The readers of a parish
 * library are largely children, the bucket's only public grant is
 * `s3:GetObject` for anyone holding the URL
 * (`tests/architecture/compose-grants-only-get-object.test.ts`), and a
 * photograph straight off a phone can carry the GPS coordinates of the house it
 * was taken in. Before this module those bytes were stored exactly as uploaded.
 *
 * **The `catch` is the `invalid_image` check.** `src/lib/avatar.ts` used to
 * concede that its refusal was "a content-type check and not a decode"; it is a
 * decode now, and a file that is not an image cannot pass by wearing the right
 * header. sharp's default `limitInputPixels` (~268 Mpx) throws into the same
 * `catch` for an image whose *decoded* dimensions are absurd regardless of how
 * few bytes the compressed file took — a real exposure created by raising the
 * byte limit to 5 MB, closed by the library's default rather than by anything
 * written here.
 *
 * The `catch` is deliberately broad rather than narrowed to a decode error:
 * sharp does not expose a reliable way to tell "not an image" apart from an
 * internal fault (an out-of-memory condition, say, or a future typo in the
 * resize options), and refusing to decode is genuinely the common case a
 * reader should see as "Tệp này không phải là ảnh hợp lệ." either way. What
 * changes is that the original error is preserved as `cause` on the thrown
 * `ValidationFailed`, so whoever debugs a spike in this refusal still has the
 * real exception to read rather than a single flattened sentence.
 *
 * Output size is governed by this encode and not by the input, so the ~104 KB
 * (measured: 105,998 bytes) a 2000×1500 field of genuinely random noise
 * produces is effectively the ceiling for any accepted upload — measured
 * against `tests/support/images.ts`'s `noise()`, which fills every byte from
 * a seeded PRNG (`mulberry32`) rather than deriving it from the byte's own
 * index, so the bytes carry no shorter description than themselves and the
 * figure is an honest one rather than an optimistic one. (An earlier version
 * of `noise()` filled bytes with `(i * 2654435761) % 256`, a formula that
 * reduces to a 256-byte-periodic ramp and compresses far better than real
 * noise; it produced ~50 KB, and this comment used to quote that number.) The
 * product owner asked for 800 KB; the margin is about 7.7×, and
 * `tests/lib/avatar-image.test.ts` pins it so a later change to either
 * constant fails loudly rather than quietly.
 */

/** 4× the 72px an avatar is drawn at, 8× the 64px on the approval screens. */
export const AVATAR_EDGE = 512;

/** WebP quality. High enough that a face is not visibly degraded at 512px. */
export const AVATAR_QUALITY = 82;

export async function processAvatar(input: Uint8Array): Promise<Uint8Array> {
  try {
    return await sharp(input)
      .rotate()
      .resize(AVATAR_EDGE, AVATAR_EDGE, { fit: "cover", position: "centre" })
      .webp({ quality: AVATAR_QUALITY })
      .toBuffer();
  } catch (cause) {
    const failure = new ValidationFailed("invalid_image", "avatar");
    // `ValidationFailed`'s constructor takes only `(code, field)` — adding a
    // third parameter would change its public shape for every other call
    // site. `cause` is a plain, optional property every `Error` already
    // carries (ES2022), so it is set here instead, after construction.
    failure.cause = cause;
    throw failure;
  }
}
