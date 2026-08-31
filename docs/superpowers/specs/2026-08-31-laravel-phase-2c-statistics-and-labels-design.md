# Phase 2c — statistics and QR labels — design

**Date:** 2026-08-31
**Status:** awaiting approval
**Branch:** `feat/phase-2c-statistics-and-labels`, cut from `main` at `7151a91`

## Context

OLibra is a Vietnamese parish library system being rewritten from a Next.js
application (`old_next/`, kept in-tree read-only as a behavioural reference) onto
Laravel + Inertia + React + MariaDB, for deployment to shared cPanel hosting.
Phases 0 through 2b are merged: the catalogue, members, circulation, oversight,
borrow requests and holds, and the community voice (comments, announcements,
donations). Phase 2c is the last slice of Phase 2 before the network (Phase 3)
and cutover (Phase 4).

A reader arriving here needs three facts about how this project works, because
they explain the shape of everything below. First, features are **ported**, not
invented: `docs/BUSINESS-REQUIREMENTS.md` (BR) and `docs/OPERATIONS.md` (OPS) are
the source documents, and `old_next/` is what they describe as built. Second,
every divergence from the reference is **numbered and recorded** rather than made
silently. Third, this repo has **no frontend rendering tests at all** — the only
`vitest` scripts point at `old_next/` — so anything whose only expression is a
React component is unverified by construction, and the design has to account for
that rather than pretend otherwise.

## Problem statement

Two features remain unported in Phase 2, and they are unlike the phases before
them in a way that matters.

**Statistics** is specified (BR §16.3, OPS §3.3 `GetStatistics`) and built in the
reference, but its query is written in PostgreSQL and does not survive the port
mechanically: `date_trunc` has no MariaDB equivalent, and every figure on the
screen is bounded by a civil-day boundary in a timezone this codebase currently
expresses three different ways.

**QR labels** are specified (BR §19, OPS §3.3 and §4.1) and have a full approved
design at `docs/superpowers/specs/2026-08-13-qr-labels-design.md`, but that design
was written for a Node runtime — it generates the label sheet with `pdf-lib`,
`qrcode` and `@pdf-lib/fontkit`. The Laravel target has **no Node at runtime** and
**no PDF or QR library in `composer.json`**. The sheet has to be rebuilt in PHP,
and it produces a physical artefact: paper, glued to books, that stops being
cheap to change the moment it is printed.

So Phase 2c is a port with one genuinely new engineering problem inside it, and a
handful of decisions the reference cannot answer because the reference ran
somewhere else.

## What ships

One branch, two slices, one PR — the shape 2a and 2b used.

**Slice A — Statistics.** `GetStatistics` and the manager's *Thống kê* screen:
a period selector (week / month / year / since the shelf began), four totals
(loans, distinct borrowers, books added, books lost), a chart over time, a chart
by category, and ranked *top books* and *top readers* lists.

