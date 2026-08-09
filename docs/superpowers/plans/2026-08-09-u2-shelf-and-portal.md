# U2 · The shelf a member sees, and the door a stranger comes through

**Blocked by:** U1 (merged — the page-data seam). **Blocks:** nothing; U3 (manager surfaces) is independent.

---

## 1. Reconciliation, before anything else

This slice was very nearly written on a false premise, and the correction is the first thing an implementer needs.

| The assumption | What the code and BR actually say | Consequence |
|---|---|---|
| "The public catalogue" — pages children and parents browse without signing in | `getCatalogue`, `searchCatalogue` and `getBookDetail` all call `requireReader` (`get-catalogue.ts:91`, `search-catalogue.ts:28`, `get-book-detail.ts:59`). BR:36 — "**Only the first two surfaces are public**"; BR:91 — "a shelf is now visible only to its members, there is no anonymous caller to serve"; BR:426 — a `guest` "sees only the landing page, the portal directory, and the sign-in and registration forms"; BR:496 — "Shelf home … **Not public.**" | The catalogue is **member-only**. The queries are right. BR §1.4's Phase 1 phrase "the public catalogue and search" is loose wording for the catalogue *surface*, not a guest-visible one — do not read it as a requirement. |
| The portal is already backed by a query | `src/app/tu-sach/page.tsx` filters `shelves` from `@/lib/fixtures` in the page body | The portal needs a **new query**, and it is the project's first genuinely guest-callable read. |
| A guest reaching a shelf page should 404, as U1 established for manager pages | `20260808_12_bookshelves_public_read.sql` makes shelf *existence* public, and the portal advertises it by name and address | A 404 is wrong here. See §3.1. |

Verify the rest against `main` at `505e266` before starting. Every plan in this project has gone stale, and every reconciliation pass has found something.

## 2. What this slice is

Two surfaces that meet at the sign-in form:

- **The door.** `/` and `/tu-sach` — genuinely public. A stranger whose parish has a shelf must be able to find it and register. Name and address, nothing else.
- **The shelf.** `/tu-sach/[shelf]`, `/danh-muc`, `/tim-kiem`, `/sach/[slug]` — member-only, and the first four member-gated pages in the project. Every page U1 wired was manager-gated.

## 3. Decisions

### 3.1 A guest reaching a member page is sent to sign in, not 404'd

U1 established that a reader reaching a *manager* URL gets `notFound()`, deliberately, because a redirect would confirm the page exists. That reasoning does not transfer, and the difference is worth stating precisely:

**A manager page's existence is not public. A shelf's is.** `bookshelves_public_read` exists so the portal can list shelves by name and address; the portal then links to them. A 404 from a link the portal just showed you is a dead end, and the person hitting it is overwhelmingly a member who is simply not signed in yet — on a shared parish phone, that is the normal case, not the adversarial one.

So: **a guest on a shelf page is redirected to `/dang-nhap` with a return path**, and lands back where they were going. A *signed-in non-member* is a different question — they have a session and still no membership here. Same redirect would loop. They get the 404, because for them the shelf's contents genuinely are none of their business, and BR:91 closed the anonymous-caller path deliberately.

`loadPage` currently maps `not_permitted` to `notFound()` for everything. It needs to distinguish these two, and the distinction must be a test, because the loop is the failure mode nobody notices until a real user is stuck in it.

### 3.2 `listPublicShelves` returns name, address and slug — and that is a guarded list, not a convention

The portal page's own comment already says it: *"Book counts, reader counts and the keeper's phone number were here before and should not have been — a person with no membership has no business knowing them (§16.1)."*

That was true of a fixture. Backed by a real query it becomes a live disclosure boundary, and `tests/db/bookshelves-public-columns.test.ts` already exists to guard exactly this class — it is the guard C1 and U1 each had to add a per-column exemption to. This query is the one place that *should* read those columns, so it earns an exemption with a justification, and a test asserts the returned object has no other keys.

BR:179 says the keeper's name and phone are "both shown publicly" — but §16.1 places them on the *shelf's own* page, which is member-only, not on the portal. If those two readings conflict for a field, the portal shows less.

### 3.3 Everything stays dynamic

A shelf's catalogue is the same for every member of that shelf, so it looks cacheable. It is not worth it yet, and the reason is worth writing down rather than rediscovering:

The cache key would have to include the shelf *and* the viewer, because these pages carry the viewer's own name in the header. That key is correct right up until someone adds one personalised element — "sách bạn đang mượn", a badge, a comment — and does not update it. The audience is a few hundred people per parish and the data changes whenever a volunteer works.

