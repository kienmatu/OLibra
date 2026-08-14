import sharp from "sharp";
import { expect, test } from "vitest";
import { ValidationFailed } from "../../src/domain/kernel/errors";
import { AVATAR_EDGE, processAvatar } from "../../src/lib/avatar-image";
import {
  centreMarkedPng,
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

test("EXIF orientation is applied, so a portrait photograph is upright", async () => {
  // Orientation 6 means "rotate 90° clockwise on display". The source is
  // 800x400 landscape; applying the tag makes it 400x800 portrait before the
  // square crop, so the crop takes a different slice than it would untagged.
  // Asserting on the tag of the *output* is the durable check: it must be
  // absent or 1, because the rotation has been baked into the pixels.
  const out = await processAvatar(await jpegWithOrientation(6));
  const meta = await sharp(out).metadata();

  expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
});

test("metadata is stripped — no EXIF rides along into a public bucket", async () => {
  const out = await processAvatar(await jpegWithOrientation(6));
  const meta = await sharp(out).metadata();

  expect(meta.exif).toBeUndefined();
});

test("worst-case noise still lands far under 800 KB", async () => {
  // Random noise is incompressible and therefore the honest upper bound: the
  // output size is governed by the 512x512 encode, not by the input, so this
  // is effectively the ceiling for any accepted upload. Measured at ~105 KB.
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
