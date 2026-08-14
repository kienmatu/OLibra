# Avatar Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader can see their photograph, preview a new one before sending it, and upload up to 5 MB — which the server centre-crops, resizes and re-encodes — while the storage key becomes the only stored fact about a photograph.

**Architecture:** `sharp` decodes each upload, centre-crops to a square, resizes to 512×512 and re-encodes as WebP inside a new pure module (`src/lib/avatar-image.ts`); `src/lib/avatar.ts` keeps policy and storage and now returns a key alone. `users.avatar_url` is dropped and `avatar_object` replaces it in `PROFILE_FIELDS`, which deletes four mechanisms that existed only to keep a URL and a key in step. Every address a browser fetches is built at read time by `ObjectStore.url()`. The screen gains its eighth client island, an additive progressive-enhancement layer over the form that already works without JavaScript.

**Tech Stack:** Next.js 16 App Router, TypeScript, PostgreSQL (`postgres` driver), S3-compatible object storage via `@aws-sdk/client-s3`, sharp 0.35.3, Vitest, Tailwind v4, Bun.

**Spec:** `docs/superpowers/specs/2026-08-13-avatar-upload-design.md`

## Global Constraints

- **Bun for everything local.** `bun install`, `bun add`, `bun run test`. Never `npm`/`pnpm`/`yarn`.
- **`bun run check` needs the test database.** Run `docker compose --profile test up -d db-test` once before starting.
- **All user-facing copy is Vietnamese with full diacritics.** Never English in the interface, never lorem ipsum, plain words over jargon.
- **No user-facing string is invented outside `src/domain/kernel/errors.ts`.** Refusal sentences come from `messageFor`; never retype one.
- **Never `@/` aliases in `src/components/`.** `vitest.config.ts` has no `resolve.alias`, and `tests/components/*.test.tsx` import these modules directly. Use relative specifiers.
- **`AVATAR_MAX_BYTES` is `5 * 1024 * 1024`** — the binary megabyte, everywhere, including the Vietnamese sentence.
- **`next.config.ts`'s `bodySizeLimit` must stay strictly above `AVATAR_MAX_BYTES`.** `"6mb"`.
- **The field is named `avatar_object`, never `avatar_key`.** `src/domain/kernel/audit.ts`'s `FORBIDDEN` list matches `key` as a whole token and `ProposeAvatarChange` audits this payload — `avatar_key` throws `RuleViolated("audit_forbidden_field")` at the first audit write.
- **`accept` on the file input must never list HEIC.** It is what makes iOS Safari transcode HEIC to JPEG. Widening it breaks iPhone uploads.
- **Design rules that apply here:** status is never colour alone (use `Pill`, both props required); one primary action per screen; touch targets ≥ 44px; forms single-column.
- **The domain may not import `src/storage/` or `@aws-sdk/*`** — `tests/architecture/boundaries.test.ts` enforces it. Bytes and keys are the surface's job.
- **Commit after every task.** Conventional-commit subject in Vietnamese, matching the repo's history.

---

### Task 1: Real image fixtures, and sharp as a declared dependency

The existing suite uploads an 8-byte PNG *signature* (`tests/lib/avatar-actions.test.ts:69`) which no decoder will accept. Once Task 4 makes decoding the check, every successful-upload test needs real bytes. This task builds the generator first so later tasks have it.

`sharp@^0.35.3` is already installed as Next 16's `optionalDependency`. Declaring it directly costs nothing on disk and makes a Next upgrade that drops it fail `bun install` loudly instead of failing uploads in production.

