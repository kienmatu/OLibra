# Six UX gaps — design

**Date:** 2026-08-11
**Status:** awaiting approval

Six defects reported from a walkthrough of the running application. Five are
chrome: a link that does not exist, a highlight that cannot be seen, a page that
does not know who is reading it. The sixth is a feature whose domain layer
shipped complete and whose user interface was never built.

They are specified together because four of them touch the same three files —
`src/components/shell/public-header.tsx`, `src/components/shell/manager-shell.tsx`
and `src/auth/guards.ts` — and splitting them across specs would mean three
passes over the same components.

---

## 1. Comments on a book

### What is wrong

`createComment` (`src/domain/community/commands/comment-moderation.ts:33`) is
implemented, tested against INV-9, and **called from nowhere**.
`tests/architecture/every-domain-command-has-a-caller.test.ts:125` carries an
explicit exemption saying so. `getBookComments` has no caller either. The book
detail page records the gap in its own docstring — *"Comments are not here"*
(`src/app/tu-sach/[shelf]/sach/[slug]/page.tsx:99`) — because U2 excluded them
and the fixture version that preceded it rendered two invented comments in a box
that posted nowhere.

The consequence is not only that readers cannot comment. `/quan-ly/binh-luan` is
a moderation queue over a table nothing writes to: it renders four status chips,
an approve action, a reject-with-reason form and a hide action, all of which can
only ever operate on rows inserted by hand. The reported symptom — *a manager
cannot comment* — is the visible corner of a slice that has a back end and no
front.

A manager is not a special case here. `createComment` calls `requireReader`,
which is a floor rather than an equality, and `atLeast("manager", "reader")` is
true; a manager holds an active membership of the shelf, so
`input.membershipId === ctx.actor.membershipId` is satisfiable for them exactly
as it is for a reader. One form serves everybody who can see the page.

### What we build

A **Bình luận** section at the foot of the book detail page, below *Giới thiệu*,
in the main column.

**The list.** `getBookComments(tx, ctx, { bookId })` — approved comments only,
newest first, which is the ordering that query already returns. Each entry is the
author's name, the date, and the body rendered as plain text. React escapes it,
which is what BR §5.4 asks for and what `inv-09-comment-visibility.test.ts` pins
with a `<script>` body. No avatars, no reply threading, no like counts: none of
those exist in the schema and none were asked for.

Empty is a sentence, not a card: *"Chưa có bình luận nào. Em là người đầu tiên
nhé."*

**The form.** A `Textarea` and one submit button, posting to a new
`postCommentAction` in `src/app/tu-sach/[shelf]/community-actions.ts` — the file
that already owns the two other reader-facing community writes and already has
the `attempt()` helper that turns a `RuleViolated`/`ValidationFailed` into a code
the page renders through `messageFor`. Both codes this command can raise already
exist in `errors.ts`: `comments_disabled` (line 247) and `empty_body` (line 248).

The action goes through `submitCommand(shelf, createComment, …)`, the same seam
`offerDonationAction` uses. It needs the viewer's `membershipId`; the page has it
on the `Viewer` the seam resolves, and it travels in a hidden field, exactly as
`offerDonationAction`'s `thanh-vien` already does. It is checked against the
context inside the command, so the hidden field is a convenience and not a trust
boundary.

**Comments turned off.** `commentsEnabled(tx, ctx.bookshelfId)` is read alongside
the comment list. When a shelf has declined comments, the whole section is
absent — not a disabled textarea, and not the section heading over an
explanation. A shelf that does not take comments has no comments area, which is
what the setting means.

**Awaiting approval.** `getBookComments` returns approved comments only, and that
predicate is INV-9 living in the access path; its own docstring says a reader
seeing their own pending comment would be *"a product decision and a different
query"*. This design does not make that change. Instead the action redirects with
`?da-gui=1` and the page renders a `SavedNotice` above the form:

> *"Đã gửi. Quản lý tủ sách sẽ duyệt trước khi bình luận hiện lên."*

— when the shelf requires approval, and *"Đã gửi bình luận."* when it does not.
That distinction needs `commentsRequireApproval`, which the page reads anyway to
decide the sentence. A reader is told what happened without a query loosening the
one predicate that guarantees INV-9.

### Consequences elsewhere

- The exemption at `every-domain-command-has-a-caller.test.ts:125` is deleted.
  `createComment` will have a caller, and the list at line 207 already expects
  all four names.
