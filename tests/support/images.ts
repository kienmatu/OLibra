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
 * A small, fast, deterministic pseudo-random generator (mulberry32) —
 * deterministic on purpose, so the bytes `noise()` below produces, and every
 * measurement taken against them, are the same on every run. `Math.random()`
 * would make the suite's own worst-case-size assertion flaky by construction:
 * a passing run today would say nothing about tomorrow's.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Genuinely high-entropy RGB noise — used where a test needs either a large
 * file or an honest upper bound on output size.
 *
 * **This used to be `(i * 2654435761) % 256`**, which reduces to `(i * 177) %
 * 256`: an exactly 256-byte-periodic ramp (`raw[0:256]` equals
 * `raw[256:512]`, byte for byte), trivially compressible, and not remotely
 * the "worst case for any encoder" the comment above it used to claim. A
 * seeded PRNG closes the gap while keeping the determinism true randomness
 * would have cost: `mulberry32` above passes the same periodicity check the
 * old generator failed (`raw.subarray(0, 256).equals(raw.subarray(256, 512))`
 * is `false`), and every byte is fed from the generator's own output rather
 * than from an index-derived formula, so there is no shorter description of
 * the buffer than the buffer itself — which is what "close to incompressible"
 * actually requires. See `src/lib/avatar-image.ts` for the measurement this
 * fixture's honesty was blocking.
 */
function noise(width: number, height: number) {
  const raw = Buffer.alloc(width * height * 3);
  const rand = mulberry32(0x9e3779b9);
  for (let i = 0; i < raw.length; i++) raw[i] = rand() & 0xff;
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
 * A real, decodable AVIF — the fourth member of `AVATAR_ACCEPT`
 * (`src/lib/avatar-limits.ts`) and, until this fixture, the only one with no
 * automated coverage anywhere (`grep -rn avif tests/` was empty): it had been
 * accepted into the allow-list on the strength of one manual check during
 * design. `sharp` encodes AVIF through the same libvips/libheif build it
 * decodes with, so `.avif({ quality: 50 })` here and `processAvatar`'s decode
 * of the result exercise the real codec, not a stub.
 */
export async function realAvif(
  opts: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const { width = 800, height = 600 } = opts;
  return flat(width, height).avif({ quality: 50 }).toBuffer();
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
 * A genuinely decodable JPEG of *exactly* `bytes` — the boundary
 * `jpegOfAtLeast` cannot reach, because a JPEG encoder's output size is a
 * function of its pixel content, not a dial: there is no width/height/quality
 * that lands on an arbitrary byte count on the nose.
 *
 * The trick is padding rather than encoding: start from a small, real JPEG
 * (`base`, always well under `bytes` for the sizes this suite asks for — a few
 * KB against a multi-MB target) and splice in JPEG comment segments (`COM`,
 * marker `0xFFFE`) right after the SOI marker to make up the exact difference.
 * A `COM` segment is part of the format, not trailing junk appended after the
 * end marker — `jpegOfAtLeast`'s own docstring is why that distinction
 * matters, since some decoders tolerate trailing bytes and others reject them.
 * Every decoder is required to skip an unrecognised `COM` segment, so the
 * result decodes identically to `base` while weighing exactly `bytes`.
 *
 * A `COM` segment's minimum cost is 4 bytes (the `0xFF 0xFE` marker plus a
 * 2-byte length field that counts itself), so a target fewer than 4 bytes
 * above `base`'s own size cannot be hit exactly this way — not a concern for
 * `AVATAR_MAX_BYTES` (multiple megabytes above `base`), which is the only
 * caller today, but real enough that it throws rather than silently rounding.
 */
export async function jpegOfExactly(bytes: number): Promise<Buffer> {
  // A small, cheap base — several sizes are tried because `noise`'s output
  // size is a function of its exact pixel content and is not guaranteed on
  // the first attempt to land under `bytes` (it should, by a wide margin, for
  // every size this suite asks for, but a loop is what makes that a checked
  // fact rather than an assumption).
  let base: Buffer | null = null;
  for (let edge = 48; edge < 512; edge += 8) {
    const candidate = await noise(edge, edge).jpeg({ quality: 90 }).toBuffer();
    if (candidate.length < bytes) {
      base = candidate;
      break;
    }
  }
  if (!base) {
    throw new Error(`could not build a base JPEG under ${bytes} bytes to pad from`);
  }

  const extraBytes = bytes - base.length;
  if (extraBytes === 0) return base;
  if (extraBytes < 4) {
    throw new Error(
      `cannot pad exactly ${extraBytes} bytes: a COM segment costs at least 4`,
    );
  }

  // The length field of a single COM segment is 2 bytes and counts itself, so
  // one segment carries at most 65533 bytes of data — 65537 including its own
  // 4 bytes of overhead. Splitting the padding evenly across just enough
  // segments to stay under that cap (rather than always maxing out each one)
  // is what keeps every segment's cost, including the last, inside [4, 65537]
  // — greedily maxing out every segment but the last can leave that last one
  // needing between 1 and 3 bytes, which no segment can supply.
  const MAX_SEGMENT_COST = 4 + 65533;
  const segmentCount = Math.ceil(extraBytes / MAX_SEGMENT_COST);
  const segments: Buffer[] = [];
  let remaining = extraBytes;
  for (let i = 0; i < segmentCount; i++) {
    const segmentsLeft = segmentCount - i;
    const cost = Math.ceil(remaining / segmentsLeft);
    const segment = Buffer.alloc(cost);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment.writeUInt16BE(cost - 4 + 2, 2); // data length + the field's own 2 bytes
    segments.push(segment);
    remaining -= cost;
  }

  // Spliced in right after the SOI marker (`base`'s first two bytes), the one
  // position every JPEG decoder accepts a comment segment.
  return Buffer.concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
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
