import sharp from "sharp";
import { expect, test } from "vitest";
import {
  centreMarkedPng,
  jpegMarkedTopLeftWithOrientation,
  jpegOfAtLeast,
  jpegWithOrientation,
  realJpeg,
  realPng,
  realWebp,
} from "./images";

/**
 * The fixtures are themselves tested, because every assertion in the avatar
 * suite rests on them being genuinely decodable. The old fixture was an
 * eight-byte PNG signature that no decoder accepts, and it passed for months
 * because nothing decoded.
 */

test("each generator produces bytes a decoder accepts", async () => {
  for (const [name, make] of [
    ["jpeg", realJpeg],
    ["png", realPng],
    ["webp", realWebp],
  ] as const) {
    const meta = await sharp(await make()).metadata();
    expect(meta.width, `${name} width`).toBeGreaterThan(0);
    expect(meta.height, `${name} height`).toBeGreaterThan(0);
  }
});

test("jpegWithOrientation carries the EXIF tag it claims", async () => {
  const meta = await sharp(await jpegWithOrientation(6)).metadata();
  expect(meta.orientation).toBe(6);
});

test("jpegMarkedTopLeftWithOrientation carries the tag and the marker, unrotated", async () => {
  const jpeg = await jpegMarkedTopLeftWithOrientation(6);
  const meta = await sharp(jpeg).metadata();
  expect(meta.orientation).toBe(6);

  // Raw decode, no `.rotate()` — this checks the fixture's own bytes, before
  // any pipeline touches them, so the marker must still be exactly where it
  // was drawn: the top-left corner.
  const { data, info } = await sharp(jpeg)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (fx: number, fy: number) =>
    (Math.round(fy * info.height) * info.width + Math.round(fx * info.width)) *
    info.channels;

  const topLeft = at(0.12, 0.12);
  expect(data[topLeft + 1], "marker green channel at top-left").toBeGreaterThan(
    150,
  );
  expect(data[topLeft + 2], "marker blue channel at top-left").toBeLessThan(150);

  const bottomRight = at(0.9, 0.9);
  expect(
    data[bottomRight + 2],
    "field blue channel away from the marker",
  ).toBeGreaterThan(150);
});

test("jpegOfAtLeast reaches the byte count asked for", async () => {
  const bytes = await jpegOfAtLeast(4_600_000);
  expect(bytes.length).toBeGreaterThanOrEqual(4_600_000);
});

test("centreMarkedPng puts a distinct colour in the middle", async () => {
  const png = await centreMarkedPng();
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const middle = ((info.height / 2) * info.width + info.width / 2) * info.channels;
  // Red centre.
  expect(data[middle]).toBeGreaterThan(200);
  expect(data[middle + 2]).toBeLessThan(60);
  // Blue top-left corner.
  expect(data[0]).toBeLessThan(60);
  expect(data[2]).toBeGreaterThan(200);
});
