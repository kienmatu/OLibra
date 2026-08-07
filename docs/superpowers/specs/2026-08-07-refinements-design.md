# Refinements before the backend — design

**Date:** 2026-08-07
**Status:** Approved. Feeds BUSINESS-REQUIREMENTS.md, OPERATIONS.md, DATABASE.md and the backend master plan.

Five refinements requested after walking the built interface. Three are wording. Two change the domain: reporting a book lost at the moment of return, and recording who gave a book.

---

## 1. Wording

| Where | From | To |
|---|---|---|
| Shelf home button, catalogue filter | Sách đang có | **Sách có sẵn** |
| Book detail, availability panel | Có 2 trên 3 bản đang ở **trên kệ** | …đang ở **trong tủ** |
| Book detail, empty state | Cuốn này hiện không có **trên kệ** | …không có **trong tủ** |
| Manager copies table, location value | Trên kệ | **Trong tủ** |

**The collection line is not only wording.** Book detail currently reads "Đến tủ sách sau lễ Chúa nhật để nhận sách." — one shelf's opening hours written into a page every shelf renders. The second fixture shelf opens 8:30–10:30 on a different day, so the sentence is already wrong for it.

It becomes a contact line built from the shelf record: **"Liên hệ {keeper} · {phone} để nhận sách."** The phone is tappable, as §16.3 requires of every reader-facing phone number. Opening hours stay on the shelf home, where they belong and are already correct.

---

## 2. Reporting a book lost during a return

### The rule that shapes this

§9 excludes `lost` from the condition list deliberately: condition is how damaged a book is, and a damaged book keeps circulating. Loss is a copy *state* — it removes the book from circulation and needs a path back. Putting "Làm mất" beside "Rách" would put two different kinds of thing in one row of buttons.

### What is added

The condition list stays at six. Step 2 of **Nhận trả** gains a distinct secondary route beneath the condition buttons:

> **Bạn đọc báo làm mất** — switches to the report-lost path instead of the return path.

The loan closes as `lost`, not `returned`. The copy goes `on_loan → lost`. This is the existing `ReportCopyLost` command reached from a second entry point, exactly as **Cho mượn** on book detail is a second entry point to `LendCopy`.

Everything else already exists and needs no change: a lost copy cannot be lent (INV-7), only a manager restores it (`MarkCopyFound`), and both transitions write audit records (INV-8).

### The gap this exposes

**"Báo mất" appears in three places in the built interface. `MarkCopyFound` appears in none.**

There is no lost-copies list, no filter, and no "đánh dấu tìm thấy" button anywhere among the 42 screens. A copy reported lost today leaves circulation and nothing in the interface can bring it back — even though §7.1 draws `lost → available` and §3 lists "a book reported lost is found months later" as a case the system must handle.

Adding a fourth way to report a book lost without adding the way back would make a one-way door wider. So this refinement is two things:

1. The new route out of the return flow.
2. **A lost-copies view** — reachable from the manager's Sách list as a status filter — with **Đánh dấu tìm thấy** and **Ngừng dùng** per copy, matching §7.1's two exits from `lost`.

---

## 3. Tặng sách

### Two entry points, because donations arrive two ways

A family hands a bag of books to a volunteer after mass. A reader decides at home that they want to give their old books away. Both are real; they need different affordances.

### Manager side — who gave this copy

The **Thêm sách** and **Thêm bản** forms gain **Người tặng**, which accepts either:

- an existing member, chosen from a search, or
- a typed name, for someone with no account.

This is provenance on the physical object, so it belongs on the copy, and the columns already exist and have never been used by a form: `book_copies.acquired_from` (text) and `acquired_on` (date). One column is added — `acquired_from_membership_id`, nullable — so a member donor is a real link rather than a name that happens to match. This is the same member-or-outsider shape `feedback` already uses.

`acquired_on` defaults to today and is editable, because a donation is often catalogued weeks after it arrives.

### Reader side — offering to donate

A **Tặng sách** screen for signed-in members:

- a free-text description ("Em có 5 cuốn truyện tranh và 2 cuốn Dế Mèn")
- an optional photograph
- a rough number of books

**Nothing else.** A child does not know the publisher, the page count or the ISBN, and may not remember the title correctly. Book data is only worth recording once a volunteer has the book in hand — which is exactly when the manager fills the catalogue form.

Submitting creates a **BookDonation** with status `pending`. A manager sees the queue, and:

- **Duyệt** opens the add-book form with **Người tặng** pre-filled with that member, and moves the donation to `received`.
- **Từ chối** closes it with a reason.

Today this need is served by the feedback inbox — there is a fixture message titled "Muốn tặng sách cũ" sitting in it. This replaces that workaround.

### BookDonation

| Field | Note |
|---|---|
| bookshelf | the tenant |
| donor membership | always a member — submitting requires signing in |
| description | free text, required |
| photo | optional |
| estimated count | optional |
| status | `pending` · `received` · `declined` |
| decided by, decided at, decision note | reason required on decline, matching every other rejection flow |

The donation record is *not* the provenance record. It is an offer with a lifecycle. Provenance lives on `book_copies`, survives the donation being tidied away, and is the thing a manager reads years later.

### Where the queue lives

**In the sidebar nav with a count badge**, beside Đổi thông tin and Yêu cầu mượn — not as a fifth dashboard stat card. §16.3 specifies four large tappable cards, and the fourth was already chosen for a reason. A fifth card is a change to that decision rather than an addition to it.

---

## 4. Phase assignment

| Piece | Phase | Why |
|---|---|---|
| Wording, contact line | 1 | Copy on Phase 1 screens |
| Report-lost route out of the return flow | 1 | Circulation is Phase 1, and `ReportCopyLost` already is |
| Lost-copies view | 1 | It is the missing half of a Phase 1 command |
| `Người tặng` on the catalogue forms | 1 | Part of cataloguing |
| `acquired_from_membership_id` column | 1 | Schema lands whole; retrofitting provenance later means backfilling from free text |
| Reader-facing Tặng sách screen and the queue | 2 | Community, alongside comments and announcements |

The data model is Phase 1 even where the screen is Phase 2, so provenance is recorded from the first row of data rather than reconstructed afterwards.

---

## 5. New operations

| Operation | Caller | Phase |
|---|---|---|
| `OfferDonation` | `reader` | 2 |
| `ReceiveDonation` | `manager` | 2 |
| `DeclineDonation` | `manager` | 2 |
| `GetDonationQueue` | `manager` | 2 |
| `GetMyDonations` | `reader` | 2 |

`CreateBook` and `AddCopies` gain optional `donorMembershipId`, `donorName` and `acquiredOn` inputs. `ReportCopyLost` and `MarkCopyFound` are unchanged — they gain entry points, not contracts.

`ReportCopyLost`'s open question in OPERATIONS §4.1 — whether an `available` copy can be reported lost — is untouched by this work and stays open. The return-flow route only ever acts on a copy that is `on_loan`.

---

## 6. What this deliberately does not do

- **No donation of a specific catalogued title.** A donor picking from the existing catalogue only helps when the gift duplicates something already on the shelf, which is the uncommon case.
- **No per-book entry by the reader.** Rejected above: more work for a child, less reliable data, and the manager re-checks it anyway.
- **No fifth dashboard card.** See §3.
- **No change to the condition list.** See §2.
- **No auto-cataloguing from an approved donation.** The manager types the book details, because only they have the book.
