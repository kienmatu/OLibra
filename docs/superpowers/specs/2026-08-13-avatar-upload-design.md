# Avatar upload — preview, a 5 MB limit, and server-side processing

**Date:** 2026-08-13
**Status:** awaiting approval

A reader who wants to change their photograph today picks a file they cannot
see, from a screen that does not show the photograph they already have, against
a size limit nobody has told them, and finds out whether it worked by
submitting. This spec closes all four, and adds the processing step that makes
the limit affordable: every accepted photograph is centre-cropped to a square,
resized to 512×512 and re-encoded as WebP before it is stored.

The two halves are specified together because they are the same sentence read
from two ends. The limit a reader is shown in the helper copy, the limit the
client island refuses at, the limit `storeProposedAvatar` enforces, and the
limit `next.config.ts` lets through the framework must all be the same number —
and they are all currently `2 MB`, consistently, in seven places. Moving that
number is most of the work, and doing it in two passes would mean a window
where the screen states one limit and the server applies another.

**One decision here cannot be taken again:** the original bytes are never
stored. What a manager approves and what every screen renders is the 512×512
crop. Section 2.4 argues that is right for this product; it is called out
because reversing it later means the photographs uploaded in between are gone.

---

## 1. What is wrong

Five separate gaps on one screen,
`src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx:132-161`.

### 1.1 The reader's own photograph is never shown

The 72px circle renders the first letter of the given name and nothing else
(`page.tsx:133-136`). `fields.avatar_url` is already loaded — `avatar_url` is
one of the nine `PROFILE_FIELDS` (`src/domain/members/profile-fields.ts:71`)
and `loadReaderProfile` returns all of them — so a reader with a photograph on
file still sees a letter. Managers, meanwhile, see the real thing:
`AvatarCompareRow` renders it on both approval screens.

### 1.2 There is no preview

The file input is `sr-only` inside a label, which hides the browser's own
filename display along with the control. After picking a file, nothing on the
screen changes at all — not a thumbnail, not a filename, not a "1 tệp đã
chọn". The reader clicks **Gửi ảnh** blind.

### 1.3 The limit is never stated

The helper text reads only *"Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi
hiển thị."* `2 MB`, `MB`, `vuông` and `square` appear nowhere under `src/app/`
or `src/components/` — a fact `docs/OPERATIONS.md:581` and
`src/lib/avatar.ts:139` both already record, because OPS §4.3 attributes the
limit to "the profile screen's own copy" and that copy has never existed. A
reader learns the limit by hitting it.

### 1.4 2 MB is too small, and nothing shrinks the photograph

`AVATAR_MAX_BYTES` is `2 * 1024 * 1024` (`src/lib/avatar.ts:79`) and the bytes
are stored exactly as uploaded (`src/lib/avatar.ts:160`). A photograph from any
phone made in the last decade exceeds 2 MB routinely, so the common case is a
refusal. Meanwhile the largest surface any avatar is ever drawn at is 72px
(`page.tsx:133`) and 64px (`AvatarCompareRow`), so even a photograph that fits
under 2 MB is one to two orders of magnitude larger than anything that is
displayed.

### 1.5 `invalid_image` is not what it says

`src/lib/avatar.ts:112` is candid about this: the check "is a content-type
check and not a decode", so a file that is not really a PNG passes as long as
the browser labelled it one. The docstring correctly notes what the bucket is
protected by instead — a key that never carries the uploaded name, never ends
`.html`, and a bucket whose only public grant is `s3:GetObject`. It remains a
weaker claim than the sentence a reader is shown.

### Explicitly out of scope

- **The pending block still prints a URL.** When a proposal is outstanding, the
  reader's own pending list renders `Ảnh đại diện: https://…` as text
  (`page.tsx:169-183`), because `avatar_url` goes through the same
  `PROFILE_FIELD_LABELS` row as every text field. The manager screens special-case
  it and render the image; this screen does not. Left alone deliberately, at the
  product owner's direction.
