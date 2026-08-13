# QR labels per copy, and scanning them — design

**Date:** 2026-08-13
**Status:** awaiting approval

`docs/BUSINESS-REQUIREMENTS.md` §19 names this first on the near-term roadmap:
"Print a label per copy carrying its code; a manager scans with the phone camera
to lend or return. This is the single largest UX improvement available, and the
copies model already supports it." §5.4 has described `DT-0142` as "intended to
become a QR label" since the copies model was written, and
`src/domain/catalogue/copy-codes.ts` already refuses to reuse a soft-deleted
code specifically because it is "already printed on a label and stuck to a
physical book". This spec is that promise being kept.

Three things are built: a printable label sheet, a camera scanner the two
manager circulation flows can call, and a reader-facing scan that turns a book
in a child's hands into a borrow request. They are one spec because they share
one payload format and one resolution query — specifying the sheet without the
scanner would fix the payload in print, on paper glued to books, before anything
had tried to read it back.

**They are not one deliverable.** §10 draws the phase boundary: everything
manager-facing ships first and is independently useful, because a shelf with
printed labels and a manager who can scan them is already the improvement §19
promises. The reader flow follows.

---

## 1. What the QR carries

```
OLB1:njd5uYXrSmuisq41J9TrLw
```

`OLB1:` then the copy's `book_copies.id`, its sixteen raw bytes encoded
base64url — 22 characters, no padding. 27 bytes total.

**The payload is the UUID, not the code.** `DT-0142` is unique per shelf and
only per shelf — `book_copies_code_unique` is
`unique (bookshelf_id, code) where deleted_at is null` — so two parishes in the
network can and will both own a `DT-0142`. A sticker is a physical object that
can travel between parishes in a donated box of books; an identifier printed on
one must not depend on the reader already knowing which shelf it came from.

**Not a URL.** A URL would let a phone's built-in camera app open the copy
directly with nothing installed, which is genuinely attractive. It was rejected
because it bakes the deployment's hostname into every sticker glued to every
book: moving from a test domain to the parish's real one, or changing it ever
again, invalidates the entire printed estate. An opaque identifier stays correct
for the life of the physical book. The cost is that scanning only works inside
the application's own scanner (§4), and that cost is accepted.

**Why base64url and not the 36-character UUID text.** Capacity, and it buys an
error-correction level rather than a smaller symbol:

| Version | Modules | ECC L | ECC M | ECC Q |
| ------- | ------- | ----- | ----- | ----- |
| 2       | 25×25   | 32    | 26    | 20    |
| 3       | 29×29   | 53    | 42    | 32    |

27 bytes fits version 3 at **ECC Q**, where a quarter of the symbol may be
damaged and still decode. The 36-byte UUID text does not (36 > 32) and would
have had to drop to ECC M. A label glued to a children's picture book gets
thumbed, scuffed and jam-smeared; the error correction is the point.

`OLB1` is a format version, not decoration. A scanner that meets a future
`OLB2:` payload refuses it by name instead of decoding it into a wrong UUID.
Rejecting a foreign QR is a side benefit, not the reason — the resolution query
(§5) refuses anything that is not a copy on this shelf regardless.

**The human-readable code is printed under every QR and is never decorative.**
A cracked lens, a denied camera permission, a flat battery and a borrowed phone
are all ordinary, and typing `DT-0142` must remain a complete path through every
flow the scanner appears in.

## 2. Schema

```sql
alter table book_copies
  add column qr_printed_at  timestamptz,
  add column qr_print_count integer not null default 0;
```

`qr_printed_at` is the most recent print, `qr_print_count` how many there have
been. The count is what distinguishes a first run from a reprint, which the
"Chưa in nhãn" filter (§3) needs to be honest: a copy whose sticker fell off and
was reprinted is not a copy that has never been labelled, and a single boolean
would have conflated them.

Both are written by the PDF route inside the same transaction that reads the
copies, so a generation that throws marks nothing. Neither column is referenced
by anything, so `docs/DATABASE.md` §4.4's composite-tenant-FK rule does not
apply — there is no new reference between two shelf-scoped tables.