**Correction (Minor 11, fix-report 2026-08-09-u2-shelf-and-portal).** This paragraph and §5's acceptance bullet both said the key would need the viewer's *role*, "because a manager sees drafts (`is_published`) and a member does not". That is not what the code does, and it was wrong when it was written: all three reader queries — `getCatalogue`, `searchCatalogue`, `getBookDetail` — carry a bare `and b.is_published` with no role branch at all, and drafts appear only in `getBooksList`, which is the manager's own list on a manager route. A manager browsing `/danh-muc` sees exactly what a member sees. The conclusion (do not cache) is unchanged and the reason is still good; it is the viewer's *name* that personalises the render, which is what `src/app/tu-sach/[shelf]/page.tsx`'s own docstring says while citing this section. The correction previously existed only in a commit message.

U1's architecture test already enforces this for anything reaching Postgres transitively. These pages inherit it.

### 3.4 The public header stops lying

`src/components/shell/public-header.tsx` imports fixtures and renders a hardcoded reader. U1 recorded the same problem for the manager shell and deferred it as its own slice. This slice cannot defer it: it wires the four pages that header sits on, and a page showing real books under a stranger's name reads as working and is not.

The actor's display name is a `TenantContext` question — `Actor` carries `userId`, `membershipId` and `role`, and no name. Resolve it in the seam alongside the context rather than in each page, and say so, because U3 will want the same thing for the manager shell.

## 4. Tasks

**1 — `listPublicShelves`.** A guest-callable query. It cannot use `runQuery`'s tenant scoping the way every other query does, because there is no shelf yet — work out what it runs as and make the answer explicit and tested. The seam needs a way to load a page with no shelf; `loadPage` takes a `shelfSlug` today.

**2 — The portal and the landing page.** Wire `/tu-sach` to it. Check whether `/` needs it too.

**3 — The guest/non-member split in `loadPage`**, with tests for both paths including the redirect loop.

**4 — The four member pages**, following U1's worked example (`quan-ly/cho-muon/page.tsx`).

**5 — The public header's real identity.**

**6 — Verify in a browser** at desktop and mobile widths, signed out and signed in, as a member and as a non-member of that shelf. Not by reading the code.

## 5. Acceptance

- [ ] A guest on the portal sees every active shelf's name and address, and **nothing else** — asserted on the returned object's keys, not by reading the SQL
- [ ] A guest on a shelf page lands on sign-in and returns to where they were going
- [ ] A signed-in non-member gets a 404, and **cannot be put into a redirect loop**
- [ ] A member sees the catalogue — ~~and a manager additionally sees drafts~~; see §3.3's correction, the reader queries have no role branch and drafts live only in `getBooksList`
- [ ] No page in this slice can be served from cache to a different viewer
- [ ] The header names the person actually signed in
- [ ] `bun run check` and `bun run check:links` green, and **CI green on the PR**

## 6. Out of scope

The manager surfaces (U3: shell chrome, dashboard, lists, overdue, reader detail); the reader's own pages (`toi/*`); comments and announcements on the book page (B3); "Xin mượn" (C2 — the button may render, but it must not pretend to work).

### What the fix wave deliberately left for a later slice

Recorded here rather than in a commit message, because §3.3's own correction above is what happens when a decision only exists in one.

**Eight unwired member routes are still reachable by typing their address**, and still render `src/lib/fixtures.ts`: `toi`, `toi/ho-so`, `toi/lich-su`, `toi/tang-sach`, `toi/thong-bao`, `thong-bao`, `gop-y`, `tang-sach`. Signed out entirely, all eight return 200 with a full reader dashboard under the invented name "Giuse Trần Minh".

IMPORTANT 4 of the fix report removed the four links that led there from a *wired* page — "Thông báo" and "Trang của tôi" from `ShelfHeader`, and the shelf home's two quiet links out — so a member can no longer arrive at one from a real page, which is the half U2 actually broke. It did not gate them, and the reason is worth having in writing: gating a fixture page behind `loadPage` produces a page with real chrome and an invented body, which is precisely what `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` exists to prevent, and that guard fails on such a page by construction. There is no version of "gate them" that does not weaken it.

Their public reachability is the same condition every one of the forty-one unwired pages in this app is in, and was not introduced by this slice. The slice that wires each page closes it, and the link comes back with the page.

**`/dang-ky` shows the wrong parish**, for exactly the reason `/dang-nhap` did (IMPORTANT 3): it renders `shelf.name` and `shelf.parishUnits` from the fixtures, so a stranger from Vĩnh Long following "Đăng ký tài khoản mới" lands on a form headed "Tủ sách Đồng Tháp" offering Đồng Tháp's parish units. The link is kept — it is the only way to register, and BR §1.2 makes registration the reason the front door exists — and the target carries a named exemption in that guard. `RegisterMembership` is `NotWired` and `tests/domain/members/registration-not-wired.test.ts` pins it, so this belongs to the slice that wires registration; `?tu-sach=` and `findPublicShelf` are both there for it now.

**`GetShelfHome`'s most-borrowed row and most-active readers** have no query, and OPS §3.2 (`OPERATIONS.md:59`) does specify them. See the master plan's operations table, where the row is recorded against its slice.