- **Proposing removal of a photograph.** The domain supports it — the manager
  screen renders *"Bạn đọc đề nghị bỏ ảnh hiện tại."* for a `null` proposal —
  but `isUploadedFile` requires `size > 0`
  (`.../ho-so/profile-actions.ts:167`), so there is no way to ask for it from
  this screen. A separate gap, not this one.
- **B6 · Avatar retention.** A photograph set at registration arrives as a bare
  `avatarUrl` with no storage key, so nothing can delete it. Recorded on
  `src/lib/avatar.ts:63-69` and owned by master plan §7.14. Untouched here.

---

## 2. The server pipeline

`storeProposedAvatar` (`src/lib/avatar.ts:147`) gains a processing step. The
order of operations is the design:

```ts
export async function storeProposedAvatar(
  file: UploadedFile,
): Promise<{ avatarUrl: string; avatarObject: string }> {
  if (!AVATAR_TYPES.has(file.type)) {               // 1. allow-list, §3.1
    throw new ValidationFailed(refusalFor(file.type), "avatar");  // §3.4
  }
  if (file.size > AVATAR_MAX_BYTES) {               // 2. size, before the buffer
    throw new ValidationFailed("file_too_large", "avatar");
  }

  const processed = await processAvatar(                     // 3. decode + crop
    new Uint8Array(await file.arrayBuffer()),
  );

  const store = objectStore();                               // 4. store
  const key = objectKey("avatars", "webp");
  await store.put(key, processed, "image/webp");
  return { avatarUrl: store.url(key), avatarObject: key };
}
```

### 2.1 The pipeline itself

A new module, `src/lib/avatar-image.ts`, holding one exported function so that
`avatar.ts` keeps its existing job (policy and storage) and the image work can
be tested without an object store:

```ts
export const AVATAR_EDGE = 512;
export const AVATAR_QUALITY = 82;

export async function processAvatar(input: Uint8Array): Promise<Uint8Array> {
  try {
    return await sharp(input)
      .rotate()                                   // EXIF orientation, see 2.2
      .resize(AVATAR_EDGE, AVATAR_EDGE, { fit: "cover", position: "centre" })
      .webp({ quality: AVATAR_QUALITY })
      .toBuffer();
  } catch {
    throw new ValidationFailed("invalid_image", "avatar");
  }
}
```

`fit: "cover"` with `position: "centre"` is the centre-crop: the shorter edge is
scaled to 512 and the overflow on the longer edge is trimmed equally from both
sides. A portrait photograph keeps its middle, which for a photograph of a
person is where the person is.

**This closes OPS §4.3's "square", which has been an open question since B2b.**
`docs/OPERATIONS.md:581` and `src/lib/avatar.ts:139` both record the same
deadlock: OPS asks for a square photograph, but "square" has no sentence, no
code and no source, and "a refusal a reader cannot be told the reason for is
worse than no refusal". Cropping dissolves it. Photographs become square without
anything being refused, so the missing Vietnamese sentence is never needed. Both
docstrings and the OPS paragraph are rewritten to say so rather than left
describing a question that no longer exists.

### 2.2 Four things the pipeline buys beyond the byte count

**`.rotate()` with no argument applies EXIF orientation.** Phone cameras record
a portrait photograph as landscape pixels plus an orientation tag. Without this
call the stored crop is sideways, and it is the single most common way an avatar
upload ships broken. With it, the tag is applied and then discarded, so the
stored file needs no tag to be read correctly.

**EXIF is stripped**, because sharp discards metadata unless asked for
`withMetadata()`. This matters more here than it would elsewhere: the readers of
a parish library are largely children, the bucket's public grant is
`s3:GetObject` for anyone with the URL
(`tests/architecture/compose-grants-only-get-object.test.ts`), and a photograph
straight off a phone can carry the GPS coordinates of the house it was taken in.
Today those bytes are stored exactly as uploaded. This removes the exposure as a
consequence of the design rather than as a feature somebody has to remember, and
that is the honest reason to write it down: nobody will think to add it later.