- `/quan-ly/binh-luan` starts receiving real rows. No change to that page.
- The `pendingComments` badge in `ManagerShell` starts moving. No change there
  either — it has been wired to `getManagerBadgeCounts` since U5.

---

## 2. Management chrome cannot reach the shelf

### What is wrong

`ManagerShell`'s sidebar wordmark links to `/` (`manager-shell.tsx:381`), and
`MobileBar`'s title — which on a manager screen is *the shelf's own name* —
also links to `/` (`manager-shell.tsx:271`). Nothing in seventeen manager screens
points at `/tu-sach/[shelf]`. A volunteer who wants to see what a reader sees
types the URL.

The mobile case is the worse of the two: the shelf's name is a link to the site
home, which is a link that says one thing and does another.

### What we build

`MobileBar` gains a `titleHref` prop. `ManagerShell` passes
`/tu-sach/${shelfSlug}`; `AdminShell` passes `/`, which is what it means and
what it already does.

In the desktop sidebar, the shelf name under the wordmark stops being a `<p>`
and becomes a `<Link>` to `/tu-sach/${shelfSlug}`, with a `Library` icon and the
label reading the shelf name unchanged. The wordmark above it keeps `/`. The two
links then read as what they are: the site, and this shelf.

No new nav entry in `NAV`. That array is the manager's working surfaces and its
`ManagerNavKey` union is checked against the `active` prop on every page; adding
a non-manager destination to it would make every page declare an `active` value
for a page that is not in the sidebar.

---

## 3. The selected loan on Nhận trả is invisible

### What is wrong

`nhan-tra/page.tsx:190` renders the selected loan as
`<Card className="border-terracotta">` — `Card`'s default is
`rounded-card border border-hairline bg-surface p-6`. Every unselected row is
`rounded-card border border-hairline bg-surface p-6`. The entire difference
between chosen and not chosen is the colour of a one-pixel border.

That also breaks a non-negotiable rule: BR §17.2 and `AGENTS.md` rule 2 — state
is never colour alone, it carries an icon and a word too.

### What we build

The selected row gets three changes, in the order they are noticeable:

1. **A filled tonal background** — `bg-terracotta/8`, the same eight-percent tint
   the refusal banner on this very page already uses for `bg-brick/8`
   (`nhan-tra/page.tsx:131`). Flat tonal layer, no shadow, no gradient.
2. **A terracotta rail** down the left edge — a 3px bar, the same marker
   `ManagerShell` uses for its active nav entry (`manager-shell.tsx:407`), so
   "this is the one" reads the same way in both places.
3. **The word and the icon** — a `Pill` reading *"Đang chọn"* with `CheckCircle2`,
   placed beside the `StatusBadge`. `Pill` is the component `AGENTS.md` names for
   any state that is not one of the six copy states, and it requires both an icon
   and a label, which is the rule enforcing itself.

Unselected rows keep `hover:bg-paper` and gain nothing. The form below the list
already makes the selection explicit in words; this is about the list.

---

## 4. `/tu-sach` offers sign-in to people already signed in

### What is wrong

Every row links to `/dang-nhap?tu-sach=<slug>` unconditionally
(`tu-sach/page.tsx:112`), and the page's subtitle reads *"Chọn tủ sách của giáo
xứ mình để đăng nhập, hoặc để đăng ký nếu bạn chưa có tài khoản."* The header
directly above already greets the visitor by name, because Task 6 wired
`loadFrontDoorViewer` into it — the page body simply was not part of that task.

### What we build

The page already resolves the viewer for its header. It gains the viewer's
memberships from the same call (see §7), and each row's destination follows from
them:

| Row | Destination | Reads |
|---|---|---|
| A shelf the viewer belongs to | `/tu-sach/<slug>` | **Vào tủ sách** |
| Any other shelf, viewer signed in | `/dang-ky?tu-sach=<slug>` | **Đăng ký** |
| Any shelf, nobody signed in | `/dang-nhap?tu-sach=<slug>` | unchanged |

A member's own shelf is marked with a `Pill` reading *"Tủ sách của bạn"*, so the
row that is different looks different rather than only behaving differently.

The subtitle changes for a signed-in visitor to *"Tủ sách của bạn ở đây. Bạn
cũng có thể xem các tủ sách khác trong hệ thống."* — the directory stays
browsable, which is the whole reason the page exists (§1.2), and is why we are
not redirecting members away from it.