The write is a command, not a side effect of a query: `markCopiesPrinted` writes
an `audit_log` entry naming the manager, the shelf and the count, the same as
every other state change in this system (BR §14).

## 3. Choosing what to print

One screen owns the selection: **`/tu-sach/[shelf]/quan-ly/nhan-qr`**.

Titles listed as accordion rows. Collapsed, a row is the title and its copy
count with a checkbox that means *all copies of this title*. Expanded, it lists
the individual copies — code, state — each with its own checkbox, so a single
`DT-0143` can be reprinted without touching its two siblings. Parent checkbox
reflects and controls the children in the ordinary way, including the
indeterminate state.

Two filters, as segmented controls: **Chưa in nhãn** (default) and **Tất cả**.
The default is the common case after the first print run — a manager who added
three copies on Sunday wants three stickers, not four hundred.

`Checkbox` does not exist in `src/components/ui/`. `field.tsx` has `Toggle`, for
settings switches, which is a different control with different semantics. Per
`AGENTS.md`, the new control is added to `field.tsx` rather than written inline
on this page.

Two other entry points, both of which are links into this screen carrying a
pre-selection rather than second copies of the widget:

- **`/quan-ly/sach`** — a checkbox column and an *In nhãn QR* button. Bulk path,
  and the one used on the first run.
- **After "Thêm bản"** — the success state already names the codes it allocated
  (`DT-0145, DT-0146, DT-0147`); it gains *In nhãn cho 3 bản này*. This is the
  case that would otherwise be a memory problem, and it costs one link.

## 4. The sheet

**A4 pages, content confined to the area A4 and US Letter share.**

US Letter is 215.9 × 279.4mm — wider than A4 and, decisively, 17.6mm shorter. A
sheet that prints correctly on either has 210 × 279.4mm to work with, and 12mm
of margin leaves **186 × 255.4mm**. Every label is laid out inside that box,
centred, on an A4 page. Printed on Letter at 100% scale, nothing falls off the
paper.

**Layout: 58 × 34mm landscape, 3 columns × 7 rows, 21 per page.** QR on the
left at 25mm square; to its right the code at 12pt semibold, the title at 6.8pt
wrapped to at most two lines, and the shelf name at 6pt muted along the bottom.
Hairline borders as cut guides. Monochrome throughout — a parish printer's
colour cartridge is not spent on a sticker.

The title **wraps**, it does not truncate. *Totto-chan Bên Cửa Sổ* does not fit
26mm on one line at 6.8pt, and a label reading `Totto-chan Bên Cửa…` has failed
at the only job its text half has.

**Avery L7159 pre-cut stock was designed for and rejected.** Its die-cut grid is
63.5 × 33.9mm in 3 columns of 8 — 190.5mm across and 271.2mm down, both outside
the shared box. Pre-cut stationery is a physical A4 product and cannot be made
paper-size-portable by drawing it smaller, because the perforations do not move.
The requirement that a sheet print correctly on A4 and Letter excludes it. The
shipped layout keeps its arrangement and is cut with scissors along the
hairlines.

Portability costs a row: 21 labels per page instead of the 24 a Letter-blind
layout would fit, so a 400-copy shelf is 20 pages rather than 17.

### The QR is drawn as vectors

`pdf-lib` receives the module matrix and draws filled rectangles, run-length
merging each row into single wide rectangles. No raster, no DPI, no resampling —
sharp at whatever resolution the printer has. Measured on the prototype: **4,658
rectangles for one page of 21 labels**, in a two-page file of 113KB. A 400-copy
shelf is 20 pages and comfortably under 1MB — small enough to build in memory
and stream without a temporary file.

### Fonts are a build-and-deploy concern, not a detail

**`pdf-lib`'s fourteen standard fonts cannot render Vietnamese.** They are
WinAnsi-encoded; `Dế Mèn Phiêu Lưu Ký` comes back as mojibake or throws on
encoding. `@pdf-lib/fontkit` and a real TrueType face are mandatory.

**`next/font` cannot supply it.** It emits **woff2** into `.next/`, which
fontkit does not read. So a **Lexend TTF (regular and semibold, OFL-1.1) is
vendored into the repository** and read from disk at runtime.