**Files:**
- Modify: `package.json` (dependencies)
- Create: `tests/support/images.ts`
- Test: `tests/support/images.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `realJpeg(opts?: { width?: number; height?: number; noise?: boolean }): Promise<Buffer>`
  - `realPng(opts?: { width?: number; height?: number }): Promise<Buffer>`
  - `realWebp(opts?: { width?: number; height?: number }): Promise<Buffer>`
  - `jpegWithOrientation(orientation: number): Promise<Buffer>`
  - `jpegOfAtLeast(bytes: number): Promise<Buffer>`
  - `centreMarkedPng(): Promise<Buffer>` — red centre square on a blue field, for asserting a centre-crop

- [ ] **Step 1: Declare sharp**

```bash
bun add sharp@^0.35.3
```

Then confirm `package.json`'s `dependencies` contains `"sharp": "^0.35.3"` and that `bun.lock` changed. Add this comment above nothing — instead record the reason in `AGENTS.md`'s pin section in Step 7.

- [ ] **Step 2: Write the failing test**

Create `tests/support/images.test.ts`:

```ts
import sharp from "sharp";
import { expect, test } from "vitest";
import {
  centreMarkedPng,
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
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `bun run test tests/support/images.test.ts`
Expected: FAIL — `Cannot find module './images'`.

- [ ] **Step 4: Write the fixtures**

Create `tests/support/images.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `bun run test tests/support/images.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify sharp resolves under the project's own tooling**

Run: `bun run typecheck`
Expected: no errors. If `sharp` has no bundled types, `@types/sharp` is *not* the answer — sharp 0.35 ships its own `lib/index.d.ts`. A failure here means the install did not complete; re-run `bun install`.

- [ ] **Step 7: Record the pin**

In `AGENTS.md`, under "Version pins — do not 'upgrade' these without checking", add a third bullet:

```markdown
- **`sharp` is declared directly at `^0.35.3`, matching Next 16's own
  `optionalDependency`.** Avatar uploads decode, crop and re-encode through it
  (`src/lib/avatar-image.ts`). Relying on Next's transitive copy would mean a
  Next upgrade that dropped or moved the optional dependency broke uploads in
  production rather than `bun install` in CI. The prebuilt binaries carry
  libheif but **no HEVC codec**, so AVIF decodes and HEIC does not — see
  `src/lib/avatar.ts` on why `accept` must never list HEIC.
```

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock AGENTS.md tests/support/images.ts tests/support/images.test.ts
git commit -m "test: ảnh thật để kiểm thử, và khai báo sharp trực tiếp"
```

---

### Task 2: `processAvatar` — centre-crop, resize, re-encode

The pure half of the pipeline, in its own module so it can be tested without a database or an object store.

**Files:**
- Create: `src/lib/avatar-image.ts`
- Test: `tests/lib/avatar-image.test.ts`

**Interfaces:**
- Consumes: `realJpeg`, `realPng`, `jpegWithOrientation`, `centreMarkedPng` (Task 1); `ValidationFailed` from `src/domain/kernel/errors`.
- Produces:
  - `AVATAR_EDGE: 512`
  - `AVATAR_QUALITY: 82`
  - `processAvatar(input: Uint8Array): Promise<Uint8Array>` — throws `ValidationFailed("invalid_image", "avatar")` on anything it cannot decode.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/avatar-image.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test tests/lib/avatar-image.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/avatar-image'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/avatar-image.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `bun run test tests/lib/avatar-image.test.ts`
Expected: PASS, 8 tests.

If "a decode bomb is refused" fails because the 20000×20000 PNG cannot be *created*, lower both dimensions to 17000 (289 Mpx, still over the limit) — the assertion is about `processAvatar` refusing, not about the fixture's exact size.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avatar-image.ts tests/lib/avatar-image.test.ts
git commit -m "feat: cắt vuông giữa, thu nhỏ 512px và mã hoá lại WebP cho ảnh đại diện"
```

---

### Task 3: The 5 MB limit, the input allow-list, and `heic_not_supported`

Policy only. The pipeline is not wired in until Task 4, so this task's tests still pass with the old fixtures.

**Files:**
- Modify: `src/domain/kernel/errors.ts:354`
- Modify: `src/lib/avatar.ts:72-99` (constants and allow-list), and add `refusalFor`
- Modify: `next.config.ts:52`
- Modify: `docs/OPERATIONS.md:578,581`
- Test: `tests/lib/avatar-actions.test.ts` (update), `tests/lib/avatar-over-http.test.ts` (update)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `AVATAR_MAX_BYTES: number` — now `5 * 1024 * 1024` (unchanged name, unchanged export site)
  - `AVATAR_TYPES: ReadonlySet<string>` — was `Readonly<Record<string, string>>`
  - `refusalFor(type: string): "heic_not_supported" | "invalid_image"`
  - New error code `heic_not_supported` in `ErrorCode`

- [ ] **Step 1: Write the failing tests**

In `tests/lib/avatar-actions.test.ts`, replace the test at line 394 and add two beside it:

```ts
test("a file over 5 MB is refused, and nothing is stored", async () => {
  // OPS §4.3's `file_too_large` — "Ảnh vượt quá 5 MB." The size is checked
  // before the buffer is read, so the bytes are never materialised; a real
  // oversize `File` is constructed anyway, because a test that declared a size
  // it did not have would pass against an implementation reading
  // `(await arrayBuffer()).byteLength` too late.
  const { reader } = await shelfWithReader();
  const tooBig = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "to.png", {
    type: "image/png",
  });

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        tooBig,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("file_too_large");
  expect(await proposedValues()).toBeUndefined();
});

test("an iPhone HEIC is refused with a sentence that says what to do", async () => {
  // The prebuilt sharp binaries carry libheif but no HEVC codec, so HEIC
  // cannot be decoded. `invalid_image` — "Tệp này không phải là ảnh hợp lệ." —
  // would be both wrong and baffling for a photograph that plainly is one.
  const { reader } = await shelfWithReader();
  const heic = new File([new Uint8Array(2048)], "IMG_0001.HEIC", {
    type: "image/heic",
  });

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        heic,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("heic_not_supported");
  expect(await proposedValues()).toBeUndefined();
});

test("the refusal sentence names five megabytes", async () => {
  // The number a reader is shown and the number enforced are the same fact.
  // Two copies is how one of them survives the next change to the limit.
  const { messageFor } = await import("../../src/domain/kernel/errors");
  const { AVATAR_MAX_BYTES } = await import("../../src/lib/avatar");

  expect(AVATAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  expect(messageFor("file_too_large")).toContain("5 MB");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `bun run test tests/lib/avatar-actions.test.ts`
Expected: FAIL — the oversize test refuses at 2 MB so a 5 MB+1 file still says `file_too_large` (that one may pass); the HEIC test fails with `invalid_image`; the sentence test fails on both assertions.

- [ ] **Step 3: Add the error code and change the sentence**

In `src/domain/kernel/errors.ts`, replace the `file_too_large` line and its preceding comment block (lines ~346-355) with:

```ts
  // `file_too_large`'s sentence names the number, which is what makes the limit
  // implementable: OPS attributed both "≤2 MB" and "square" to "the profile
  // screen's own copy", and that copy did not exist. Both are now real. The
  // size is stated on the screen and enforced from this sentence; "square" is
  // no longer a refusal at all, because `src/lib/avatar-image.ts` centre-crops
  // every upload instead of rejecting one that is not square.
  file_too_large: "Ảnh vượt quá 5 MB.",
  invalid_image: "Tệp này không phải là ảnh hợp lệ.",
  // A photograph, and a valid one — just in a codec the prebuilt sharp
  // binaries cannot decode (HEVC, for patent reasons). Telling a reader their
  // iPhone photo "is not a valid image" would be wrong as well as unhelpful,
  // so this sentence says what to do instead. Reached only from the Files-app
  // route: uploading from the Photo Library makes iOS Safari transcode to
  // JPEG, which is why `accept` must never list HEIC.
  heic_not_supported:
    "Ảnh iPhone (HEIC) chưa dùng được. Bạn hãy chọn ảnh từ thư viện ảnh, hoặc lưu lại dạng JPG.",
```

If `ErrorCode` is a union declared separately from `ERROR_MESSAGES`, add `heic_not_supported` to it in the same position. If it is derived with `keyof typeof ERROR_MESSAGES`, nothing else is needed — check before editing.

- [ ] **Step 4: Raise the limit and turn the allow-list into a set**

In `src/lib/avatar.ts`, replace lines 72-99 (the `AVATAR_MAX_BYTES` docblock through the end of `AVATAR_TYPES`) with:

```ts
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
 * this — see `storeProposedAvatar` below.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The content types accepted.
 *
 * An allow-list keyed on the type rather than on the uploaded filename, which
 * is attacker-controlled and, for a Vietnamese reader, frequently full of
 * diacritics `objectKey` exists to keep out of a URL.
 *
 * **A set rather than the type→extension map this used to be.** Every stored
 * object is now WebP whatever arrived, so `objectKey("avatars", "webp")` is a
 * constant call and the old table's extension half has no reader left. What
 * that table protected — that it "can never ask `objectKey` for an extension it
 * will refuse" — reduces from four extensions agreeing to one and stops being
 * able to drift.
 *
 * `image/avif` is here and `image/heic` is not, and the difference is the
 * codec rather than the container. The prebuilt `@img/sharp-libvips-*` binaries
 * link libheif but ship no HEVC decoder, for patent reasons; AVIF is AV1 and
 * royalty-free, so it decodes. `sharp.format.heif.input` reports `true` for
 * both, which is a fact about the container and would have shipped a broken
 * path if it had been trusted — verified against a real HEVC file, which fails
 * with "bad seek", while an AVIF round-trips.
 *
 * `image/jpg` is not here. It is not a real media type — browsers send
 * `image/jpeg` for a `.jpg` — and accepting a type nothing emits would only
 * widen what a hand-rolled request can claim to be.
 */
const AVATAR_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

/**
 * Which refusal an unacceptable content type earns.
 *
 * HEIC gets its own sentence because it is a photograph and a valid one, just
 * in a codec we cannot decode — "Tệp này không phải là ảnh hợp lệ." would be a
 * false statement shown to somebody holding a perfectly good picture of their
 * child.
 */
function refusalFor(type: string): "heic_not_supported" | "invalid_image" {
  return type === "image/heic" || type === "image/heif"
    ? "heic_not_supported"
    : "invalid_image";
}
```

- [ ] **Step 5: Use the set in `storeProposedAvatar`**

In `src/lib/avatar.ts`, replace the first two statements of `storeProposedAvatar` (the `extension` lookup and its `undefined` check, lines ~150-153) with:

```ts
  if (!AVATAR_TYPES.has(file.type)) {
    throw new ValidationFailed(refusalFor(file.type), "avatar");
  }
```

and replace `const key = objectKey("avatars", extension);` with `const key = objectKey("avatars", "webp");`.

- [ ] **Step 6: Raise the framework limit**

In `next.config.ts:52`, change `bodySizeLimit: "4mb"` to:

```ts
      bodySizeLimit: "6mb",
```

and extend the comment above it with:

```
       * Strictly above `AVATAR_MAX_BYTES` (5 MB, `src/lib/avatar.ts`) and not
       * equal to it: a multipart body is larger than the file inside it, so a
       * limit set *at* the application's own number refuses a maximum-size
       * photograph before any application code runs — and the reader gets a
       * framework error instead of "Ảnh vượt quá 5 MB."
```

- [ ] **Step 7: Move the over-HTTP band**

In `tests/lib/avatar-over-http.test.ts`, change the 1–2 MB band test to 4–5 MB. Both band tests deliberately avoid needing decodable bytes — one posts `application/pdf` (refused at the content type, before any decode) and the other posts `AVATAR_MAX_BYTES + 1` (refused at the size, before any decode) — so only the numbers and the prose move:

```ts
test("a photograph in the 4–5 MB band reaches application code", async () => {
  // The regression, at the new limit. 4.6 MB is between Next's default body
  // limit and this application's own, which is where a modern phone photograph
  // lands, and where the framework would answer with an untranslated 500 if
  // `bodySizeLimit` had not moved with `AVATAR_MAX_BYTES`.
  //
  // Posted as `application/pdf` on purpose: it makes the application's verdict
  // deterministic without an object store, because `storeProposedAvatar`
  // checks the content type first and refuses before it reads a byte or
  // reaches MinIO. `invalid_image` is proof the body got as far as the code
  // that decides; "Body exceeded" would be proof that it did not.
  const posted = await postPhotograph(4_600_000, "application/pdf");

  expect(posted.body).not.toContain("Body exceeded");
  expect(posted.status).toBe(303);
  expect(posted.refusal).toBe("invalid_image");
}, 60_000);
```

In the test below it, change the sentence in the comment from "Ảnh vượt quá 2 MB." to "Ảnh vượt quá 5 MB." and "a framework limit set *at* 2 MB" to "*at* 5 MB". Its body already reads `AVATAR_MAX_BYTES + 1` and needs no change.

Check the third test (`the framework limit is still a backstop…`) — if it posts a size chosen relative to the old `"4mb"`, raise it above 6 MB so it still exceeds the new framework limit.

- [ ] **Step 8: Update OPS**

In `docs/OPERATIONS.md:578`, change `- \`file_too_large\` — "Ảnh vượt quá 2 MB."` to `"Ảnh vượt quá 5 MB."` and add beneath it:

```markdown
  - `heic_not_supported` — "Ảnh iPhone (HEIC) chưa dùng được. Bạn hãy chọn ảnh từ thư viện ảnh, hoặc lưu lại dạng JPG."
```

Replace the "Open question — 'square'" paragraph at line 581 with:

```markdown
> **Resolved — "square" (2026-08-13).** This paragraph recorded that "square" could not be implemented because it had no sentence, no code and no source, and that "a refusal a reader cannot be told the reason for is worse than no refusal". It is resolved by not refusing: `src/lib/avatar-image.ts` centre-crops every upload to a 512×512 square, so photographs become square without anything being rejected and no Vietnamese sentence is needed. The size limit is now also genuinely stated on the profile screen — the copy this section had attributed it to since B2b finally exists.
```

- [ ] **Step 9: Run the full check**

Run: `bun run check`
Expected: PASS. If `avatar-actions.test.ts`'s "not one of the four image types" test now names the wrong count, reword it to "not one of the accepted image types".

- [ ] **Step 10: Commit**

```bash
git add src/domain/kernel/errors.ts src/lib/avatar.ts next.config.ts docs/OPERATIONS.md tests/lib/avatar-actions.test.ts tests/lib/avatar-over-http.test.ts
git commit -m "feat: nâng giới hạn ảnh lên 5 MB và thêm câu trả lời riêng cho ảnh HEIC"
```

---

### Task 4: Wire the pipeline into the upload path

`storeProposedAvatar` starts decoding. This is where the existing fixtures stop working and the real ones from Task 1 take over.

**Files:**
- Modify: `src/lib/avatar.ts` (`storeProposedAvatar` body and docstring)
- Test: `tests/lib/avatar-actions.test.ts`

**Interfaces:**
- Consumes: `processAvatar` (Task 2), `realPng`/`realJpeg`/`realWebp` (Task 1).
- Produces: `storeProposedAvatar` unchanged in signature — still `Promise<{ avatarUrl: string; avatarObject: string }>`. Task 5 changes it to return a key alone.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/avatar-actions.test.ts`:

```ts
test("what is stored is a 512×512 WebP, whatever was uploaded", async () => {
  // The upload is a 2000×1500 JPEG; the object is a square WebP. Fetched over
  // HTTP from the real bucket rather than asserted on a return value, because
  // what a manager and a reader actually see is the object, not the call.
  const sharp = (await import("sharp")).default;
  const { reader } = await shelfWithReader();
  const photo = new File([await realJpeg({ width: 2000, height: 1500 })], "anh.jpg", {
    type: "image/jpeg",
  });

  await proposeAvatarAction(
    uploadForm(
      { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
      photo,
    ),
  );

  const values = await proposedValues();
  const url = (values as { avatar_url: string }).avatar_url;
  expect(url).toMatch(/\.webp$/);

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const meta = await sharp(bytes).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.width).toBe(512);
  expect(meta.height).toBe(512);
  expect(bytes.length).toBeLessThan(800 * 1024);
});

test("a file wearing an image content-type but holding no image is refused", async () => {
  // `invalid_image` is a decode now, not a header check. Before this it was
  // possible to store an HTML document as long as the browser labelled it a
  // PNG — the module's own docstring conceded as much.
  const { reader } = await shelfWithReader();
  const liar = new File(
    [new TextEncoder().encode("<!doctype html><script>alert(1)</script>")],
    "anh.png",
    { type: "image/png" },
  );

  const target = await redirectedTo(
    proposeAvatarAction(
      uploadForm(
        { "tu-sach": "dong-thap", "thanh-vien": reader.membershipId },
        liar,
      ),
    ),
  );

  expect(refusalIn(target)).toBe("invalid_image");
  expect(await proposedValues()).toBeUndefined();
});
```

Add `import { realJpeg } from "../support/images";` to the file's imports.

- [ ] **Step 2: Run to verify it fails**

Run: `bun run test tests/lib/avatar-actions.test.ts`
Expected: FAIL — the stored object is still the uploaded JPEG bytes under a `.jpg` key, and the liar file is stored rather than refused.

- [ ] **Step 3: Replace every fake-image fixture in the suite**

In `tests/lib/avatar-actions.test.ts`, replace line 69's constant and line 184's helper:

```ts
// Real, decodable bytes. This was an eight-byte PNG *signature* until the
// pipeline began decoding — sufficient while `invalid_image` was a header
// check, and worthless the moment it became a real one.
const png = async (name = "anh.png") =>
  new File([await realPng()], name, { type: "image/png" });
```

Every call site becomes `await png()`. Work through them one at a time; the `pdf` fixture at line 423 keeps using bytes that are not an image — it is testing the content-type gate, which still fires first — but rename its source so it does not read as a PNG:

```ts
const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "anh.pdf", {
  type: "application/pdf",
});
```

- [ ] **Step 4: Wire the pipeline in**

In `src/lib/avatar.ts`, add the import:

```ts
import { processAvatar } from "./avatar-image";
```

and replace the body of `storeProposedAvatar` after the two guards:

```ts
  const processed = await processAvatar(new Uint8Array(await file.arrayBuffer()));

  const store = objectStore();
  const key = objectKey("avatars", "webp");
  await store.put(key, processed, "image/webp");
  return { avatarUrl: store.url(key), avatarObject: key };