**`invalid_image` becomes a true statement.** Decoding is the check. A file that
is not an image fails in `sharp()` and the `catch` turns it into the refusal the
reader is shown. `src/lib/avatar.ts:112`'s concession — "this is a content-type
check and not a decode" — is deleted rather than rephrased, and the paragraph
about what the bucket is protected by instead stays, because those defences are
still true and still load-bearing.

**Decode bombs are bounded.** sharp's default `limitInputPixels` (~268 Mpx)
refuses an image whose *decoded* dimensions are absurd regardless of how few
bytes the compressed file took. A 5 MB PNG that expands to 30000×30000 throws,
and the throw lands in the same `catch`. This is a real exposure created by
accepting larger uploads and it is closed by the library's default rather than
by anything we write.

### 2.3 800 KB is a ceiling, not a target

Measured, not estimated. A 2000×1500 JPEG of pure random noise — the worst case
for any compressor, and far worse than a photograph — through the exact pipeline
above:

```
JPEG 2000x1500 (2.6MB) -> 105828 bytes webp in 60 ms
```

**105 KB.** Output size is governed by the 512×512 WebP encode and not by the
input, so that figure is effectively the ceiling for any accepted upload; a real
photograph lands well below it. The 800 KB the product owner asked for has
roughly 8× of headroom. Section 5 pins it with a test rather than leaving it as
an expectation, so a future change to `AVATAR_EDGE` or `AVATAR_QUALITY` that
breaks it fails loudly.

### 2.4 The original is not kept

Only the processed 512×512 WebP is stored. There is no second object holding
the upload as it arrived.

The alternative — store both, serve the crop — costs a second key on every
proposal, a second deletion on every reject/cancel/approve path, and a second
entry in the retention gap B6 already tracks. `src/lib/avatar.ts:40-69` is a
long docstring about exactly how hard it already is to make sure no orphaned
object survives a decision; doubling the objects doubles that argument.

Against that, 512px is 4× the 72px the avatar is drawn at and 8× the 64px on the
approval screens. Nothing in the product displays a photograph larger than a
thumbnail, and nothing planned does.

So: not kept. Recorded here, in the module docstring, and in OPS, because the
photographs uploaded before anyone changes their mind will not be recoverable.

---

## 3. Formats, and the iPhone question

### 3.1 What is accepted

`AVATAR_TYPES` (`src/lib/avatar.ts:95`) stops being a type→extension map, since
every output is now WebP regardless of input. It becomes an input allow-list:

| Accepted in | Note |
|---|---|
| `image/jpeg` | |
| `image/png` | |
| `image/webp` | |
| `image/avif` | **new** — verified to decode; see 3.2 |

Concretely it becomes a `ReadonlySet<string>` rather than a
`Record<string, string>`. The extension half of the old table has no reader
left: `objectKey("avatars", "webp")` is now a constant call, so the property
`src/lib/avatar.ts:86` was protecting — that the table "can never ask
`objectKey` for an extension it will refuse" — reduces from four extensions
agreeing to one, and stops being a thing that can drift.

`image/jpg` stays out, for the reason already recorded at
`src/lib/avatar.ts:91`: it is not a real media type, and accepting one nothing
emits only widens what a hand-rolled request may claim to be.

### 3.2 HEIC does not decode, and the format table says it does