`SHELF_PARAM` is the existing spelling of `tu-sach=` and is reused for the
registration link. `/dang-ky` already reads that key — as the bare literal
`"tu-sach"` (`dang-ky/page.tsx:56`) rather than through the constant, which this
work fixes in passing, since a portal link and the page it targets disagreeing
about one string is exactly what `SHELF_PARAM` was extracted to prevent.

---

## 5. The top bar has no way to your own shelf, and no way home

### What is wrong

Two surfaces, two different gaps.

`FrontDoorHeader`'s signed-in nav is `Tìm tủ sách`, plus `Quản trị hệ thống` for
a super admin, and nothing else (`public-header.tsx:310`). A reader signed in and
standing on `/lien-he` has no link to their own shelf.

`ShelfHeader` has no link to `/` at all. Its title is the shelf's name and links
to the shelf home; the site itself is unreachable from every reader page.

### What we build

**`FrontDoorHeader`** gains one link at the head of its signed-in `links` array:

- Exactly one membership → **Tủ sách của tôi**, straight to `/tu-sach/<slug>`.
- Several memberships → **Tủ sách của tôi**, to `/tu-sach`, which after §4 marks
  each one they belong to.
- No membership → no link. A super admin belongs to no shelf by design
  (`landingShelfFor`'s docstring) and already has `Quản trị hệ thống`.

This is the rule `landingShelfFor` already applies at sign-in, applied to a link
instead of a redirect — which is why §7 pulls it into one function rather than
writing the count test twice.

**`ShelfHeader`** gains a small `OLibra` wordmark above the shelf name, in
`text-meta`, linking to `/`. The shelf name below it keeps its size, its weight
and its own link. This is the arrangement `ManagerShell`'s sidebar already uses —
site above, shelf below — so the two chromes agree about which is which.

Neither header gains a second terracotta accent. Both new links are plain nav
links, per `Button`'s own docstring and AGENTS.md rule 3.

---

## 6. A site footer, everywhere, carrying the administrator's contact details

> **Changed during implementation.** "Everywhere" turned out to be wrong for
> the management screens. A full-width footer running underneath a fixed
> sidebar reads as a layout that has come apart rather than as chrome, and it
> was reported on sight the moment it shipped. `/quan-ly/*` and `/quan-tri`
> have no footer; the reader routes moved into a `(doc-gia)` route group —
> which changes no URL — so the layout below wraps them and not the management
> area. The surface table further down describes the *original* plan; the
> shipped shape is that group's layout plus the front-door pages.

### What is wrong

`FrontDoorFooter` renders on four pages — `/`, `/tu-sach`, `/lien-he`, `/loi` —
and is hardcoded to `OLibra`, two links and `© 2026 OLibra`. Reader shelf pages,
all seventeen manager screens and all seven administration screens have no footer
at all.

Meanwhile a super admin fills in a contact name, telephone number and hours at
`/quan-tri/cai-dat`, `getSiteContact` reads them guest-callably through
`olibra_public`'s column-level grant, and exactly one page in the application
displays them.

### The two constraints that decide the shape

**A footer that queries the database poisons every page that renders it.**
`tests/architecture/pages-reading-the-database-are-dynamic.test.ts` walks a
route's imports *transitively* and requires `force-dynamic` on anything whose
closure reaches `lib/page-data`, `db/client` or `domain/kernel/unit-of-work`. Of
the six pages that render a footer today or will, five (`/`, `/tu-sach`,
`/lien-he`, `/dang-nhap`, `/dang-ky`) already reach the seam and already carry
the marker. **`/loi` does not, and must not** — the error page is the one screen
that has to render when the database is the thing that failed.

**The landing page must survive with no database at all.** The Dockerfile's
`smoke` stage boots `bun server.js` with no environment and fetches `/` to prove
the image serves a page; `loadFrontDoorViewer` carries a long comment about the
build this exact mistake broke once already (`page-data.ts:426-450`).

### What we build

**`SiteFooter` is a pure presentational component** in
`src/components/shell/site-footer.tsx`, taking `contact: SiteContact | null` as a
prop and importing nothing that reaches Postgres. It replaces `FrontDoorFooter`,
which is deleted; its four current callers pass the new prop.

Layout: the wordmark and copyright as today; the existing `Tìm tủ sách` and
`Liên hệ` links; and, when `contact` is non-null and has a name or a phone, a
contact block — *Liên hệ ban quản trị*, the name, a `PhoneLink` (never plain
text, per AGENTS.md), and the hours. When `contact` is null or empty the block
is absent and the footer is what it is today. A fresh installation with nothing
filled in gets no empty labels.

**`siteContact()` in `src/lib/page-data.ts`** is the seam that reads it, and it
short-circuits to `null` when `DATABASE_URL` is unset — the same guard shape, and
the same reasoning, as `loadFrontDoorViewer`'s `if (token === null) return null`:
a deployment with no database configured has no contact to show, and the smoke
stage stays green. Every other failure keeps throwing.

**Reach, via route layouts rather than forty edits:**

| Surface | Where the footer is rendered |
|---|---|
| Reader shelf pages and all manager pages | new `src/app/tu-sach/[shelf]/layout.tsx` |
| All administration pages | new `src/app/quan-tri/layout.tsx` |
| `/`, `/tu-sach`, `/lien-he`, `/dang-nhap`, `/dang-ky` | the page, calling `siteContact()` |
| `/loi` | the page, with `contact={null}` |

Both new layouts call `siteContact()` and carry `export const dynamic =
"force-dynamic"` for the architecture test, which enumerates `layout` among the
route files it checks. A layout's own database reach does not propagate to the
pages beneath it — the test reads each route file's own closure — so no page
acquires a marker it does not need.

On manager and administration screens the footer sits below the sidebar-and-main
row, full width. That is the consequence of *truly everywhere*, and it is a plain
horizontal rule and three lines of `text-meta` under a work surface.

`/loi` passes `null` deliberately, and it is the one page where that is a
correctness argument rather than a preference: an error page that queries the
database cannot render the failure it exists to report. It keeps the footer's
links and copyright and shows no contact block.

---

## 7. Shared change: the viewer's shelves

§4 and §5 both need *which shelves does this person belong to*, and
`landingShelfFor` already answers a narrower version of that question with the
`olibra_admin` escalation the cross-shelf read requires.

`src/auth/guards.ts` gains:

```ts
export async function shelvesFor(
  sql: Sql,
  userId: string,
): Promise<{ slug: string; name: string }[]>
```

— the same statement `landingShelfFor` runs, with `b.name` added and ordered by
name. `landingShelfFor` is rewritten as one line over it
(`rows.length === 1 ? rows[0].slug : null`), so the "exactly one shelf" rule
exists in one place and its docstring keeps owning the reasoning.

`frontDoorViewerFor` gains `shelves` on its return shape, and
`loadFrontDoorViewer` passes it through. Its existing no-token short-circuit
still applies, so a stranger's request pays for nothing.

The escalation's justification is unchanged and worth restating: this is a person
listing their own memberships, scoped to their own `userId`, which is not the
cross-tenant browse INV-10 exists to stop.

---

## Testing

Following the repository's existing split:

- `tests/domain/community/comments.test.ts` covers `createComment` already. New
  coverage is the action, not the command: no domain test is added for §1.
- `tests/components/public-header.test.tsx` exists and pins this header's
  behaviour. It gains cases for the `Tủ sách của tôi` link across the three
  membership counts, and for the `ShelfHeader` home link.
- `tests/architecture/every-domain-command-has-a-caller.test.ts` — the
  `createComment` exemption is removed, and the test itself becomes the check
  that §1 landed.
- `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` — passes
  unchanged, and is the guard on the two new layouts.
- A new `tests/components/site-footer.test.tsx`, in the shape
  `public-header.test.tsx` already uses: the contact block renders when there is
  a contact, and is absent for `null` and for a contact with neither name nor
  phone.
- `bun run check` (typecheck, lint, format, test) is the gate on each item.

## Order of implementation

Each lands and is verified on its own.

1. §7 — `shelvesFor`, since §4 and §5 both need it.
2. §5 — header links.
3. §4 — portal rows.
4. §2 — manager chrome.
5. §3 — Nhận trả highlight.
6. §6 — footer, the widest blast radius of the five chrome items.
7. §1 — comments.

## Explicitly not in scope

- Reading your own pending comment (§1) — a different query, and INV-9's
  docstring names it as a product decision.
- Editing or deleting a comment you wrote. No command exists.
- A photo on the return-condition form — U1 §6.1 records what wiring it costs.
- Any change to `/quan-ly/binh-luan`. It works; it has had nothing to moderate.