```

- [ ] **Step 5: Rewrite the two docstring paragraphs this makes false**

In `storeProposedAvatar`'s docstring, replace the "**`invalid_image` is a content-type check and not a decode**" paragraph with:

```
 * **`invalid_image` is a decode.** `./avatar-image.ts` re-encodes every upload,
 * so a file that is not an image fails there and earns the refusal — the
 * header a browser attached is no longer the whole of the claim. What the
 * bucket is protected by *in addition* is unchanged and still load-bearing:
 * the key never carries the uploaded name, never ends `.html`, and is served
 * from a bucket whose only public grant is `s3:GetObject`
 * (`tests/architecture/compose-grants-only-get-object.test.ts`). The `nosniff`
 * a browser also receives is **MinIO's**, not this application's, and AWS S3
 * does not send it — recorded on `ObjectStore` in `src/storage/s3.ts`, because
 * a defence that moves with the provider must not be counted as one of ours.
```

and replace the "**No aspect-ratio check**" paragraph with:

```
 * **Every photograph is square, and none is refused for not being.** OPS §4.3
 * asked for "≤2 MB, square" and B2b recorded that "square" had no sentence, no
 * code and no source. `./avatar-image.ts` centre-crops instead, which answers
 * the requirement without inventing a refusal nobody wrote — see that module.