That file must reach the container. `next.config.ts` gains
`outputFileTracingIncludes` for the route, or the PDF works under `bun run dev`
and throws `ENOENT` in production — a failure that appears only after deploy.
This is called out here because it is the one part of this spec that cannot be
caught by any test that runs on a developer's machine.

`pdf-lib` also **moves from `devDependencies` to `dependencies`.** It is listed
today and imported nowhere in `src/`; importing it from application code while
it sits in devDependencies builds locally and fails in the container, whose
install prunes dev dependencies.

### The route

`POST /tu-sach/[shelf]/quan-ly/xuat/nhan-qr`, a static segment beside the
existing `xuat/[loai]`. Next resolves static before dynamic, so the CSV route is
untouched and its closed `EXPORTS` map keeps its CSV-only shape rather than
growing a content-type conditional.

`POST`, not `GET`, for a different reason than the CSV exports. Those are `POST`
because P1 §3.5(c) refuses to put children's records behind a bookmarkable URL;
a label sheet holds titles and shelf marks and carries no such weight. The
reason here is mechanical: the selection is up to several hundred copy ids and
does not belong in a query string. It inherits `force-dynamic`, the `sameOrigin`
check and `Cache-Control: no-store, private` from the CSV route's established
pattern.

## 5. Resolving a scan

```
decode → strip "OLB1:" → base64url → 16 bytes → UUID → resolveCopyByToken
```

`resolveCopyByToken` takes a **UUID**, never a token. Base64 is `src/lib/qr.ts`'s
business alone; the domain layer never learns the payload has an encoding.

Tenancy needs no new code. The query runs inside the shelf-scoped transaction
the kernel already opens, so RLS answers nothing for a sticker belonging to
another parish, and the screen says *Mã này không thuộc tủ sách của bạn* — a
plain refusal, per BR §2, not a 500 and not a silent empty result.

A malformed payload, a wrong prefix, a token that is not sixteen decoded bytes,
and a well-formed UUID naming no copy are all the same refusal to the volunteer
holding the phone. They are told to type the code instead.

## 6. The scanner

`src/components/qr-scanner.tsx` — the one `"use client"` addition.

**One decoder on every device.** `zxing-wasm`, dynamically imported so neither
the WASM nor the wrapper is fetched by any page other than an open scanner
overlay.

`BarcodeDetector`, the native browser API, is **not** used even where it exists.
It is unimplemented in Safari and every browser on iOS, with no signal that it
is coming, so it could only ever have been half a solution. Running it on
Android and a library on iOS means two decode paths and two sets of bugs, and
hands the less-exercised path to the iPhone — which, in the parishes this serves,
is most of the phones. One path is tested once.

### Lifecycle

This is §7's first expiry, and it is the scanner's main non-obvious
responsibility.

| Event                        | Action                                            |
| ---------------------------- | ------------------------------------------------- |
| overlay opens                | `getUserMedia({video:{facingMode:"environment"}})`, import decoder |
| decoding                     | `requestAnimationFrame` loop at ~10fps off a hidden `<canvas>` |
| successful scan              | stop **every** track, terminate the worker, close |
| overlay closed / unmounted   | identical teardown                                |
| `visibilitychange` to hidden | identical teardown                                |
| 60s with no successful scan  | stop the camera, offer the code entry field       |

A camera left streaming behind a closed overlay keeps the indicator light on and
drains a volunteer's battery in their pocket. The teardown is the same code path
in all four cases, deliberately, so there is one thing to get right.

`getUserMedia` requires a secure context — HTTPS or `localhost`. The compose
stack serves plain HTTP today, so **`docs/OPERATIONS.md` gains a line** saying
the scanner needs TLS in front of the app. Without it the button is present and
permanently broken.

## 7. What expires, and what does not

- **Camera and decoder** — §6's table.
- **PDF bytes** — built, streamed, discarded. Nothing written to `./data`, no S3
  object, `Cache-Control: no-store, private`. There is no cache to invalidate
  because there is no cache.
- **A scan confirmation** — a `scannedAt` hidden field, refused server-side past
  five minutes with *Mã đã cũ, mời quét lại*. It is **unsigned on purpose**:
  forging it buys a stale scan and nothing else, because the command
  re-validates the copy's actual state when it runs. Signing it would be
  ceremony protecting nothing.
