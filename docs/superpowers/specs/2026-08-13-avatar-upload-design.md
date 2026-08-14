# Avatar upload — preview, a 5 MB limit, server-side processing, and the key as the stored fact

**Date:** 2026-08-13
**Status:** awaiting approval

A reader who wants to change their photograph today picks a file they cannot
see, from a screen that does not show the photograph they already have, against
a size limit nobody has told them, and finds out whether it worked by
submitting. Behind that screen, the bytes are stored exactly as uploaded and the
row keeps an absolute URL with `S3_PUBLIC_URL` baked into it.

This spec closes all of it: a preview and a stated limit on the screen, a 5 MB
limit with server-side centre-crop, resize and re-encode behind it, and
`users.avatar_object` — the storage key — as the single stored fact, with the
URL derived at read time.

The three land together because they are one sentence read from three ends. The
limit shown in the copy, refused at by the island, enforced by
`storeProposedAvatar` and allowed through by `next.config.ts` must be the same
number; and the processing step rewrites the same function that decides what
gets stored under what key. Splitting them means a window where the screen
states one limit and the server applies another, and two passes over
`src/lib/avatar.ts`.

**This spec assumes a development database that will be dropped and reseeded.**
The migration in §2 drops `users.avatar_url` with no backfill. That is the
product owner's explicit instruction (2026-08-13) and follows the same practice
as the 2026-08-12 spec. It is recorded here because it is the one decision in
this document that cannot be taken again once a parish has real data.

**A second decision that cannot be taken again:** the original bytes are never
stored. What a manager approves and every screen renders is the 512×512 crop.
§3.4 argues that is right for this product.

---

## 1. What is wrong

Six gaps. Five are on one screen,
`src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx:132-161`; the sixth is
underneath it.

### 1.1 The reader's own photograph is never shown

The 72px circle renders the first letter of the given name and nothing else
(`page.tsx:133-136`). The value is already loaded — the avatar is one of the
nine `PROFILE_FIELDS` (`src/domain/members/profile-fields.ts:71`) and
`loadReaderProfile` returns all of them — so a reader with a photograph on file
still sees a letter. Managers see the real thing on both approval screens.

### 1.2 There is no preview

The file input is `sr-only` inside a label, which hides the browser's own
filename display along with the control. After picking a file nothing on the
screen changes — no thumbnail, no filename, no "1 tệp đã chọn". The reader
clicks **Gửi ảnh** blind.

### 1.3 The limit is never stated

The helper text reads only *"Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi
hiển thị."* `2 MB`, `MB`, `vuông` and `square` appear nowhere under `src/app/`
or `src/components/` — a fact `docs/OPERATIONS.md:581` and
`src/lib/avatar.ts:139` both already record, because OPS §4.3 attributes the
limit to "the profile screen's own copy" and that copy has never existed. A
reader learns the limit by hitting it.

### 1.4 2 MB is too small, and nothing shrinks the photograph

`AVATAR_MAX_BYTES` is `2 * 1024 * 1024` (`src/lib/avatar.ts:79`) and the bytes
are stored exactly as uploaded (`src/lib/avatar.ts:160`). Any phone made in the
last decade exceeds 2 MB routinely, so the common case is a refusal. Meanwhile
the largest surface an avatar is ever drawn at is 72px (`page.tsx:133`) and 64px
on the approval screens — so even a photograph that fits is one to two orders of
magnitude larger than anything displayed.

### 1.5 `invalid_image` is not what it says

`src/lib/avatar.ts:112` is candid: the check "is a content-type check and not a
decode", so a file that is not really a PNG passes as long as the browser
labelled it one. The docstring correctly notes what the bucket is protected by
instead — an opaque key that never carries the uploaded name, never ends
`.html`, in a bucket whose only public grant is `s3:GetObject`. It remains a
weaker claim than the sentence a reader is shown.

### 1.6 Every row bakes `S3_PUBLIC_URL` into itself

`users.avatar_url` holds an absolute URL. This was diagnosed a year's worth of
care ago and only half-fixed: migration `20260809_02_avatar_object.sql` opens
with *"The storage key becomes the stored fact; the URL is derived from it"* and
names the consequence directly —