```

- [ ] **Step 6: Run the full check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/avatar.ts tests/lib/avatar-actions.test.ts
git commit -m "feat: xử lý ảnh trên máy chủ trước khi lưu, và invalid_image thật sự giải mã"
```

---

### Task 5: The storage key becomes the only stored fact

The largest task, and mostly deletion. `users.avatar_url` is dropped, `avatar_object` takes its place in `PROFILE_FIELDS`, and four mechanisms that existed only to keep a URL and a key in step are removed. The compiler drives most of it: renaming a member of `PROFILE_FIELDS` breaks the total label record, the write arms, the approval carry-across and the screens, all at once.

**Files:**
- Create: `src/db/migrations/20260813_01_avatar_object_only.sql`
- Create: `src/lib/avatar-url.ts`
- Modify: `src/domain/members/profile-fields.ts:71,89,344-347,362,386-395,408,544`
- Modify: `src/lib/profile-labels.ts:25,47`
- Modify: `src/domain/members/pending-proposal.ts:29-40,146-154,180`
- Modify: `src/domain/members/commands/approve-profile-change.ts:206-223,243-246,276-313`
- Modify: `src/domain/members/commands/propose-avatar-change.ts:14-25,54-65,118-123,137-141,170-179`
- Modify: `src/domain/members/profile-proposals.ts:37,43`
- Modify: `src/domain/members/registration.ts:74,301,306`
- Modify: `src/domain/members/queries/get-my-profile.ts:100`, `get-reader-detail.ts:126,145,217`, `get-pending-profile-changes.ts:124`
- Modify: `src/domain/admin/queries/get-pending-manager-changes.ts:125`
- Modify: `src/lib/avatar.ts` (`storeProposedAvatar` returns a key; `proposeAvatar` passes one)
- Modify: `src/app/quan-tri/doi-thong-tin/page.tsx:222-227`, `src/app/tu-sach/[shelf]/quan-ly/doi-thong-tin/page.tsx:252-257`
- Modify: `docs/DATABASE.md`
- Test: `tests/lib/profile-labels.test.ts:36`, `tests/invariants/inv-13-one-pending-profile-change.test.ts:301`, plus the eight other suites listed in Step 9

**Interfaces:**
- Consumes: `objectStore()` from `src/lib/object-store`.
- Produces:
  - `avatarUrl(key: string | null): string | null` from `src/lib/avatar-url.ts`
  - `PROFILE_FIELDS` with `"avatar_object"` in place of `"avatar_url"`, same position (ninth)
  - `storeProposedAvatar(file: UploadedFile): Promise<string>` — a key
  - `ProposeAvatarChangeInput` with `avatarObject: string` only

- [ ] **Step 1: Write the failing test**

Create `tests/lib/avatar-storage-identity.test.ts`:

```ts
import { expect, test } from "vitest";
import { avatarUrl } from "../../src/lib/avatar-url";

/**
 * The assertion that would have caught the half-fix in `20260809_02`.
 *
 * That migration set out to make the storage key the stored fact and the URL
 * derived — and stopped after adding the column. `ObjectStore.url()` had
 * exactly one caller in the whole codebase, at *write* time, so every row kept
 * baking `S3_PUBLIC_URL` into itself and SDD §6.8's claim that changing
 * provider "is a change of environment variables … and nothing else" stayed
 * false. Nothing tested it, because a test that reads the same env var the
 * writer wrote agrees with any implementation.
 */

test("the rendered address follows S3_PUBLIC_URL, not the row", async () => {
  const key = "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp";
  const before = process.env.S3_PUBLIC_URL;

  process.env.S3_PUBLIC_URL = "https://anh-mot.example.org";
  const first = avatarUrl(key);

  process.env.S3_PUBLIC_URL = "https://anh-hai.example.org";
  const second = avatarUrl(key);

  process.env.S3_PUBLIC_URL = before;

  expect(first).not.toBe(second);
  expect(first).toContain("anh-mot.example.org");
  expect(second).toContain("anh-hai.example.org");
  expect(second).toContain(key);
});

test("no key is no photograph", () => {
  expect(avatarUrl(null)).toBeNull();
});
```

If `objectStore()` memoises its config, this test will read a stale value — check `src/lib/object-store.ts` first. If it caches, the fix is for `avatarUrl` to call `objectStore()` per invocation and for the test to reset whatever the module caches; do not weaken the assertion.

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test tests/lib/avatar-storage-identity.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/avatar-url'`.

- [ ] **Step 3: Write the read helper**

Create `src/lib/avatar-url.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `bun run test tests/lib/avatar-storage-identity.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the migration**

Create `src/db/migrations/20260813_01_avatar_object_only.sql`:

```sql
-- The key is the only stored fact. `users.avatar_url` is dropped.
--
-- `20260809_02_avatar_object.sql` set out to do exactly this — "The storage key
-- becomes the stored fact; the URL is derived from it" — and stopped after
-- adding the column, because dropping the URL then would have stranded existing
-- rows, and because `avatar_url` was kept deliberately to represent "a
-- photograph this system did not upload and cannot delete".
--
-- Two things changed on 2026-08-13:
--
--   1. **The database is reset.** The product owner's explicit instruction, the
--      same standing assumption as the 2026-08-12 spec. So there are no rows to
--      strand, and the backfill that migration refused to write — parsing a key
--      back out of a URL, "a guess that quietly stops matching the day
--      S3_PUBLIC_URL changes" — is still not written and now never needs to be.
--   2. **Nothing supplies an external URL.** `RegistrationInput.avatarUrl`
--      existed, but no caller ever passed a value: every reference to it under
--      src/app and src/lib was a comment explaining that it existed and took no
--      key. The state this column was preserved to represent never occurred.
--
-- What this deletes in application code, all of it machinery that existed only
-- to keep two facts in step: `carryAvatar` and the erasure it defended against
-- (pending-proposal.ts), the carry-across at approval, the coupled write arms
-- in applyProfileFields, and `avatarObjectBehind` — which recovered a settled
-- photograph's key by matching an old request's proposed URL, and whose own
-- docstring called that the price of `users` keeping only the URL.
--
-- B6 · Avatar retention (master plan §7.14) closes with it: a photograph set at
-- registration now arrives as a key like any other, so "nothing in this
-- codebase can remove it" stops being true.

alter table users drop column avatar_url;

comment on column users.avatar_object is
  'Object storage key (src/storage/s3.ts objectKey). The only stored fact '
  'about a photograph; every URL is derived from it with url() at read time, '
  'so no row carries S3_PUBLIC_URL and changing provider stays what SDD 6.8 '
  'says it is: a change of environment variables.';
```

- [ ] **Step 6: Rename the field**

In `src/domain/members/profile-fields.ts:71`, change `"avatar_url",` to `"avatar_object",`.

In the same file:
- line 89's comment: change `` `email` and `avatar_url` are `` to `` `email` and `avatar_object` are ``.
- lines 341-347: delete the `avatarObject` out-of-band read entirely (the `const avatarObject = (patch as …)` block and its docstring).
- line 362: change `avatar_url, avatar_object` to `avatar_object`.
- lines 386-395: replace both arms and the long SQL comment with a single ordinary arm:

```sql
      avatar_object = case when ${has("avatar_object")} then ${val("avatar_object")} else prev.avatar_object end
```

- line 408: change `prev.avatar_url as before_avatar_url, u.avatar_url as after_avatar_url,` to `prev.avatar_object as before_avatar_object, u.avatar_object as after_avatar_object` and delete the now-duplicated `avatar_object` returning line at 409.
- line 544: change `avatar_url` to `avatar_object` in that select list.

In `src/lib/profile-labels.ts`, change line 47 to `avatar_object: "Ảnh đại diện",` and rewrite the bullet at line 25:

```
 * - `avatar_object` → **Ảnh đại diện** — the label names what the field is to
 *   a reader, which is their photograph, not the storage identifier it holds.
 *   `profile-fields.ts` once argued this field could not have a label because
 *   it would "demand a Vietnamese label for a storage identifier no reader ever
 *   sees"; that objection went with the URL it was weighed against, since a
 *   reader never saw that either.
```

- [ ] **Step 7: Delete the four mechanisms**

**`carryAvatar`** — in `src/domain/members/pending-proposal.ts`, delete the function (lines 146-154) and change `writePendingProposal` to use `args.next.proposed` directly:

```ts
  const proposed = args.next.proposed as JSONValue;
```

Remove `avatarObject` from `writePendingProposal`'s `args` type and from its two call sites. Replace the header's numbered reason **2** with:

```
 * **2. `avatar_object` surviving a proposal that is not about the photograph.**
 * This was the failure that made the extraction necessary. It is no longer
 * possible: `avatar_object` is a `ProfileField` as of 2026-08-13, so
 * `pickProfileFields` keeps it like any other and there is nothing to carry.
 * `carryAvatar` — the function that used to graft the key back on — is gone
 * with the second fact it existed to reconcile.
```

Keep `AVATAR_OBJECT` and `avatarObjectOf`: the constant's audit reasoning still stands, and `avatarObjectOf` is still how the reject and cancel paths read a key out of a raw `proposed_values` bag.

**The carry-across** — in `approve-profile-change.ts`, delete lines 219-223 (`if (proposed.avatar_url !== undefined) { … }`) and the paragraph of the comment above them that begins "**`avatar_object` is carried across explicitly, and B6 is why.**".

**`avatarObjectBehind`** — delete the whole function (lines 276-313) and replace the superseded computation at 243-246 with:

```ts
  // Read off the authoritative before/after rather than from `proposed_values`,
  // so an approval that did not move the photograph hands back nothing to
  // delete. This used to need a lookup — `avatarObjectBehind` searched earlier
  // approved requests for one whose proposed URL matched the person's current
  // one, because `users` kept only a URL and a settled photograph therefore had
  // no key beside it. The key is on the row now, so the lookup is the answer.
  const supersededAvatar =
    before.avatar_object !== null && after.avatar_object !== before.avatar_object
      ? before.avatar_object
      : null;
```

Remove the now-unused `avatarObjectOf` import from this file if nothing else in it uses it.

**The two-input command** — in `propose-avatar-change.ts`: delete `avatarUrl` from `ProposeAvatarChangeInput`, delete its `blank()` check (lines 118-120), change the merge at 137-141 to

```ts
  const next = mergeProposal(
    pending?.contents ?? null,
    { avatar_object: input.avatarObject.trim() },
    current,
  );
```

change `writePendingProposal`'s call to drop `avatarObject`, and change the audit payload at 170-179 to:

```ts
      before: { avatar_object: next.previous.avatar_object ?? null },
      after: { [AVATAR_OBJECT]: input.avatarObject.trim() },
```

Rewrite the docstring section "What is stored, and the one name that is not arbitrary" to say the key is now an ordinary proposed field copied to `users.avatar_object` on approval, and keep the `avatar_key`/audit paragraph verbatim — that reasoning is untouched.

- [ ] **Step 8: Follow the compiler through the rest**

Run: `bun run typecheck`

Work the list it produces. The expected sites, all mechanical:
- `profile-proposals.ts:43` — `(f) => f !== "avatar_url"` becomes `(f) => f !== "avatar_object"`; update the comment at line 37.
- `registration.ts` — `avatarUrl?: string | null` becomes `avatarObject?: string | null`; the insert's column list and value at 301/306 follow.
- `get-my-profile.ts:100`, `get-pending-profile-changes.ts:124`, `get-pending-manager-changes.ts:125` — `u.avatar_url` becomes `u.avatar_object`.
- `get-reader-detail.ts:126,145,217` — the row type, the select and `avatarUrl: row.avatar_url` become `avatarObject: row.avatar_object`. Rename the exposed field to `avatarObject`; do not derive a URL in a query, which would put `src/storage` inside the domain and fail `boundaries.test.ts`.
- `src/lib/avatar.ts` — `storeProposedAvatar` returns `key` and its return type becomes `Promise<string>`; `proposeAvatar` becomes:

```ts
  const avatarObject = await storeProposedAvatar(file);

  let superseded: string | null;
  try {
    ({ supersededAvatarObject: superseded } = await submitCommand(
      shelfSlug,
      proposeAvatarChange,
      { membershipId, avatarObject },
    ));
  } catch (err) {
```

- Both `doi-thong-tin/page.tsx` screens — the branch becomes `field === "avatar_object"`, and the two props become derived URLs:

