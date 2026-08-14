import sharp from "sharp";

/**
 * Real, decodable image bytes for the avatar suite.
 *
 * Before Task 4 of the 2026-08-13 avatar plan, `avatar-actions.test.ts`
 * uploaded `new Uint8Array([0x89, 0x50, 0x4e, 0x47, …])` — the eight-byte PNG
 * signature and nothing else. That was sufficient while `invalid_image` was a
 * content-type check, and became insufficient the moment decoding became the
 * check. Generating with sharp rather than committing binary fixtures keeps
 * the bytes readable in review and lets a test ask for the exact shape it
 * needs.
 */

/** A plain terracotta field — the fastest valid image to make. */
function flat(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 197, g: 107, b: 74 },
    },
  });
}

/**
 * Random RGB noise. Incompressible, which is what makes it the worst case for
 * any encoder — used where a test needs either a large file or an honest
 * upper bound on output size.
 */
function noise(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256;
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

export async function realJpeg(
  opts: { width?: number; height?: number; noise?: boolean } = {},
): Promise<Buffer> {
  const { width = 2000, height = 1500, noise: useNoise = false } = opts;
  const image = useNoise ? noise(width, height) : flat(width, height);
  return image.jpeg({ quality: 92 }).toBuffer();
}

export async function realPng(
  opts: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 800, height = 600 } = opts;
  return flat(width, height).png().toBuffer();
}

export async function realWebp(
  opts: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 800, height = 600 } = opts;
  return flat(width, height).webp().toBuffer();
}

/**
 * A JPEG carrying an EXIF orientation tag, for proving `.rotate()` is applied.
 * `withMetadata` is the only way to get one in: sharp strips metadata by
 * default, which is the very property Task 2 relies on elsewhere.
 */
export async function jpegWithOrientation(orientation: number): Promise<Buffer> {
  return flat(800, 400)
    .withMetadata({ orientation })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * A square field with a distinctly-coloured 100×100 marker block pinned to
 * the top-left corner, carrying an EXIF orientation tag.
 *
 * `jpegWithOrientation` above is a *uniform* field — rotating a flat colour
 * is pixel-identical to not rotating it, so no assertion about its output
 * can tell "the tag was applied" apart from "the tag was ignored and sharp
 * merely stripped it as usual". This fixture exists to make that assertion
 * possible: the marker sits off-centre, so a 90° rotation moves it to a
 * different corner, and a pipeline that skips `.rotate()` leaves it exactly
 * where it started.
 *
 * The field is square (400×400) so that `processAvatar`'s `resize(..., {
 * fit: "cover" })` only scales it — a square input needs no cropping to
 * reach a square output — keeping the geometry to "rotate, then scale
 * uniformly" instead of "rotate, then scale, then crop", which is what
 * `tests/lib/avatar-image.test.ts` walks through pixel by pixel.
 */
export async function jpegMarkedTopLeftWithOrientation(
  orientation: number,
): Promise<Buffer> {
  const edge = 400;
  const markerEdge = 100;
  const marker = await sharp({
    create: {
      width: markerEdge,
      height: markerEdge,
      channels: 3,
      background: { r: 34, g: 197, b: 94 }, // green — distinct from the field below
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: edge,
      height: edge,
      channels: 3,
      background: { r: 30, g: 30, b: 230 }, // blue field
    },
  })
    .composite([{ input: marker, top: 0, left: 0 }])
    .withMetadata({ orientation })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * A genuinely decodable JPEG of at least `bytes`, grown by enlarging a noise
 * field rather than by padding — trailing bytes after a JPEG's end marker are
 * tolerated by some decoders and rejected by others, which would make the test
 * depend on which one ran.
 */
export async function jpegOfAtLeast(bytes: number): Promise<Buffer> {
  let edge = 1500;
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = await noise(edge, edge).jpeg({ quality: 100 }).toBuffer();
    if (out.length >= bytes) return out;
    edge = Math.ceil(edge * 1.5);
  }
  throw new Error(`could not reach ${bytes} bytes`);
}

/**
 * A blue 900×300 landscape field with a red square dead centre. A centre-crop
 * keeps the red; a squash or a top-left crop does not.
 */
export async function centreMarkedPng(): Promise<Buffer> {
  const marker = await sharp({
    create: {
      width: 120,
      height: 120,
      channels: 3,
      background: { r: 230, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: 900,
      height: 300,
      channels: 3,
      background: { r: 30, g: 30, b: 230 },
    },
  })
    .composite([{ input: marker, gravity: "centre" }])
    .png()
    .toBuffer();
}
