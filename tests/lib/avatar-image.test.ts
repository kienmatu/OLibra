import sharp from "sharp";
import { expect, test } from "vitest";
import { ValidationFailed } from "../../src/domain/kernel/errors";
import { AVATAR_EDGE, processAvatar } from "../../src/lib/avatar-image";
import {
  centreMarkedPng,
  jpegMarkedTopLeftWithOrientation,
  jpegWithOrientation,
  realJpeg,
  realPng,
} from "../support/images";

test("output is a square WebP at the configured edge", async () => {
  const out = await processAvatar(await realJpeg({ width: 2000, height: 1500 }));
  const meta = await sharp(out).metadata();

  expect(meta.format).toBe("webp");
  expect(meta.width).toBe(AVATAR_EDGE);
  expect(meta.height).toBe(AVATAR_EDGE);
});

test("a landscape photograph is centre-cropped, not squashed", async () => {
  // 900x300 blue with a red square in the middle. `fit: "cover"` keeps the
  // middle; a squash would keep the blue edges and distort the marker, and a
  // top-left crop would miss the red entirely.
  const out = await processAvatar(await centreMarkedPng());
  const { data, info } = await sharp(out)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const at = (x: number, y: number) => (y * info.width + x) * info.channels;
  const centre = at(info.width / 2, info.height / 2);
  expect(data[centre], "centre should still be red").toBeGreaterThan(180);
  expect(data[centre + 2]).toBeLessThan(80);
});

test("EXIF orientation is applied, so an off-centre marker moves under rotation", async () => {
  // A uniform-colour fixture (`jpegWithOrientation` alone) cannot prove this:
  // rotating a flat field is pixel-identical to not rotating it, and the
  // output tag is absent either way because sharp strips metadata by default
  // regardless of whether `.rotate()` ran. So this uses
  // `jpegMarkedTopLeftWithOrientation`, whose green 100x100 marker sits in
  // the top-left corner of a square 400x400 field and carries orientation 6
  // ("rotate 90° clockwise on display").
  //
  // Worked out and confirmed empirically (see the fixture's doc comment):
  // applying the tag rotates the marker from the top-left corner to the
  // top-right corner before `processAvatar`'s square-to-square resize, which
  // only scales (no crop, since the input is already square) — so it lands
  // near the top-right of the 512x512 output. Skipping `.rotate()` leaves it
  // at the top-left instead. The two assertions below pin both corners, so a
  // deleted `.rotate()` call fails this test rather than passing it — that
  // was verified directly: with `.rotate()` removed from
  // `src/lib/avatar-image.ts`, this test fails (marker absent from
  // top-right, present at top-left); restored, it passes.
  const out = await processAvatar(await jpegMarkedTopLeftWithOrientation(6));
  const { data, info } = await sharp(out)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (fx: number, fy: number) =>
    (Math.round(fy * info.height) * info.width + Math.round(fx * info.width)) *
    info.channels;

  const topRight = at(0.9, 0.12);
  expect(
    data[topRight + 1],
    "marker green channel should be at top-right",
  ).toBeGreaterThan(150);
  expect(
    data[topRight + 2],
    "marker blue channel should be low at top-right",
  ).toBeLessThan(150);

  const topLeft = at(0.12, 0.12);
  expect(
    data[topLeft + 2],
    "top-left should now be the background blue, not the marker",
  ).toBeGreaterThan(150);
  expect(data[topLeft + 1], "top-left green channel should be low").toBeLessThan(
    150,
  );
});

test("metadata is stripped by the encode — a regression guard, not proof this module strips anything", async () => {
  // sharp drops metadata by default unless `withMetadata()` is called, so
  // this assertion would pass even for a badly broken `processAvatar` (one
  // that never rotated, cropped or resized at all) — it verifies sharp's own
  // default, not this module's logic. Kept anyway: it catches a *future*
  // regression, such as someone adding `withMetadata()` to preserve colour
  // profiles and accidentally carrying EXIF along with it. The input fixture
  // genuinely carries an EXIF orientation tag (see `jpegWithOrientation`),
  // which is what makes this a strip rather than a no-op on data that was
  // never there.
  const out = await processAvatar(await jpegWithOrientation(6));
  const meta = await sharp(out).metadata();

  expect(meta.exif).toBeUndefined();
});

test("worst-case noise still lands far under 800 KB", async () => {
  // Noise is close to incompressible and therefore close to the honest upper
  // bound: the output size is governed by the 512x512 encode, not by the
  // input, so this is effectively the ceiling for any accepted upload.
  // Measured at ~50 KB (50,738 bytes) against `tests/support/images.ts`'s
  // `noise()`, which fills bytes from a deterministic hash rather than true
  // randomness — a genuinely random source compresses somewhat worse, so a
  // real-world worst case may land a bit higher than this figure, though
  // still nowhere near the 800 KB ceiling being asserted.
  const out = await processAvatar(
    await realJpeg({ width: 2000, height: 1500, noise: true }),
  );

  expect(out.length).toBeLessThan(800 * 1024);
});

test("a file that is not an image raises invalid_image", async () => {
  // The check that only becomes real once decoding happens. Before this, a
  // content-type header was the whole of the claim.
  const notAnImage = new TextEncoder().encode("<!doctype html><p>xin chào");

  await expect(processAvatar(notAnImage)).rejects.toThrow(ValidationFailed);
  await expect(processAvatar(notAnImage)).rejects.toMatchObject({
    code: "invalid_image",
  });
});

test("a decode bomb is refused rather than allocated", async () => {
  // A tiny PNG whose decoded dimensions exceed sharp's default
  // `limitInputPixels` (~268 Mpx). Flat colour compresses to a few KB while
  // decoding to ~400 Mpx, which is exactly the shape a hostile upload takes
  // once the byte limit rises to 5 MB.
  const bomb = await sharp({
    create: {
      width: 20000,
      height: 20000,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
    limitInputPixels: false,
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await expect(processAvatar(bomb)).rejects.toMatchObject({
    code: "invalid_image",
  });
});

test("png and jpeg both arrive at the same output shape", async () => {
  for (const input of [await realPng(), await realJpeg()]) {
    const meta = await sharp(await processAvatar(input)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(AVATAR_EDGE);
  }
});