```tsx
                    <AvatarCompareRow
                      key={field}
                      label={PROFILE_FIELD_LABELS[field]}
                      current={avatarUrl(request.currentValues.avatar_object)}
                      proposed={avatarUrl(request.proposedValues.avatar_object ?? null)}
                      initial={initial}
                    />
```

with `import { avatarUrl } from "@/lib/avatar-url";` added to each.

- `src/lib/page-data.ts:62` and `src/lib/audit-log.ts:97` — comments naming `users.avatar_url`; update the prose.

- [ ] **Step 9: Update the suites the rename touches**

- `tests/lib/profile-labels.test.ts:36` — `avatar_url: "Ảnh đại diện"` becomes `avatar_object: "Ảnh đại diện"`.
- `tests/invariants/inv-13-one-pending-profile-change.test.ts:301` — the value becomes a key: `avatar_object: "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp"`. Update the comment at 324 that explains why the avatar is inserted directly rather than proposed — the reason (it belongs to `ProposeAvatarChange`, not `ProposeProfileChange`) is unchanged, only the field name.
- `tests/lib/audit-log.test.ts`, `tests/domain/members/register-membership.test.ts`, `propose-avatar-change.test.ts`, `profile-change-lifecycle.test.ts`, `profile-fields.test.ts`, `profile-change-concurrency.test.ts`, `own-profile-and-queue.test.ts` — rename `avatar_url`/`avatarUrl` to `avatar_object`/`avatarObject` and replace URL-shaped values with key-shaped ones (`avatars/<uuid>.webp`). Any assertion that a proposal carries *both* a URL and a key now asserts it carries one key.
- `tests/architecture/boundaries.test.ts` — check whether its `update users` grep list names `avatar_url`; if so, rename.

- [ ] **Step 10: Add the invariant test for the collapsed mechanism**

Append to `tests/lib/avatar-storage-identity.test.ts` — this needs the database, so follow the imports and `beforeEach(resetDatabase)` pattern of `tests/domain/members/profile-change-lifecycle.test.ts`:

```ts
test("a proposal about a phone number leaves a pending photograph's key alone", async () => {
  // The `carryAvatar` failure mode, asserted after the function that prevented
  // it was deleted. `pickProfileFields` used to drop `avatar_object`, so a
  // second proposal rebuilt from its result erased the key while keeping the
  // URL — leaving an image nothing could ever delete. The key is an ordinary
  // ProfileField now, so it survives for the same reason `email` does.
  const shelf = await makeShelf(sql);
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const key = "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp";

  await runCommand(sql, readerCtx(reader), proposeAvatarChange, {
    avatarObject: key,
  });
  await runCommand(sql, readerCtx(reader), proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0987654321" },
  });

  const [row] = await sql<{ proposed_values: Record<string, unknown> }[]>`
    select proposed_values from profile_change_requests
     where user_id = ${reader.userId} and status = 'pending'
  `;
  expect(row.proposed_values.avatar_object).toBe(key);
  expect(row.proposed_values.phone).toBe("0987654321");
});
```

- [ ] **Step 11: Reset the database and run everything**

```bash
docker compose down -v
docker compose up -d
bun run db:migrate
bun run db:seed
```

Then: `bun run check`
Expected: PASS.

- [ ] **Step 12: Update DATABASE.md**

Find the `users` table definition and the §4.11 `jsonb` discussion. Remove `avatar_url` from the column list, and add a line to §4.11 recording that `proposed_values` now carries `avatar_object` as an ordinary profile field rather than as a companion to a URL.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: khoá lưu trữ là dữ liệu duy nhất được lưu về ảnh đại diện"
```

---

### Task 6: The reader sees their photograph, and previews a new one

The eighth client island. Everything it adds is additive over a form that already works without JavaScript.

**Files:**
- Create: `src/components/avatar-proposal.tsx`
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx:132-161`
- Test: `tests/components/avatar-proposal.test.tsx`

**Interfaces:**
- Consumes: `avatarUrl` (Task 5), `messageFor`/`ErrorCode` from `src/domain/kernel/errors`, `AVATAR_MAX_BYTES` from `src/lib/avatar`, `Pill`, `SubmitButton`.
- Produces: `AvatarProposal({ action, slug, currentAvatarUrl, initial })`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/avatar-proposal.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AvatarProposal } from "../../src/components/avatar-proposal";

/**
 * No jsdom is configured (`vitest.config.ts` sets no `environment`), so these
 * render to a static string — the same limitation
 * `tests/components/phone-confirm-dialog.test.tsx` records. What can be
 * asserted is the first paint, which is exactly the paint that has to work
 * with JavaScript unavailable. The preview swap, the pill and the disabling
 * cannot be simulated here and ride on review.
 */

const noop = async () => {};

function html(props: Partial<Parameters<typeof AvatarProposal>[0]> = {}) {
  return renderToStaticMarkup(
    <AvatarProposal
      action={noop}
      slug="dong-thap"
      currentAvatarUrl={null}
      initial="L"
      {...props}
    />,
  );
}

test("the circle shows the photograph when there is one", () => {
  const markup = html({ currentAvatarUrl: "https://anh.example.org/a.webp" });
  expect(markup).toContain("https://anh.example.org/a.webp");
});

test("the circle shows the initial when there is none", () => {
  const markup = html();
  expect(markup).not.toContain("<img");
  expect(markup).toContain("L");
});

test("the copy states the limit and that the photograph will be cropped", () => {
  const markup = html();
  expect(markup).toContain("5 MB");
  expect(markup).toContain("cắt vuông");
});