sharp reports `sharp.format.heif.input === true`. **That flag is about the
container, not the codec, and HEIC does not work.** Verified against a real
HEVC file built with `sips` (`file` reports "ISO Media, HEIF Image HEVC Main or
Main Still Picture Profile"), through the exact pipeline of §2.1:

```
HEIC FAILED: big.heic: bad seek to 1640686
AVIF encode+decode OK -> 14261 bytes, 400x300
```

AVIF succeeds and HEIC fails, which isolates the cause exactly: libheif *is*
linked into the prebuilt `@img/sharp-libvips-*` binaries, but the HEVC codec is
not, for patent reasons. AVIF is AV1 and royalty-free, so it survives — which is
why it costs nothing to add it to the allow-list above, and why trusting the
format table would have shipped a broken path.

### 3.3 iPhone photographs work, by a mechanism the `accept` attribute controls

iOS Safari transcodes HEIC to JPEG when a photograph is uploaded from the Photo
Library, **provided the `accept` attribute does not list HEIC**. The existing
`accept="image/jpeg,image/png,image/webp"` triggers exactly that, so iPhone
readers on the ordinary path already work today and will continue to.

**The `accept` list is therefore load-bearing and must carry a comment saying
so.** Adding `image/heic` to it — the obvious, helpful-looking change — tells
iOS to stop converting and send the raw HEIC, which sharp cannot decode. The
attribute that looks like a client-side convenience filter is in fact the thing
that makes the server path work.

### 3.4 The hole, and the sentence that fills it

A `.HEIC` reached through the Files app rather than the Photo Library can still
arrive as `image/heic`. Today that produces *"Tệp này không phải là ảnh hợp
lệ."* — wrong, and baffling for a photograph that plainly is one.

A new refusal in `src/domain/kernel/errors.ts`:

```ts
heic_not_supported:
  "Ảnh iPhone (HEIC) chưa dùng được. Bạn hãy chọn ảnh từ thư viện ảnh, hoặc lưu lại dạng JPG.",
```

`refusalFor(type)` in §2 returns `heic_not_supported` for `image/heic` and
`image/heif`, and `invalid_image` for everything else. One sentence, and the
reader is told what to do instead of being told they are wrong.

**Not doing:** a custom libvips built with libde265. It would give real HEIC
support and it costs the entire reason sharp was the easy choice — sharp is
already in the tree as Next's `optionalDependency` and already handled by the
Dockerfile's trace. A bespoke native build in the arm64 container that
`Dockerfile:7-13` documents being burned by is a poor trade for a path §3.3
already covers. Revisit if HEIC-via-Files proves common.

**Open, and cheap to settle:** §3.3's iOS behaviour is documented Safari
behaviour, not something verified on a device during this design. Worth one real
iPhone before treating the hole as narrow.

### 3.5 sharp becomes a declared dependency

`sharp@^0.35.3` moves into `dependencies` in `package.json`. It is already
installed — Next 16 declares it as an `optionalDependency` at that exact version
— so this adds nothing to disk and changes no lockfile resolution. What it buys
is that a Next upgrade which drops or moves the optional dependency breaks
`bun install`, loudly, instead of breaking uploads in production.

The pin follows the two version pins in `AGENTS.md`: recorded with its reason,
not to be "upgraded" without checking.

---

## 4. The screen

### 4.1 `AvatarProposal`, the eighth client island

A new `src/components/avatar-proposal.tsx`, `"use client"`. It takes over both
the circle and the form from `page.tsx:132-161`, because a circle that swaps to
show a preview needs the state the file input holds.

```ts
export function AvatarProposal({
  action,               // the server action, passed from the Server Component
  slug,
  currentAvatarUrl,     // fields.avatar_url — already loaded, no loader change
  initial,              // the letter shown when there is no photograph
}: { … })
```

Imports use relative specifiers, not the `@/` alias, for the reason
`src/components/phone-confirm-dialog.tsx:4` records: `vitest.config.ts` has no
`resolve.alias` for `@/`, and `tests/components/*.test.tsx` import these modules
directly.

### 4.2 It degrades to exactly today's form

`src/components/phone-confirm-dialog.tsx:31` states the pattern this follows:
with JavaScript unavailable the island never mounts, the form submits as it
always would, the server refuses, and the page re-renders carrying the refusal.
Nothing here is reachable only through the island.

So the server-rendered markup is the form as it exists today, plus §4.3's
current photograph. Every behaviour in §4.4 and §4.5 is additive.

### 4.3 The circle shows the photograph

When `currentAvatarUrl` is set, the 72px circle renders it; otherwise the
initial, as today. A plain `<img>` with an eslint disable for
`@next/next/no-img-element`, matching `AvatarCompareRow`
(`.../quan-ly/doi-thong-tin/page.tsx:101-108`) and for the same recorded reason:
`next.config.ts` configures no image optimizer for the object store's host, so
`next/image` refuses the URL outright.

This part alone needs no JavaScript and fixes §1.1.

### 4.4 The swap, and the pill that keeps it honest

On pick, the circle renders `URL.createObjectURL(file)`, revoked on change and
on unmount.

The risk this layout carries is that a circle showing the new photograph reads
as *the photograph has been changed*, when the entire domain rule is that it has
not — it is a proposal awaiting a manager (`page.tsx:27`, BR §2). The answer is
in the copy rather than the layout: while and only while a pick is staged, a
`Pill` appears beneath the circle reading **"Ảnh mới — chưa gửi"**, with
`icon={Clock}` and `tone="held"` — the tone the product already uses for *this
is reserved, not yet settled*, which is precisely the state a staged photograph
is in.

`Pill` is the shared component `AGENTS.md` directs to for exactly this ("any
other state pill"), and both its props are required so a colour-only pill cannot
be written — which is design rule 2, *status is never colour alone*, enforced by
the type rather than by review.

### 4.5 The pre-check refuses before the round-trip

A pick that is over `AVATAR_MAX_BYTES`, or whose type is outside the allow-list,
shows the refusal sentence with an `AlertTriangle` and passes `disabled` to
`SubmitButton`. That composes correctly with no change to the button:
`src/components/ui/submit-button.tsx:32` already records that "`disabled`
composes rather than replaces", so a pending submit cannot re-enable a button a
rule has closed.

**The sentence is read from `messageFor`, never retyped.** Two copies of "Ảnh
vượt quá 5 MB." is how one of them survives the next change to the limit. The
client refuses on the same rule and shows the same words as the server, and the
server refuses regardless of what the client did.

### 4.6 The copy states the limit and the crop

Replacing the single helper line:

> Ảnh JPG, PNG hoặc WEBP, tối đa 5 MB. Ảnh sẽ được cắt vuông và thu nhỏ.
> Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.

The first sentence fixes §1.3. The second sentence is new and is not
housekeeping: a reader whose photograph is about to be centre-cropped should
have been told before they choose it, not discover it afterwards on the approval
screen. The third is today's line, unchanged.

This is also the copy OPS §4.3 has been attributing a limit to since B2b. After
this change, the attribution is finally true.

---

## 5. The ripple

`2 MB` is currently consistent across seven places. Consistency is the property
that matters: a reader shown one number and refused at another is worse off than
today.

| Where | Change |
|---|---|
| `src/lib/avatar.ts:79` | `AVATAR_MAX_BYTES` → `5 * 1024 * 1024` |
| `src/domain/kernel/errors.ts:354` | `file_too_large: "Ảnh vượt quá 5 MB."`, plus `heic_not_supported` (§3.4) |
| `next.config.ts:52` | `bodySizeLimit` `"4mb"` → `"6mb"` |
| `docs/OPERATIONS.md:578` | the number in `file_too_large` |
| `docs/OPERATIONS.md:581` | the "square" open question — resolved by §2.1, rewritten rather than deleted |
| `src/lib/avatar.ts:112,139` | two docstrings that this spec makes false |
| `src/domain/members/commands/propose-avatar-change.ts:46` | the same "no aspect-ratio check" claim, restated there |
| `tests/lib/avatar-actions.test.ts:394` | the over-2 MB refusal |
| `tests/lib/avatar-over-http.test.ts` | the 1–2 MB band and the 2 MB rule |

`5 MB` is the **binary** megabyte, `5 * 1024 * 1024`, carrying forward the
reading `src/lib/avatar.ts:73-78` already fixed for 2 MB: it is what every file
manager a volunteer might check a photograph's size in reports.

**`bodySizeLimit` must stay strictly above `AVATAR_MAX_BYTES`.** This is not
arithmetic housekeeping — `src/lib/avatar.ts:128-137` explains it: a framework
limit at or below the application limit means files in the band between them are
refused by Next before any application code runs, so the reader gets a framework
error instead of the Vietnamese sentence. `"6mb"` leaves room for the multipart
envelope around a 5 MB file.

---

## 6. Testing

### Unit — `tests/lib/avatar-image.test.ts` (new)

- A 2000×1500 input produces a **512×512 WebP**.
- A non-square input is **centre-cropped**, not squashed: a marker placed in the
  centre survives, the outer edges do not.
- Worst-case noise output is **under 800 KB** (§2.3 measures ~105 KB, so this
  asserts the requirement with its margin intact).
- A JPEG carrying **EXIF orientation 6** comes out upright.
- **No EXIF** in the output.
- A non-image wearing an image content-type raises **`invalid_image`** — the
  check that only becomes real once decoding happens (§1.5).
- `limitInputPixels` — a small file with absurd decoded dimensions raises
  `invalid_image` rather than exhausting memory.

### Policy — extending `tests/lib/avatar-actions.test.ts`

- Exactly `AVATAR_MAX_BYTES` passes; one byte over raises `file_too_large`.
- `image/heic` raises **`heic_not_supported`**, not `invalid_image` (§3.4).
- `image/avif` is accepted (§3.2).
- The stored key ends `.webp` and the content-type is `image/webp` whatever went
  in.

### Over HTTP — extending `tests/lib/avatar-over-http.test.ts`

That suite exists because `bodySizeLimit` was once unconfigured and the number
the screen stated was not the number that applied. Its band test moves from 1–2
MB to **4–5 MB**, which is what actually proves the framework limit moved with
the application limit rather than being assumed to have.

### Component — `tests/components/avatar-proposal.test.tsx` (new)

The suite has no jsdom; `tests/components/*.test.tsx` render to static markup
(`tests/components/phone-confirm-dialog.test.tsx:14`). So:

- The current photograph appears in the circle when `currentAvatarUrl` is set,
  the initial when it is not.
- The helper copy names **5 MB** and the crop.
- The submit button carries **no `disabled`** on first paint — the property that
  makes §4.2's no-JavaScript path work.
- `accept` does **not** contain `heic` — §3.3's trap, pinned so a later
  well-meant widening fails the suite with the reason attached.

**Honest limit:** the preview swap, the pill and the disabling cannot be tested
here — there is no way to simulate the pick. That half rides on review, exactly
as the existing island's interaction does.

### Build — extending the Dockerfile `smoke` stage

This spec puts uploads on a native binary, in an image that installs under Bun,
compiles under Node and runs under Bun (`Dockerfile:1`). sharp is verified
present on darwin-arm64 locally; the container is a different platform, and the
existing smoke stage only checks that the landing page renders.

It gains a step that performs a real sharp encode under Bun. A missing or
mismatched linux binary then fails the build, rather than failing the first
reader who tries to change their photograph.

---

## 7. Files

**New**

- `src/lib/avatar-image.ts` — `processAvatar`, `AVATAR_EDGE`, `AVATAR_QUALITY`
- `src/components/avatar-proposal.tsx` — the island
- `tests/lib/avatar-image.test.ts`, `tests/components/avatar-proposal.test.tsx`

**Changed**

- `src/lib/avatar.ts` — limit, allow-list, `refusalFor`, the pipeline call, and
  the three docstrings this spec falsifies
- `src/domain/kernel/errors.ts` — two sentences
- `src/domain/members/commands/propose-avatar-change.ts` — docstring
- `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx` — the circle and form
  become `<AvatarProposal>`
- `next.config.ts`, `package.json`, `Dockerfile`
- `docs/OPERATIONS.md` §4.3
- `tests/lib/avatar-actions.test.ts`, `tests/lib/avatar-over-http.test.ts`