- **The sticker itself does not expire.** It is glued to a book. Reprinting a
  parish's entire estate on a schedule is real work for volunteers in exchange
  for nothing, since the UUID grants no access on its own — every path through
  it re-checks the session, the membership and the copy's state.

## 8. Where a scan leads

| Who     | Screen                   | Result                                                             |
| ------- | ------------------------ | ------------------------------------------------------------------ |
| Manager | **Cho mượn**, step 1     | fills the search box, continues to step 2 with `?sach=` set        |
| Manager | **Nhận trả**             | runs that copy's search                                            |
| Reader  | **`/tu-sach/[shelf]/quet-ma`** | confirmation naming the copy → `createBorrowRequest` with `copy_id` |

The two manager destinations add **no command**. They are the existing flows
with the search step already answered — the same argument
`sach/[id]/page.tsx` records for its own two shortcuts, which "are the same two
flows with a shorter runway".

The reader path is the one genuinely new flow. `borrow_requests.copy_id` already
exists (`docs/DATABASE.md` §4.4 lists it among the composite-FK columns), so a
request naming a specific physical copy is expressible today; nothing in the
schema changes for it. The confirmation screen names the copy and its title, and
`Xác nhận xin mượn bản này` is a deliberate second step — a request created by
the act of scanning would make every mis-scan a request a manager has to reject.

This is materially better than the title-level request that ships today: the
manager sees which physical book is in the child's hands, not merely which title
was wanted.

## 9. Testing

- **`src/lib/qr.ts`** — round-trip UUID → token → UUID; rejection of a wrong
  prefix, a wrong length, non-base64 characters, and a token decoding to
  anything but sixteen bytes. Pure functions, no database.
- **Geometry** — every label's bounding box inside the **186 × 255.4mm shared
  box**, not merely inside the A4 media box. Asserted at 1, 21, 22 and 400
  copies; 22 is the off-by-one that starts page two. An A4-only version of this
  assertion passes a sheet that overruns Letter, which is exactly the bug it
  exists to catch.
- **Golden decode** — render the PDF, rasterise at 300dpi, decode every symbol,
  assert each returns its source UUID. This is not belt-and-braces: the
  prototype for this spec had two real bugs (a grid taller than the page, and a
  fixture generator producing malformed UUIDs from signed 32-bit bitwise
  arithmetic) that were invisible in review and only surfaced when a rendered
  sheet was decoded. It belongs in CI.
- **Domain** — `markCopiesPrinted` increments the count and writes its audit
  entry; a failed generation marks nothing; `resolveCopyByToken` refuses a UUID
  belonging to another shelf.
- **Architecture** — no new test needed.
  `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` already
  globs `route.ts`, so the new route is covered the day it exists.

## 10. Phases

**Phase 1 — labels and manager scanning.** §§1–7, plus the two manager
destinations in §8. Independently shippable and independently useful: a shelf
with printed labels and a manager who can scan them is the improvement BR §19
describes.

**Phase 2 — the reader flow.** The `/quet-ma` route, the confirmation screen and
`createBorrowRequest` carrying `copy_id`. It is second because it is the only
part that adds a new route, a new command path and a new permissions surface,
and because it is worthless until phase 1 has put stickers on books.

The payload format (§1) and the schema (§2) are settled in phase 1 and are not
reopened in phase 2. That is the whole reason both phases are specified here
rather than separately: the format goes onto paper and gets glued to books in
phase 1, where it stops being cheap to change.

## 11. Explicitly not in scope

- **A second sheet layout.** One layout, no picker. Avery is excluded on the
  paper-size argument (§4) and a chooser for a single option is a control that
  does nothing.
- **ISBN barcode scanning.** BR §19 rules it out by name — unreliable for the
  donated and second-hand Vietnamese books this serves, "where QR labels are
  strictly better".
- **Offline scanning.** BR §19 has offline capability as a medium-term item
  covering the whole application; solving it for this one screen would be a
  private answer to a question the rest of the app has to answer too.
- **Printing anything other than copy labels.** BR §19's "printable borrow slips
  and shelf labels" is a separate roadmap line and a separate spec.