test("the submit button is not disabled on first paint", () => {
  // With JavaScript unavailable the island never mounts and the form submits
  // as it always would. A `disabled` attribute in the server-rendered markup
  // would make the no-JavaScript path dead rather than merely plainer.
  const button = html().match(/<button\b[^>]*>/)?.[0];
  expect(button, "no <button> found").toBeDefined();
  expect(button?.replace(/\sclass="[^"]*"/, "")).not.toMatch(/\bdisabled(?:\s|>|=)/);
});

test("accept does not list HEIC", () => {
  // Load-bearing, and the opposite of what it looks like. iOS Safari
  // transcodes HEIC to JPEG on upload *because* this attribute omits it;
  // listing HEIC tells iOS to send the original, which sharp's prebuilt
  // binaries cannot decode. Pinned so a well-meant widening fails here with
  // the reason attached.
  const accept = html().match(/accept="([^"]*)"/)?.[1] ?? "";
  expect(accept).not.toContain("heic");
  expect(accept).not.toContain("heif");
  expect(accept).toContain("image/jpeg");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run test tests/components/avatar-proposal.test.tsx`
Expected: FAIL — `Cannot find module '../../src/components/avatar-proposal'`.

- [ ] **Step 3: Write the island**

Create `src/components/avatar-proposal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Clock } from "lucide-react";
// Relative specifiers, not the `@/` alias, for the reason
// `./phone-confirm-dialog.tsx` records: `vitest.config.ts` has no
// `resolve.alias` for `@/`, and `tests/components/*.test.tsx` import this
// module directly.
import { messageFor, type ErrorCode } from "../domain/kernel/errors";
import { AVATAR_MAX_BYTES, AVATAR_ACCEPT } from "../lib/avatar";
import { Pill } from "./ui/pill";
import { SubmitButton } from "./ui/submit-button";

/**
 * The reader's photograph, and the proposal to change it — the eighth client
 * component in this codebase.
 *
 * **Everything here is additive over a form that already works.**
 * `./phone-confirm-dialog.tsx` states the pattern: with JavaScript unavailable
 * this component never mounts, the `<form>` submits exactly as it would have,
 * `storeProposedAvatar` applies the same rules, and the page re-renders
 * carrying the refusal. Nothing below is reachable only through the island —
 * the size and type checks here are the server's rules asked earlier and more
 * pleasantly, never the rules themselves.
 *
 * **The circle swaps, and the pill is what keeps that honest.** Showing the
 * chosen photograph where the current one was reads as *the photograph has been
 * changed*, when the whole domain rule is that it has not — it is a proposal
 * awaiting a manager (BR §2). So while, and only while, a pick is staged, a
 * `Pill` reading "Ảnh mới — chưa gửi" sits beneath it: an icon, a Vietnamese
 * word and a colour together, which is design rule 2 and which `Pill` enforces
 * by making both props required.
 *
 * **The refusal sentence is read from `messageFor`, never retyped.** Two copies
 * of "Ảnh vượt quá 5 MB." is how one of them survives the next change to the
 * limit.
 */
export function AvatarProposal({
  action,
  slug,
  currentAvatarUrl,
  initial,
}: {
  action: (form: FormData) => Promise<void>;
  slug: string;
  currentAvatarUrl: string | null;
  initial: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ErrorCode | null>(null);
  // Held so the object URL can be revoked on the next pick and on unmount —
  // a blob URL kept alive for the life of the page is a leak the browser
  // cannot collect on its own.
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  function choose(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;

    if (file === null) {
      setPreview(null);
      setRefusal(null);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setPreview(null);
      setRefusal("file_too_large");
      return;
    }
    if (file.type === "image/heic" || file.type === "image/heif") {
      setPreview(null);
      setRefusal("heic_not_supported");
      return;
    }
    if (!AVATAR_ACCEPT.includes(file.type)) {
      setPreview(null);
      setRefusal("invalid_image");
      return;
    }

    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setRefusal(null);
  }

  const shown = preview ?? currentAvatarUrl;

  return (
    <div className="mt-8 flex items-start gap-4">
      <div className="shrink-0">
        <div className="flex size-[72px] items-center justify-center overflow-hidden rounded-full bg-paper text-[26px] font-semibold text-leather">
          {shown ? (
            // A plain <img>, deliberately: `next.config.ts` configures no image
            // optimizer for the object store's host, so `next/image` would
            // refuse the URL outright. `AvatarCompareRow` on both approval
            // screens carries the identical note.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </div>
        {preview ? (
          <Pill
            icon={Clock}
            label="Ảnh mới — chưa gửi"
            tone="held"
            className="mt-2"
          />
        ) : null}
      </div>

      <form action={action}>
        <input type="hidden" name="tu-sach" value={slug} />
        <label className="inline-flex cursor-pointer items-center gap-2 text-[15px] font-medium text-leather">
          <Camera aria-hidden className="size-[18px]" strokeWidth={1.75} />
          Đề nghị đổi ảnh
          <input
            type="file"
            name="anh"
            // Never list HEIC here. iOS Safari transcodes a HEIC photograph to
            // JPEG on upload precisely *because* this attribute omits it;
            // adding it tells iOS to send the original, which the prebuilt
            // sharp binaries cannot decode. See `src/lib/avatar.ts`.
            accept={AVATAR_ACCEPT.join(",")}
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="mt-1.5 text-[13px] text-meta">
          Ảnh JPG, PNG hoặc WEBP, tối đa 5 MB. Ảnh sẽ được cắt vuông và thu nhỏ.
        </p>
        <p className="mt-1 text-[13px] text-meta">
          Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.
        </p>
        {refusal ? (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] text-overdue">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            {messageFor(refusal)}
          </p>
        ) : null}
        <SubmitButton variant="quiet" size="sm" className="mt-2" disabled={refusal !== null}>
          Gửi ảnh
        </SubmitButton>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Export the accept list**

The island and the server must agree on which types are acceptable, and the island needs them as an ordered array for the `accept` attribute. In `src/lib/avatar.ts`, add beside `AVATAR_TYPES`:

```ts
/**
 * The same allow-list, ordered, for the file input's `accept` attribute.
 *
 * Derived from one source so the control cannot offer a type the server
 * refuses. `AVATAR_TYPES` stays the set the server tests against; this is the
 * spelling a browser wants.
 */
export const AVATAR_ACCEPT: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];
```

and rebuild `AVATAR_TYPES` from it: `const AVATAR_TYPES: ReadonlySet<string> = new Set(AVATAR_ACCEPT);`

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `bun run test tests/components/avatar-proposal.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Wire it into the page**

In `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx`, replace lines 132-161 (the circle `<div>` and the `<form>`) with:

```tsx
        <AvatarProposal
          action={proposeAvatarAction}
          slug={slug}
          currentAvatarUrl={avatarUrl(fields.avatar_object)}
          // The last word of a Vietnamese name is the given name.
          initial={fields.full_name?.split(" ").at(-1)?.charAt(0) ?? ""}
        />
```

Add the two imports, and delete the now-unused `Camera` and `SubmitButton` imports if nothing else on the page uses them. Update the page docstring's paragraph at line 48 — `avatar_url` is now `avatar_object`, and the reason it is not among the fields the form posts is unchanged.

- [ ] **Step 7: Run the full check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 8: Verify it in the browser**

Start the dev server and open the profile page as a signed-in reader. Confirm: the current photograph renders in the circle; picking a file swaps it and shows the pill; picking a 6 MB file shows "Ảnh vượt quá 5 MB." and disables **Gửi ảnh**; submitting a real photograph lands a 512×512 WebP and the manager's approval screen shows both.

- [ ] **Step 9: Commit**

```bash
git add src/components/avatar-proposal.tsx src/lib/avatar.ts "src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx" tests/components/avatar-proposal.test.tsx
git commit -m "feat: xem trước ảnh và hiện ảnh hiện tại trên trang hồ sơ"
```

---

### Task 7: The pending block renders the photograph

Forced by Task 5, not chosen: the block prints `{label}: {value}`, and the value is now a storage key rather than a URL — meaningless to a reader where the URL was merely ugly.

**Files:**
- Modify: `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx:163-183`

**Interfaces:**
- Consumes: `avatarUrl` (Task 5), `PROFILE_FIELD_LABELS`, `proposedFields`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

There is no test harness for this page's markup (it is an async Server Component reading a database). Assert on the data shape instead — add to `tests/lib/avatar-storage-identity.test.ts`:

```ts
test("a pending avatar proposal is named by key, so a screen must render it as an image", async () => {
  // The reader's pending block prints `{label}: {value}` for every proposed
  // field. When the value was a URL that was ugly; now it is a storage key,
  // which is meaningless. This test pins the shape the screen has to handle —
  // `proposedFields` lists the avatar, and its value is a key, not a URL.
  const { proposedFields } = await import("../../src/lib/profile-labels");
  const proposed = {
    avatar_object: "avatars/9f2c1e3a-4b5d-4e6f-8a9b-0c1d2e3f4a5b.webp",
  };

  expect(proposedFields(proposed)).toContain("avatar_object");
  expect(proposed.avatar_object).not.toMatch(/^https?:/);
});
```

- [ ] **Step 2: Run it**

Run: `bun run test tests/lib/avatar-storage-identity.test.ts`
Expected: PASS immediately — this pins the shape rather than driving new code. The failing artefact is the screen, which the next step fixes and Step 5 verifies by eye.

- [ ] **Step 3: Render the image instead of the value**

In `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx`, replace the `<li>` body inside the pending block's `.map` with a branch:

```tsx
              {proposedFields(pending.proposedValues).map((f) =>
                f === "avatar_object" ? (
                  <li key={f}>
                    {PROFILE_FIELD_LABELS[f]}
                    <span className="mt-2 flex items-center gap-3">
                      <span className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-paper text-[18px] font-semibold text-leather">
                        {avatarUrl(fields.avatar_object) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarUrl(fields.avatar_object) ?? ""}
                            alt="Ảnh hiện tại"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span aria-hidden>
                            {fields.full_name?.split(" ").at(-1)?.charAt(0) ?? ""}
                          </span>
                        )}
                      </span>
                      <ArrowRight aria-hidden className="size-4 shrink-0 text-leather" strokeWidth={2} />
                      <span className="flex size-16 items-center justify-center overflow-hidden rounded-full border-2 border-terracotta bg-terracotta/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={avatarUrl(pending.proposedValues.avatar_object ?? null) ?? ""}
                          alt="Ảnh bạn đề nghị"
                          className="size-full object-cover"
                        />
                      </span>
                    </span>
                  </li>
                ) : (
                  <li key={f}>
                    {PROFILE_FIELD_LABELS[f]}:{" "}
                    <span className="font-semibold">
                      {pending.proposedValues[f] ?? "(bỏ trống)"}
                    </span>
                    {pending.previousValues[f] !== undefined ? (
                      <span className="text-meta">
                        {" "}
                        · hiện tại {pending.previousValues[f] ?? "chưa có"}
                      </span>
                    ) : null}
                  </li>
                ),
              )}
```

Add `ArrowRight` to the `lucide-react` import. `alt` text is meaningful here rather than empty, because unlike `AvatarCompareRow` these two images are not introduced by an adjacent label naming each one.

- [ ] **Step 4: Run the full check**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Verify by eye**

Propose a photograph as a reader, then reload the profile page. The pending block shows the current photograph, an arrow, and the proposed one — not a line of text ending `.webp`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx" tests/lib/avatar-storage-identity.test.ts
git commit -m "feat: khối chờ duyệt hiện ảnh thay vì in đường dẫn"
```

---

### Task 8: The build proves sharp works under Bun

Uploads now depend on a native binary, in an image that installs under Bun, compiles under Node and runs under Bun. sharp is verified on darwin-arm64 locally; the container is a different platform, and the existing smoke stage only checks that the landing page renders.

**Files:**
- Modify: `Dockerfile:132-150` (the `smoke` stage)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Extend the smoke stage**

In `Dockerfile`, add a second probe to the `smoke` stage, after the landing-page check and before the final `process.exit`:

```dockerfile
# Uploads decode, crop and re-encode through sharp, a native binding. The
# landing page renders without ever loading it, so a linux binary that is
# missing or built for the wrong platform would pass the probe above and fail
# the first reader who tried to change their photograph. This encodes a real
# image under Bun, which is the runtime that actually serves requests.
RUN bun -e ' \
      const sharp = (await import("sharp")).default; \
      const out = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c56b4a" } }) \
        .resize(32, 32, { fit: "cover", position: "centre" }) \
        .webp({ quality: 82 }) \
        .toBuffer(); \
      const meta = await sharp(out).metadata(); \
      if (meta.format !== "webp" || meta.width !== 32) { \
        console.error(`smoke: sharp produced ${meta.format} ${meta.width}px`); \
        process.exit(1); \
      } \
      console.log("smoke: sharp encoded a WebP under Bun"); \
    '
```

- [ ] **Step 2: Build the smoke target**

Run: `docker build --target smoke .`
Expected: both probes print their success lines and the build succeeds.

If sharp resolves at build but not at runtime, the cause is `output: "standalone"`'s trace: `Dockerfile:68` already names sharp as a native binding kept external to the webpack bundle, so it should be carried. If it is not, add it explicitly beside the `postgres` copy at line 103 — and record why in a comment, following that line's own example.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "ci: smoke test chứng minh sharp chạy được dưới Bun trong image"
```

---

## Self-Review

**Spec coverage.** Walked each section of `2026-08-13-avatar-upload-design.md`:

| Spec | Task |
|---|---|
| §1.1 photograph never shown | 6 |
| §1.2 no preview | 6 |
| §1.3 limit never stated | 6 (copy), 3 (the number) |
| §1.4 2 MB too small, nothing shrinks | 3, 2, 4 |
| §1.5 `invalid_image` not a decode | 2, 4 |
| §1.6 rows bake `S3_PUBLIC_URL` | 5 |
| §2.1-2.5 storage identity, migration, deletions | 5 |
| §3.1-3.4 pipeline, EXIF, bombs, 800 KB, no original | 2 |
| §4.1-4.5 allow-list, HEIC, AVIF, accept, sharp declared | 3, 1 (declaration), 6 (`accept`) |
| §5.1-5.7 island, degradation, circle, pill, pre-check, copy, pending block | 6, 7 |
| §6 ripple table | 3 (limit sites), 5 (field sites) |
| §7 testing | every task; storage-identity suite in 5 |
| §7 Dockerfile smoke | 8 |

Two spec items deliberately have no task, both recorded as out of scope in §1: proposing *removal* of a photograph, and the `AvatarCompareRow` duplication between the two approval screens (each page keeps its own copy, as today).

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Two steps say "check before editing" — Task 3 Step 3 on how `ErrorCode` is declared, and Task 5 Step 1 on whether `objectStore()` memoises. Both name the exact file to look at and what to do in either case, which is a conditional instruction rather than a gap.

**Type consistency.** Checked across tasks: `processAvatar(input: Uint8Array): Promise<Uint8Array>` (defined Task 2, used Task 4); `avatarUrl(key: string | null): string | null` (defined Task 5 Step 3, used in Tasks 5, 6, 7); `storeProposedAvatar` returns `{ avatarUrl, avatarObject }` through Task 4 and `Promise<string>` from Task 5 Step 8 onward — Task 4's test reads `avatar_url` out of `proposedValues()` and Task 5 Step 9 covers renaming it in the suites; `AVATAR_ACCEPT` is introduced in Task 6 Step 4 and consumed by the island in Step 3 of the same task, so the steps are ordered accordingly. `AVATAR_TYPES` changes shape in Task 3 and is rebuilt from `AVATAR_ACCEPT` in Task 6 — the same identifier, one definition at a time.

**One ordering hazard worth stating.** Task 5 Step 11 runs `docker compose down -v`, which destroys the development database and the MinIO bucket. Everything before it must be committed, and any locally-uploaded photographs are gone. That is the reset the spec assumes.