> It baked `S3_PUBLIC_URL` into every row. SDD §6.8's whole claim is that
> changing provider "is a change of environment variables — endpoint, region,
> bucket, credentials — and nothing else". A stored absolute URL makes that
> false: moving to R2, or putting a CDN in front, would strand every avatar
> already written.

It added `users.avatar_object` and promised the URL would be *"rebuilt on
read"*. **That half never landed.** `ObjectStore.url()` has exactly one caller
in the entire codebase:

```
src/lib/avatar.ts:161:  return { avatarUrl: store.url(key), avatarObject: key };
```

That is **write** time. There are zero read-time callers. So deletion works
(the migration's goal 1) while the portability claim is still false, and every
approval writes another row in the shape the migration objected to.

### Explicitly out of scope

- **Proposing removal of a photograph.** The domain supports it — the manager
  screen renders *"Bạn đọc đề nghị bỏ ảnh hiện tại."* for a null proposal — but
  `isUploadedFile` requires `size > 0` (`.../ho-so/profile-actions.ts:167`), so
  there is no way to ask for it from this screen. A separate gap.

**No longer out of scope, and not by preference.** The reader's pending block
prints `Ảnh đại diện: <value>` as text (`page.tsx:169-183`). Today that value is
a URL, which is ugly. After §2 it is a storage key, which is meaningless. So the
pending block must special-case the avatar and render the image, exactly as the
manager screens do. §5.7.

**B6 · Avatar retention closes as a side effect.** `src/lib/avatar.ts:63-69`
records that a photograph set at registration "arrives as a bare `avatarUrl`
with no key anywhere … so nothing in this codebase can remove it", and books it
as master plan §7.14. §2.5 changes registration to take a key, so the state that
gap describes stops being representable.

---

## 2. The stored fact is the key

### 2.1 The decision

`users.avatar_url` is **dropped**. `users.avatar_object` — the storage key — is
the only stored fact, and every address a browser fetches is built from it by
`ObjectStore.url()` at read time.

This is what `20260809_02_avatar_object.sql` set out to do. It stopped halfway
because dropping the column then would have stranded existing rows and because
`avatar_url` was kept deliberately, to represent "a photograph this system did
not upload and cannot delete". Two things have changed:

**The database will be reset**, so there are no rows to strand and no backfill
to write. The migration that migration refused to write — parsing a key back out
of a URL — is still not written, and now never needs to be.

**Nothing supplies an external URL.** `RegistrationInput.avatarUrl` exists, but
no caller passes a value: the three references to it under `src/app` and
`src/lib` are all comments explaining that it exists and takes no key
(`dang-ky/page.tsx:230`, `.../nguoi-doc/moi/page.tsx:60`, `page-data.ts:62`).
The state `avatar_url` was preserved to represent has never occurred.

```sql
-- 20260813_01_avatar_object_only.sql
alter table users drop column avatar_url;

comment on column users.avatar_object is
  'Object storage key (src/storage/s3.ts objectKey). The only stored fact '
  'about a photograph; every URL is derived from it with url() at read time, '
  'so no row carries S3_PUBLIC_URL and changing provider stays what SDD 6.8 '
  'says it is: a change of environment variables.';
```

### 2.2 It subtracts machinery

Three separate mechanisms exist *only* to keep two facts in step. With one fact
they are deleted, not rewritten:

**`carryAvatar` and the bug it defends against.**
`src/domain/members/pending-proposal.ts:29-40` describes the failure that made
that function necessary: `pickProfileFields` drops `avatar_object` because it is
not a `ProfileField`, so a command rebuilding `proposed_values` from its result
"would silently *erase* the key while keeping the `avatar_url` that names the
same object. A reader who proposes a photograph and then corrects their phone
number would leave behind an image nothing can ever delete." Once the key **is**
the `ProfileField`, `pickProfileFields` keeps it, and both the function and the
failure mode go.

**The carry-across at approval.**
`src/domain/members/commands/approve-profile-change.ts:206-223` re-reads
`avatar_object` out of the raw `proposed_values` and grafts it onto the patch,
guarded by `if (proposed.avatar_url !== undefined)`. An ordinary field needs
none of this; the block is deleted.

**The coupled write.** `src/domain/members/profile-fields.ts:346-347,386-395`
reads `avatar_object` off the patch out-of-band and writes it in a `case when
${has("avatar_url")}` arm, so "a row can never hold a URL and a key naming
different objects". One fact cannot disagree with itself. The two arms collapse
to one ordinary field arm and the out-of-band read disappears.

`proposeAvatarChange` also loses an input and a blank check (§2.5).

### 2.3 The label objection, addressed rather than skirted

`src/domain/members/profile-fields.ts:387-394` gives the reason `avatar_object`
was kept out of `PROFILE_FIELDS`:

> giving it an entry in PROFILE_FIELDS would demand a Vietnamese label for a
> storage identifier no reader ever sees — which profile-labels.ts refused to
> compile, correctly.

The compiler constraint is real: `PROFILE_FIELD_LABELS` is a total
`Record<ProfileField, string>`. The objection behind it does not survive the
change, because the label does not name the storage identifier — it names what
the field is to a reader, and to a reader this field has always been their
photograph. A reader never saw the URL either. So:

```ts
avatar_object: "Ảnh đại diện",
```

which is the exact string `avatar_url` carries today. `PROFILE_FIELDS` replaces
`avatar_url` with `avatar_object` in the same position, so BR §5.3's ordering is
unchanged.

**The name stays `avatar_object` and is still load-bearing.**
`pending-proposal.ts:56-66` records why it is not `avatar_key`:
`kernel/audit.ts`'s `FORBIDDEN` list matches `key` as a whole token, and
`ProposeAvatarChange` audits this payload, so `avatar_key` throws
`RuleViolated("audit_forbidden_field")` at the first audit write. That reasoning
is untouched and its comment is kept.

### 2.4 Reading

One rule, in one helper, used by every render site:

```ts
// src/lib/avatar-url.ts
export function avatarUrl(key: string | null): string | null {
  return key === null ? null : objectStore().url(key);
}
```

Server-side only, which every render site already is. Three call sites: the
reader's own circle (§5.3), the two `AvatarCompareRow` screens
(`.../quan-ly/doi-thong-tin/page.tsx:253`, `quan-tri/doi-thong-tin/page.tsx:223`),
plus the pending block §5.7 adds. The headers render initials, not photographs,
and `src/lib/exports.ts` names seven labels explicitly and omits the avatar — so
neither is touched, and no export can leak a storage key.

### 2.5 Writing

`storeProposedAvatar` returns the key alone:

```ts
export async function storeProposedAvatar(file: UploadedFile): Promise<string>
```

`ProposeAvatarChangeInput` drops `avatarUrl` and keeps `avatarObject`, losing
one of its two `blank()` checks. The command's docstring section "What is
stored, and the one name that is not arbitrary"
(`propose-avatar-change.ts:54-65`) is rewritten: `proposed_values` now carries
the key as an ordinary proposed field, and the sentence about it being "never
copied anywhere" becomes false — it is copied to `users.avatar_object` on
approval, like any other field.

`RegistrationInput.avatarUrl` becomes `avatarObject`. Nothing passes it, so this
is a signature change with no call-site change, and it is what closes B6.

---

## 3. The server pipeline

`storeProposedAvatar` (`src/lib/avatar.ts:147`) gains a processing step. The
order of operations is the design:

```ts
export async function storeProposedAvatar(file: UploadedFile): Promise<string> {
  if (!AVATAR_TYPES.has(file.type)) {               // 1. allow-list, §4.1
    throw new ValidationFailed(refusalFor(file.type), "avatar");  // §4.4
  }
  if (file.size > AVATAR_MAX_BYTES) {               // 2. size, before the buffer
    throw new ValidationFailed("file_too_large", "avatar");
  }

  const processed = await processAvatar(                     // 3. decode + crop
    new Uint8Array(await file.arrayBuffer()),
  );

  const key = objectKey("avatars", "webp");                  // 4. store
  await objectStore().put(key, processed, "image/webp");
  return key;
}
```

### 3.1 The pipeline itself

A new module, `src/lib/avatar-image.ts`, holding one exported function so that
`avatar.ts` keeps its existing job — policy and storage — and the image work can
be tested without an object store:

```ts
export const AVATAR_EDGE = 512;
export const AVATAR_QUALITY = 82;

export async function processAvatar(input: Uint8Array): Promise<Uint8Array> {
  try {
    return await sharp(input)
      .rotate()                                   // EXIF orientation, see 3.2
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

**This closes OPS §4.3's "square", open since B2b.** `docs/OPERATIONS.md:581`
and `src/lib/avatar.ts:139` record the same deadlock: OPS asks for a square
photograph, but "square" has no sentence, no code and no source, and "a refusal
a reader cannot be told the reason for is worse than no refusal". Cropping
dissolves it — photographs become square without anything being refused, so the
missing Vietnamese sentence is never needed. Both docstrings and the OPS
paragraph are rewritten to say so rather than left describing a question that no
longer exists.

### 3.2 Four things the pipeline buys beyond the byte count

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
accepting larger uploads, closed by the library's default rather than by
anything we write.

### 3.3 800 KB is a ceiling, not a target

Measured, not estimated. A 2000×1500 JPEG of pure random noise — the worst case
for any compressor, and far worse than a photograph — through the exact pipeline
above:

```
JPEG 2000x1500 (2.6MB) -> 105828 bytes webp in 60 ms
```

**105 KB.** Output size is governed by the 512×512 WebP encode and not by the
input, so that figure is effectively the ceiling for any accepted upload; a real
photograph lands well below it. The 800 KB the product owner asked for has
roughly 8× of headroom. §7 pins it with a test rather than leaving it as an
expectation, so a later change to `AVATAR_EDGE` or `AVATAR_QUALITY` that breaks
it fails loudly.

### 3.4 The original is not kept

Only the processed 512×512 WebP is stored. There is no second object holding the
upload as it arrived.

The alternative — store both, serve the crop — costs a second key on every
proposal and a second deletion on every reject, cancel and approve path.
`src/lib/avatar.ts:40-69` is a long docstring about how hard it already is to
ensure no orphaned object survives a decision; doubling the objects doubles that
argument.

Against that, 512px is 4× the 72px an avatar is drawn at and 8× the 64px on the
approval screens. Nothing in the product displays a photograph larger than a
thumbnail, and nothing planned does.

So: not kept. Recorded here, in the module docstring and in OPS, because the
photographs uploaded before anyone changes their mind will not be recoverable.

---

## 4. Formats, and the iPhone question

### 4.1 What is accepted

`AVATAR_TYPES` (`src/lib/avatar.ts:95`) stops being a type→extension map, since
every output is WebP regardless of input. It becomes an input allow-list:

| Accepted in | Note |
|---|---|
| `image/jpeg` | |
| `image/png` | |
| `image/webp` | |
| `image/avif` | **new** — verified to decode; see 4.2 |

Concretely a `ReadonlySet<string>` rather than a `Record<string, string>`. The
extension half of the old table has no reader left: `objectKey("avatars",
"webp")` is a constant call, so the property `src/lib/avatar.ts:86` protected —
that the table "can never ask `objectKey` for an extension it will refuse" —
reduces from four extensions agreeing to one, and stops being able to drift.
`ALLOWED_EXTENSIONS` in `src/storage/s3.ts` already contains `webp` and needs no
change.

`image/jpg` stays out, for the reason recorded at `src/lib/avatar.ts:91`: it is
not a real media type, and accepting one nothing emits only widens what a
hand-rolled request may claim to be.

### 4.2 HEIC does not decode, and the format table says it does

sharp reports `sharp.format.heif.input === true`. **That flag is about the
container, not the codec, and HEIC does not work.** Verified against a real HEVC
file built with `sips` (`file` reports "ISO Media, HEIF Image HEVC Main or Main
Still Picture Profile"), through the exact pipeline of §3.1:

```
HEIC FAILED: big.heic: bad seek to 1640686
AVIF encode+decode OK -> 14261 bytes, 400x300
```

AVIF succeeds and HEIC fails, which isolates the cause exactly: libheif *is*
linked into the prebuilt `@img/sharp-libvips-*` binaries, but the HEVC codec is
not, for patent reasons. AVIF is AV1 and royalty-free, so it survives — which is
why it costs nothing to add to the allow-list above, and why trusting the format
table would have shipped a broken path.

### 4.3 iPhone photographs work, by a mechanism the `accept` attribute controls

iOS Safari transcodes HEIC to JPEG when a photograph is uploaded from the Photo
Library, **provided the `accept` attribute does not list HEIC**. The existing
`accept="image/jpeg,image/png,image/webp"` triggers exactly that, so iPhone
readers on the ordinary path already work today and will continue to.

**The `accept` list is therefore load-bearing and must carry a comment saying
so.** Adding `image/heic` to it — the obvious, helpful-looking change — tells
iOS to stop converting and send the raw HEIC, which sharp cannot decode. An
attribute that looks like a client-side convenience filter is in fact what makes
the server path work.

### 4.4 The hole, and the sentence that fills it

A `.HEIC` reached through the Files app rather than the Photo Library can still
arrive as `image/heic`. Today that produces *"Tệp này không phải là ảnh hợp
lệ."* — wrong, and baffling for a photograph that plainly is one.

A new refusal in `src/domain/kernel/errors.ts`:

```ts
heic_not_supported:
  "Ảnh iPhone (HEIC) chưa dùng được. Bạn hãy chọn ảnh từ thư viện ảnh, hoặc lưu lại dạng JPG.",
```

`refusalFor(type)` returns `heic_not_supported` for `image/heic` and
`image/heif`, and `invalid_image` for everything else. One sentence, and the
reader is told what to do instead of being told they are wrong.

**Not doing:** a custom libvips built with libde265. It would give real HEIC
support and costs the entire reason sharp was the easy choice — it is already in
the tree as Next's `optionalDependency` and already handled by the Dockerfile's
trace. A bespoke native build in the arm64 container that `Dockerfile:7-13`
documents being burned by is a poor trade for a path §4.3 already covers.
Revisit if HEIC-via-Files proves common.

**Open, and cheap to settle:** §4.3's iOS behaviour is documented Safari
behaviour, not something verified on a device during this design. Worth one real
iPhone before treating the hole as narrow.

### 4.5 sharp becomes a declared dependency

`sharp@^0.35.3` moves into `dependencies` in `package.json`. It is already
installed — Next 16 declares it as an `optionalDependency` at that exact version
— so this adds nothing to disk and changes no lockfile resolution. What it buys
is that a Next upgrade which drops or moves the optional dependency breaks
`bun install`, loudly, instead of breaking uploads in production.

The pin follows the two version pins in `AGENTS.md`: recorded with its reason,
not to be "upgraded" without checking.

---

## 5. The screen

### 5.1 `AvatarProposal`, the eighth client island

A new `src/components/avatar-proposal.tsx`, `"use client"`. It takes over both
the circle and the form from `page.tsx:132-161`, because a circle that swaps to
show a preview needs the state the file input holds.

```ts
export function AvatarProposal({
  action,               // the server action, passed from the Server Component
  slug,
  currentAvatarUrl,     // avatarUrl(fields.avatar_object) — derived, §2.4
  initial,              // the letter shown when there is no photograph
}: { … })
```

Imports use relative specifiers, not the `@/` alias, for the reason
`src/components/phone-confirm-dialog.tsx:4` records: `vitest.config.ts` has no
`resolve.alias` for `@/`, and `tests/components/*.test.tsx` import these modules
directly.

### 5.2 It degrades to exactly today's form

`src/components/phone-confirm-dialog.tsx:31` states the pattern: with JavaScript
unavailable the island never mounts, the form submits as it always would, the
server refuses, and the page re-renders carrying the refusal. Nothing here is
reachable only through the island.

So the server-rendered markup is the form as it exists today, plus §5.3's
photograph. Everything in §5.4 and §5.5 is additive.

### 5.3 The circle shows the photograph

When the derived URL is non-null the 72px circle renders it; otherwise the
initial, as today. A plain `<img>` with an eslint disable for
`@next/next/no-img-element`, matching `AvatarCompareRow`
(`.../quan-ly/doi-thong-tin/page.tsx:101-108`) and for the same recorded reason:
`next.config.ts` configures no image optimizer for the object store's host, so
`next/image` refuses the URL outright.

This part needs no JavaScript and fixes §1.1.

### 5.4 The swap, and the pill that keeps it honest

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
be written — design rule 2, *status is never colour alone*, enforced by the type
rather than by review.

### 5.5 The pre-check refuses before the round-trip

A pick over `AVATAR_MAX_BYTES`, or whose type is outside the allow-list, shows
the refusal sentence with an `AlertTriangle` and passes `disabled` to
`SubmitButton`. That composes with no change to the button:
`src/components/ui/submit-button.tsx:32` records that "`disabled` composes rather
than replaces", so a pending submit cannot re-enable a button a rule has closed.

**The sentence is read from `messageFor`, never retyped.** Two copies of "Ảnh
vượt quá 5 MB." is how one of them survives the next change to the limit. The
client refuses on the same rule and shows the same words as the server, and the
server refuses regardless of what the client did.

### 5.6 The copy states the limit and the crop

Replacing the single helper line:

> Ảnh JPG, PNG hoặc WEBP, tối đa 5 MB. Ảnh sẽ được cắt vuông và thu nhỏ.
> Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.

The first sentence fixes §1.3. The second is new and is not housekeeping: a
reader whose photograph is about to be centre-cropped should have been told
before choosing it, not discover it afterwards. The third is today's line,
unchanged.

This is also the copy OPS §4.3 has been attributing a limit to since B2b. After
this change the attribution is finally true.

### 5.7 The pending block renders the photograph

`proposedFields()` lists `avatar_object` like any other proposed field, and the
block prints `{label}: {value}` (`page.tsx:169-183`). A storage key is
meaningless to a reader, so the avatar gets the same treatment the manager
screens already give it: the row renders the proposed image beside the current
one rather than printing a value.

This was deferred at the start of this design and is pulled back in by §2 — not
a scope increase chosen for its own sake, but the consequence of changing what
the field holds.

---

## 6. The ripple

`2 MB` is currently consistent across seven places. Consistency is the property
that matters: a reader shown one number and refused at another is worse off than
today.

| Where | Change |
|---|---|
| `src/lib/avatar.ts:79` | `AVATAR_MAX_BYTES` → `5 * 1024 * 1024` |
| `src/domain/kernel/errors.ts:354` | `file_too_large: "Ảnh vượt quá 5 MB."`, plus `heic_not_supported` (§4.4) |
| `next.config.ts:52` | `bodySizeLimit` `"4mb"` → `"6mb"` |
| `docs/OPERATIONS.md:578` | the number in `file_too_large` |
| `docs/OPERATIONS.md:581` | the "square" open question — resolved by §3.1, rewritten rather than deleted |
| `src/lib/avatar.ts:112,139` | two docstrings this spec makes false |
| `.../commands/propose-avatar-change.ts:46,54-65` | "no aspect-ratio check", and what `proposed_values` carries |
| `docs/DATABASE.md` | `users.avatar_url` is gone |
| `tests/lib/avatar-actions.test.ts:394` | the over-2 MB refusal |
| `tests/lib/avatar-over-http.test.ts` | the 1–2 MB band and the 2 MB rule |

`5 MB` is the **binary** megabyte, `5 * 1024 * 1024`, carrying forward the
reading `src/lib/avatar.ts:73-78` fixed for 2 MB: it is what every file manager
a volunteer might check a photograph's size in reports.

**`bodySizeLimit` must stay strictly above `AVATAR_MAX_BYTES`.** Not arithmetic
housekeeping — `src/lib/avatar.ts:128-137` explains it: a framework limit at or
below the application limit means files in the band between them are refused by
Next before any application code runs, so the reader gets a framework error
instead of the Vietnamese sentence. `"6mb"` leaves room for the multipart
envelope around a 5 MB file.

---

## 7. Testing

### Unit — `tests/lib/avatar-image.test.ts` (new)

- A 2000×1500 input produces a **512×512 WebP**.
- A non-square input is **centre-cropped**, not squashed: a marker in the centre
  survives, the outer edges do not.
- Worst-case noise output is **under 800 KB** (§3.3 measures ~105 KB, so this
  asserts the requirement with its margin intact).
- A JPEG carrying **EXIF orientation 6** comes out upright.
- **No EXIF** in the output.
- A non-image wearing an image content-type raises **`invalid_image`** — the
  check that only becomes real once decoding happens (§1.5).
- A small file with absurd decoded dimensions raises `invalid_image` rather than
  exhausting memory.

### Policy — extending `tests/lib/avatar-actions.test.ts`

- Exactly `AVATAR_MAX_BYTES` passes; one byte over raises `file_too_large`.
- `image/heic` raises **`heic_not_supported`**, not `invalid_image` (§4.4).
- `image/avif` is accepted (§4.2).
- The stored key ends `.webp` and the content-type is `image/webp` whatever went
  in.

### Storage identity — new, and the point of §2

- An approved proposal writes **`users.avatar_object`** and the row carries no
  URL anywhere.
- The rendered address **changes with `S3_PUBLIC_URL`**: the same stored row,
  read under two different values, produces two different URLs. This is the
  assertion that makes SDD §6.8's portability claim true rather than
  aspirational, and it is the one test that would have caught the half-fix in
  `20260809_02`.
- A proposal that changes the phone number and not the photograph leaves the
  pending photograph's key intact — the `carryAvatar` failure mode
  (`pending-proposal.ts:29-40`) still cannot happen once the function that
  prevented it is gone.

### Over HTTP — extending `tests/lib/avatar-over-http.test.ts`

That suite exists because `bodySizeLimit` was once unconfigured and the number
the screen stated was not the number that applied. Its band test moves from 1–2
MB to **4–5 MB**, which is what proves the framework limit moved with the
application limit rather than being assumed to have.

### Component — `tests/components/avatar-proposal.test.tsx` (new)

The suite has no jsdom; `tests/components/*.test.tsx` render to static markup
(`tests/components/phone-confirm-dialog.test.tsx:14`). So:

- The photograph appears in the circle when the derived URL is set, the initial
  when it is not.
- The helper copy names **5 MB** and the crop.
- The submit button carries **no `disabled`** on first paint — the property that
  makes §5.2's no-JavaScript path work.
- `accept` does **not** contain `heic` — §4.3's trap, pinned so a later
  well-meant widening fails the suite with the reason attached.

**Honest limit:** the preview swap, the pill and the disabling cannot be tested
here — there is no way to simulate the pick. That half rides on review, exactly
as the existing island's interaction does.

### Build — extending the Dockerfile `smoke` stage

This spec puts uploads on a native binary, in an image that installs under Bun,
compiles under Node and runs under Bun (`Dockerfile:1`). sharp is verified
present on darwin-arm64 locally; the container is a different platform, and the
existing smoke stage only checks that the landing page renders.

It gains a step performing a real sharp encode under Bun. A missing or
mismatched linux binary then fails the build, rather than failing the first
reader who tries to change their photograph.

---

## 8. Files

**New**

- `src/db/migrations/20260813_01_avatar_object_only.sql`
- `src/lib/avatar-image.ts` — `processAvatar`, `AVATAR_EDGE`, `AVATAR_QUALITY`
- `src/lib/avatar-url.ts` — the one read-time derivation
- `src/components/avatar-proposal.tsx` — the island
- `tests/lib/avatar-image.test.ts`, `tests/components/avatar-proposal.test.tsx`

**Changed — the upload path**

- `src/lib/avatar.ts` — limit, allow-list, `refusalFor`, the pipeline call,
  returns a key, and the three docstrings this spec falsifies
- `src/domain/kernel/errors.ts` — two sentences
- `next.config.ts`, `package.json`, `Dockerfile`

**Changed — the storage-identity change (§2)**

- `src/domain/members/profile-fields.ts` — `PROFILE_FIELDS`, and the collapsed
  avatar arms in `applyProfileFields`
- `src/lib/profile-labels.ts` — the label moves to `avatar_object`
- `src/domain/members/pending-proposal.ts` — `carryAvatar` deleted
- `src/domain/members/commands/approve-profile-change.ts` — carry-across deleted
- `src/domain/members/commands/propose-avatar-change.ts` — one input, one check
- `src/domain/members/registration.ts` — `avatarUrl` → `avatarObject`
- `src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx` — the island, the pending
  block
- `.../quan-ly/doi-thong-tin/page.tsx`, `src/app/quan-tri/doi-thong-tin/page.tsx`
  — derive the two compared URLs
- `docs/OPERATIONS.md` §4.3, `docs/DATABASE.md`
- `tests/lib/avatar-actions.test.ts`, `tests/lib/avatar-over-http.test.ts`
