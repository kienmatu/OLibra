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
 * Output size is governed by this encode and not by the input, so the ~105 KB a
 * 2000×1500 field of pure noise produces is effectively the ceiling for any
 * accepted upload. The product owner asked for 800 KB; the margin is about 8×,
 * and `tests/lib/avatar-image.test.ts` pins it so a later change to either
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
  } catch {
    throw new ValidationFailed("invalid_image", "avatar");
  }
}
