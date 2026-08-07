# OLibra — Pencil Screen Designs (Phase 1, Desktop)

**Date:** 2026-08-07
**Status:** Approved scope, pending execution
**Authority:** [BUSINESS-REQUIREMENTS.md](../../BUSINESS-REQUIREMENTS.md) §16–17 for content and behaviour; [DESIGN.md](../../DESIGN.md) for every visual value. This spec only decides *which screens* get designed, *at what size*, and *how the .pen file is organised*. Where this spec and those documents disagree, those documents win.

## Scope

Phase 1 core loop only, designed in Pencil (.pen) via the Pencil MCP.

- **Frame width:** 1280px (`xl`). Content capped at 1200px. Desktop web only — no mobile frames in this batch.
- **Themes:** every screen in both light and dark, using the §1 token table of DESIGN.md. Dark frames are the same layout with dark token values; in dark mode every elevated surface gains a 1px `--border` outline.
- **Language:** all copy in plain Vietnamese per DESIGN.md §9. No lorem ipsum — realistic Vietnamese book titles, names, and dates.

## Screen inventory — 16 screens × 2 themes = 32 frames

### Public (5)

| # | Screen | Key content (from §16.1) |
|---|---|---|
| 01 | Shelf home | Shelf identity + keeper phone, announcements, two large buttons (*Sách đang có* / *Toàn bộ tủ sách*), most-borrowed cover row, most-active readers, latest comments, quiet feedback link |
| 02 | Catalogue | 6-column cover grid, filter bar (availability segmented control, category, sort), availability badges; includes the empty-search state inline (suggests popular books) |
| 03 | Book detail | Cover + title, availability panel (*available* variant: green badge, copy count, large **Xin mượn**), metadata, description, approved comments |
| 04 | Registration | Single page, single column, four field groups (*Đăng nhập*, *Bản thân*, *Gia đình*, *Giáo xứ*), helper text on every field, *Bắt buộc* markers |
| 05 | Login | Username + password, manager-reset note (no email reset in v1) |

### Manager (11)

| # | Screen | Key content (from §16.3) |
|---|---|---|
| 06 | Dashboard | Four tappable stat cards (*Quá hạn*, *Chờ duyệt tài khoản*, *Yêu cầu mượn*, *Bình luận chờ duyệt*), two 2xl full-width buttons (**Cho mượn** / **Nhận trả**) in `--primary-strong`, shelf totals, recent activity |
| 07 | Quick lend — find book | Search box focused on load, cover-and-title result rows, copy selector where a title has several copies |
| 08 | Quick lend — pick reader + confirm | Searchable active-member list, "register a new reader" escape hatch, confirm panel (book, reader, due date, one button); includes one blocked-action example (reader at loan limit) shown *before* confirm |
| 09 | Receive return — find loan | Search currently-borrowed list by book or reader |
| 10 | Receive return — condition + confirm | Six-tile condition picker in a single row, *Nguyên vẹn* preselected with check mark, note + photo fields hidden for the good grade, confirm |
| 11 | Books list | Desktop table (56px rows, `--muted` header), search + filters, status badges |
| 12 | Book form | Create/edit, single column, cover uploader first |
| 13 | Book detail (manager) | Public detail plus per-copy state table, condition history, loan history |
| 14 | Readers list | Searchable table with status filters |
| 15 | Reader detail | Full profile incl. manager-only fields, current loans, history, administrative actions |
| 16 | Pending registrations | Review card per application with all fields to verify, prominent **Duyệt** / **Từ chối**, required rejection reason, similar-name warning example |

**Excluded (later phases):** borrow request queue, holds, comments moderation, announcements, statistics, reader dashboard/history/profile, portal, marketing landing, blog, all super-admin pages, audit log browser, standalone loading/error-page frames. Empty and blocked states appear inline only where listed above.

## Approach

**Components first, then screens.** The .pen file gets a Foundations section built before any screen:

1. **Tokens** — colour swatches (light + dark), type scale specimens, spacing/radius reference.
2. **Component sheet** — reusable Pencil components consumed by every frame: buttons (primary/secondary/outline/ghost/destructive/link × md/lg/xl/2xl), input (default/focus/error), status badge (all six states), book card (incl. generated-placeholder variant), stat card, table header/row, condition picker tile, sidebar (256px, per §4.3), public top nav.

Screens are then assembled only from these components plus layout primitives. Rationale: 32 frames stay consistent, and dark mode is a token swap rather than 16 repaints — matching DESIGN.md's "a screen and its implementation cannot drift".

## Canvas organisation

- One .pen file — the currently open Pencil document.
- Sections: **Foundations**, **Public**, **Manager**. Within each surface section, light row on top, dark row directly beneath.
- Frame naming: `01-shelf-home-light`, `01-shelf-home-dark`, … `16-pending-registrations-dark`.

## Non-negotiables carried into every frame (checked per screen)

From DESIGN.md: one dominant primary action; status = icon + word + colour (tinted badge, never solid); Vietnamese copy, never all-caps; visible focus treatment on the component sheet; AA contrast throughout using only the token values; cards use 1px border not shadow; tables 56px rows; buttons ≥44px targets; labels above inputs; required = the word *Bắt buộc*.

## Done when

All 32 frames exist, named per the convention, each buildable from the component sheet, and a screenshot review against the §16 content lists and the non-negotiables above passes.