**Slice B — QR labels**, scoped to the QR design's own Phase 1 boundary
(that document's §10): `ListTitlesForLabels`, `ListCopiesForLabels`,
`ResolveCopyById`, `ExportLabelSheetPDF`, `MarkCopiesPrinted`, the
`/manage/qr-labels` selection screen (that route already exists as a named
placeholder), and the scanner wired into the shipped lend
and return flows.

**No schema work.** Phase 0 already wrote `qr_printed_at` and `qr_print_count`
onto `book_copies` (`database/migrations/2026_08_26_000006_create_book_copies_table.php`
lines 30–31, verified), and `BookCopy` already casts `qr_printed_at` to a date.
`lost_reported_at` is likewise already present.

## Decisions taken

### D1. The QR payload is ported unchanged — but the reasoning is new

The payload stays `OLB1:` followed by the copy's UUID as 22 characters of
base64url, exactly as the 2026-08-13 design specifies.

**This decision was reopened and re-closed, and the reason changed.** That
document rejected a URL payload because a URL "bakes the deployment's hostname
into every sticker glued to every book", and because changing it "invalidates the
entire printed estate". Confirmed with the product owner on 2026-08-31: **no
parish has printed or glued any label yet**, so there is no printed estate to
protect and that argument does not currently apply.

The option was therefore examined on its merits. A URL is technically viable: QR
byte-mode capacity at ECC Q is 32 bytes at version 3 and **46 at version 4**, and
a payload of the form `https://olibra.vn/q/njd5uYXrSmuisq41J9TrLw` is 42 bytes —
it fits at version 4 while keeping the quarter-of-the-symbol damage budget the
original design argued for, at the cost of a denser symbol (33×33 modules rather
than 29×29). It would let a reader open a copy with a phone's native camera and
nothing installed, which is the largest reader-facing win available here.

**It is rejected because the production domain is not settled.** The cPanel host
is unverified (`docs/HOSTING.md` records rows 2–14 as unrun) and no final domain
exists. A URL payload would freeze an unsettled hostname onto paper. The original
conclusion therefore stands, on a different premise: not "a printed estate exists
and must be protected" but "the hostname is not yet knowable, and printing is
what makes it permanent".

**This is recorded rather than merely decided**, so that whoever meets it next
knows the question was asked and what would change the answer: if the domain
settles before any parish prints at scale, the URL option is live again and the
capacity arithmetic above is done.

### D2. Lost copies are counted by `lost_reported_at`, not `updated_at`

**Divergence from the reference.** `old_next/src/domain/shelf/queries/get-statistics.ts`
counts lost copies with `where state = 'lost' and deleted_at is null and
updated_at >= since`. `updated_at` moves on *any* write, so under that predicate a
copy reported lost long before the period re-enters it when someone edits its
condition note, and a copy correctly inside the period counts by coincidence
rather than by fact.

This schema carries `book_copies.lost_reported_at` (verified present on the live
table), so the port uses:

```sql
where state = 'lost' and deleted_at is null and lost_reported_at >= :since
```

Same figure in the ordinary case, a different and more defensible figure at the
edges. Ruled by the product owner on 2026-08-31: correctness over parity.

### D3. One civil timezone, named once

Period boundaries are civil-day boundaries, which makes statistics the most
timezone-sensitive screen in the product. The codebase currently expresses this
three ways, which is the actual defect:

- `config('app.timezone')` resolves to **`UTC`** (`.env:177` sets
  `APP_TIMEZONE=UTC`; confirmed via `artisan tinker`);
- `MyLoanHistoryQuery.php:39` and `:42` hardcode the string `'Asia/Ho_Chi_Minh'`;
- `AnnouncementsQuery.php:116-135` reasons explicitly about `config('app.timezone')`
  being something other than the parish's timezone.

Ruled by the product owner on 2026-08-31: **storage stays UTC**, and the
application gets **one named civil-timezone setting** — `Asia/Ho_Chi_Minh` —
which statistics reads for every period boundary. The per-shelf
`bookshelves.timezone` column is deliberately **not** read: there is one parish
timezone today, and a per-shelf reading is Phase 3's problem when a network of
shelves actually exists.

The setting replaces the scattered literals rather than becoming a fourth
expression of the same idea. Phase 2b shipped a timezone defect of exactly this
family (`4d0edab` — a date meaning the start of its day where the end was meant),
which is why this is settled in the spec instead of left to an implementer.

**Explicitly not in this phase:** correcting `MyLoanHistoryQuery`'s two hardcoded
calls. That is shipped Phase 1 code and changing it is scope creep into a merged
phase. It is recorded in `known-gaps.md` instead.

### D4. The label sheet is generated server-side in PHP — with TCPDF

**AMENDED 2026-08-31, after independent plan review. The original ruling chose
FPDF, and its DECIDING reason has since been measured false — backwards, in
fact.** The amendment is
written as a retraction rather than an edit, because this project has measured a
deleted false sentence reappearing three commits later.

**What ships:** `bacon/bacon-qr-code` for the symbol and **`tecnickcom/tcpdf`
6.x** for the page, with the QR drawn as filled rectangles straight from the
module matrix:

```php
foreach ($matrix as $y => $row) {
    foreach ($row as $x => $on) {
        if ($on) { $pdf->Rect($ox + $x * $m, $oy + $y * $m, $m, $m, 'F'); }
    }
}
```

**RETRACTED — the original D4 and its three reasons.** It read: *"`bacon/bacon-qr-code`
for the symbol and **FPDF** for the page"*, justified by (1) "No PHP extension
dependency … On a shared host nobody has yet logged into, depending on zero
extensions is worth more than convenience", (2) millimetres being native, and
(3) vector output. It rejected TCPDF for costing "a large vendor tree and a
font-conversion build step Lexend must survive with its diacritics intact."

Measured from packagist metadata, which is the authority the original decision
should have consulted and did not:

| Package | Declared `require` |
|---|---|
| `setasign/fpdf` 1.9.0 | `ext-zlib`, **`ext-gd`** |
| `tecnickcom/tcpdf` 6.11.4 | `php >=7.1.0`, **`ext-curl`** |
| `bacon/bacon-qr-code` | `php ^8.1`, `ext-iconv`, `dasprid/enum` |

So reason (1) — the one the choice actually turned on — was not merely weak, it
was **backwards**: FPDF requires `ext-gd`, the exact extension the original text
said it avoided, while TCPDF requires only `ext-curl`. `composer install
--no-dev` on a gd-less host would refuse FPDF's platform requirement outright.

**Precision about the retraction, because an overstatement is its own defect.**
Reasons (2) and (3) — native millimetres and vector output — are **true of
FPDF**. They simply do not discriminate, being equally true of TCPDF. Only
reason (1) is false, and it is false in the direction that reverses the ruling.

The rejection of TCPDF inverts too. **FPDF cannot load a TTF at runtime at all** —
its `AddFont()` rejects any name containing a path separator and loads a
pre-generated `.json` font-definition file, and its `Cell()` takes single-byte
text through one of the `makefont/*.map` encodings. Producing Vietnamese with it
means running MakeFont against cp1258, committing the generated `.json` and `.z`
artefacts, and `iconv`-ing every string at call time. That is precisely the
"font-conversion build step" TCPDF was rejected for — **FPDF needs a worse one**.
As noted above, reasons (2) and (3) survive and simply fail to discriminate:
TCPDF takes `mm` as its page unit and draws vectors just as happily.

**One original objection to TCPDF was real and is ACCEPTED rather than refuted:
the vendor tree.** Measured: `tecnickcom/tcpdf` 6.11.4 is **27 MB across 219
files**, against FPDF's single ~60 KB file. On inode-quota'd shared cPanel that
is a genuine cost. It is accepted because the alternative cannot render
Vietnamese at all — but it is a cost, not a wash, and `docs/HOSTING.md`'s unrun
survey should gain an inode and disk row because of it.

One further consequence, and it is why this matters beyond tidiness. cp1258
encodes Vietnamese **decomposed**, so an FPDF sheet's text layer comes back as
NFD — `ê` + U+0301 rather than `ế` — while every title in this database is NFC.
The phase's highest-risk test, the diacritic assertion, would have failed against
a *correct* implementation and sent someone hunting a font bug that was not
there. TCPDF's native TTF embedding takes UTF-8 directly and removes the
**encoding** half of that class.

It does **not** remove generated font artefacts. `TCPDF_FONTS::addTTFfont()`
still emits a `.php`/`.z`/`.ctg.z` triple, and with no `$outpath` it writes them
into `K_PATH_FONTS` — `vendor/tecnickcom/tcpdf/fonts/` — which is gitignored, so
`composer install --no-dev` recreates the tree without them, and TCPDF's own
source documents that directory as one that "must be writeable by the web
server". The plan therefore requires an explicit `$outpath` under a path this
repo controls. What is gone is the cp1258 round-trip and the NFD text layer, not
the artefacts.

**Rejected, unchanged:** client-side generation reusing `pdf-lib` and `qrcode`.
OPS §3.3 specifies that `ExportLabelSheetPDF` "Writes `MarkCopiesPrinted` only
once the bytes exist", and OPS §4.1 gives `MarkCopiesPrinted` a single
`copy.qr_printed` audit entry for the batch. Generating in the browser makes both
depend on the browser reporting back, so a closed laptop mid-print silently
drifts the very count that exists to distinguish a reprint from a first print.

**This was settled by execution, not by reading.** An independent reviewer ran
the probe: `TCPDF_FONTS::addTTFfont('resources/fonts/Lexend-Regular.ttf',
'TrueTypeUnicode', '', 96)` returned the string `"lexend"`, not `false`, and
`smalot/pdfparser` extracted `Dế Mèn Phiêu Lưu Ký · DT-0142` from the resulting
bytes — **already NFC**, so the normalisation step the plan adds is
belt-and-braces rather than load-bearing. TCPDF 6.11.4 installed with **zero**
transitive dependencies.

**What would reopen this:** a production host measured to lack `ext-curl`, or a
TCPDF release that drops the 6.x direct-drawing API. Neither is true today.

### D5. Sheet geometry is inherited verbatim

186 × 255.4mm safe area, 3 columns × 7 rows, 21 labels per page, 58 × 34mm each.
This is **not** a free parameter: A4 is 210 × 297mm and US Letter is 215.9 ×
279.4mm, so a sheet that must print correctly on either has 210 × 279.4mm to work
with, and 12mm of margin leaves the box above. The 2026-08-13 design records that
Avery L7159 pre-cut stock was measured and rejected because its perforations sit
outside that box and perforations do not move. Nothing in the port re-derives
this; it is carried across as-is.

### D6. Charts are hand-rolled SVG

The reference's statistics page draws its charts as inline `<svg>` with no chart
library (verified: its only chart-related import is the SVG element itself). The
port does the same. This adds no dependency, no bundle weight, and satisfies
AGENTS.md rule 8 — bar and line only, no pie charts, a text summary above every
chart — by construction rather than by configuring a library away from its
defaults.

### D7. A zero-row `MarkCopiesPrinted` is not a failure

**Added 2026-08-31, after independent plan review**, because the first
implementation plan asserted the opposite and would have shipped it.

OPS §4.1's `MarkCopiesPrinted` entry, opened and quoted in full:

> **A zero-row update is not a failure here**, and this is the one command in
> this document for which that is true. It is set-valued bookkeeping about a
> document that already exists — the route builds the PDF bytes *before* calling
> this — so an empty result is a fact to record, not a target that was missed.
> The reported count is what actually moved, not what was asked for.

So `copy_selection_empty` refuses an **empty input**, and nothing else. A
selection that is non-empty but scopes down to zero rows — every id belonging to
another shelf — records a count of zero and succeeds. The reported count is what
moved, not what was asked for.

**Retracted 2026-08-31 for the HTTP path, after the whole-branch review measured
it.** The paragraph above is correct about the COMMAND and wrong about the
ROUTE, and the sentence being retracted is this one: *"A selection that is
non-empty but scopes down to zero rows — every id belonging to another shelf —
records a count of zero and succeeds."* That is true of `MarkCopiesPrinted`
called directly, and `MarkCopiesPrintedTest` pins it. It is **not** what
`POST /shelves/{shelf}/manage/exports/qr-labels` does. `LabelController::export`
passes `MarkCopiesPrinted` the **expanded** ids, not the submitted ones:
`CopiesForLabelsQuery` is tenancy-scoped, so a body naming only a foreign
`bookId` expands to `[]`, `array_column([], 'copyId')` is `[]`, and the command
sees an EMPTY INPUT — the case it does refuse. Measured: **302, refusal
`copy_selection_empty`**, not a zero-count success. The branch is unreachable
over HTTP; it survives as the command's contract for any future caller that
hands it ids it has not already scoped. `LabelController`'s docblock says the
same, and this is the version that ships.

## Slice A — Statistics

`GetStatistics` returns, per OPS §3.3 and matching the reference's shape:
`period`, `loans`, `borrowers`, `booksAdded`, `copiesLost`, `daily[]`,
`byCategory[]`, `topBooks[]`, `topReaders[]`. Every figure is computed at query
time; nothing is a materialised counter.

Period boundaries in MariaDB, replacing `date_trunc` (D3's civil timezone
applies to each):

| Period | Boundary |
|---|---|
| `week` | `DATE_SUB(d, INTERVAL WEEKDAY(d) DAY)` — Monday start |
| `month` | `DATE_FORMAT(d, '%Y-%m-01')` |
| `year` | `MAKEDATE(YEAR(d), 1)` |
| `all` | an epoch floor |

`WEEKDAY()` returns 0 for Monday regardless of server locale, which is why it is
used in preference to `DAYOFWEEK()` or `WEEK()` — both of which vary with
`default_week_format` and would make the week boundary a configuration accident.

**All four expressions were executed, not proposed**, against the live
MariaDB **10.11.19** this project runs: `WEEKDAY('2026-08-31')` returns `0` with
`DAYNAME` `Monday`, and the three boundaries return `2026-08-31`, `2026-08-01`
and `2026-01-01` respectively. They are written here as measured output rather
than as SQL that ought to work.

**The screen is manager-facing and stays so.** BR §16.2 records that the
leaderboard opt-in was withdrawn and that *Bạn đọc chăm nhất* now counts every
borrower with no acknowledgement step; the mitigation for that withdrawal is
precisely that the list is manager-facing, since a manager can already see every
loan through the lending screens and the audit log. Were this list ever to become
reader-facing, BR §16.2 says that decision has to be taken again. It is not taken
here.

## Slice B — QR labels

- **`ListTitlesForLabels`** — the selection accordion. Grouping happens in the
  query, not the page, so the "chưa in nhãn" filter can drop a title whose every
  copy is already printed rather than render a row that opens onto nothing.
- **`ListCopiesForLabels`** — `bookIds` and `copyIds` are a **union**, so a
  manager may tick a whole title and individual copies of another. Expansion
  happens server-side, not in the browser, where the answer would be whatever the
  page happened to be rendered with.
- **`ResolveCopyById`** — a scanned label back to a copy. Takes the copy's UUID,
  never the printed payload: decoding lives outside the domain so the label format
  can change without this query changing. Reader-accessible by design, with
  tenancy — not role — being what makes another parish's sticker unresolvable.
- **`ExportLabelSheetPDF`** — the sheet, D4's writer, D5's geometry.
- **`MarkCopiesPrinted`** — stamps `qr_printed_at` and **increments**
  `qr_print_count`. The count is not decorative: it is what distinguishes a
  reprint after a sticker falls off from a first print, which a boolean or a
  lone timestamp cannot. One `copy.qr_printed` audit entry for the whole batch,
  naming the count — deliberately unlike `AddCopies`, because a print run is one
  volunteer at one printer in one moment, and four hundred rows would bury the log
  BR §14 exists to keep readable. Refusal: `copy_selection_empty`.

**The human-readable code is never decorative.** `DT-0142` prints under every QR,
and typing it stays a complete path through every flow the scanner appears in. A
cracked lens, a denied camera permission, a flat battery and a borrowed phone are
all ordinary.

## Testing

Server-side coverage is the usual standard for this project: period boundaries
asserted at their edges, tenancy isolation on every new query, the
`copy_selection_empty` refusal, `MarkCopiesPrinted` proven to increment rather
than set, and the `copy.qr_printed` audit sentence covered by a real block rather
than only by the census (`known-gaps.md` records that the census cannot see a
missing key; seventeen inherited sentences already sit in that hole and this phase
must not add an eighteenth).

**The PDF gets a test, and it is about fonts rather than about the library.** The
failure mode in D4 is not a crash: a subsetted Lexend that silently drops the
stacked diacritics in `Dế Mèn Phiêu Lưu Ký` still produces a structurally valid
PDF, and the defect is discovered on paper already glued to books. The test
asserts on text extracted from generated bytes, using a diacritic-heavy title as
the fixture.

**The camera scanner gets no test and cannot.** This repo has no frontend test
runner (`package.json`'s `test` script runs `cd old_next && vitest run` — the
read-only reference app). Ruled by the product owner on 2026-08-31: note it,
do not stand up a runner in this phase. The mitigation is structural, not
test-shaped — because typing the code is a complete path everywhere the scanner
appears, the untestable surface is never the only route to anything.

## Explicitly not in scope

- **The reader's `/quet-ma` flow** — the scan-to-borrow-request path. The
  2026-08-13 design orders it second because it is the only part adding a new
  route, command path and permissions surface, and because it is worthless until
  stickers exist. Deferred to Phase 3.
- **A frontend test runner** (see Testing).
- **Correcting `MyLoanHistoryQuery`'s hardcoded timezone literals** (see D3).
- **Reading `bookshelves.timezone` per shelf** (see D3) — Phase 3.
- **Cross-shelf statistics**, which BR §1 assigns to Phase 3 explicitly.

## Risks

1. **Font subsetting silently dropping Vietnamese diacritics** — the highest
   risk in the phase, because it is invisible until it is on paper. Mitigated by
   the extraction test above, and by printing one real sheet before the phase
   closes.
2. **~~FPDF is a smaller, less-maintained library than TCPDF.~~ RETRACTED and
   inverted.** This risk read "Accepted for the extension-independence in D4. If
   it proves unable to embed Lexend with correct diacritics, D4 falls back to
   TCPDF and that is a spec amendment, not an implementer's improvisation." The
   independent plan review established that FPDF cannot embed a TTF at runtime at
   all and requires `ext-gd` besides, so the fallback the sentence described is
   now the ruling — see the amended D4. The residual risk is smaller and different:
   **TCPDF requires `ext-curl`**, and the production host is unverified, so that
   is one extension to confirm rather than a font capability to hope for.
3. **The cPanel host is still unverified**, so "no Node, no extensions" is a
   constraint taken from `docs/HOSTING.md`'s unrun survey rather than from a
   machine anyone has logged into. D4's choices are the conservative ones under
   that uncertainty, which is the right posture, but the uncertainty is real.
