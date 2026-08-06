# OLibra — Design System

The visual language for OLibra. Derived from §17 of [BUSINESS-REQUIREMENTS.md](BUSINESS-REQUIREMENTS.md); that document is the authority, this one is the working brief for design tools and implementers.

## Who this is for

Children who may have been reading fluently for only a few years, and adult volunteers who may not use smartphones confidently. Both are served by the same things: large targets, plain words, high contrast, obvious next actions.

It should feel like a warm community bookshelf in a church hall — not enterprise software, and not a children's game either. Calm, generous, legible.

## Non-negotiables

1. **One primary action per screen**, visually dominant.
2. **Status is never carried by colour alone.** Every state carries an icon, a word, and a colour.
3. **Plain Vietnamese, no jargon.** All copy is Vietnamese.
4. **Mobile at 375px is the primary manager experience**, not a fallback.

## Colour

| Role | Value | Purpose |
|---|---|---|
| Background | `#FAF8F5` warm off-white | Page |
| Foreground | `#1C1917` near-black warm grey | Body text |
| Primary | `#B45309` deep amber / terracotta | Primary actions |
| Secondary | `#E7E0D8` warm stone | Secondary surfaces |
| Muted | `#78716C` light warm grey | Meta text, borders |
| Accent | `#0D9488` soft teal | Highlights, links |
| Destructive | `#DC2626` clear red | Destructive actions |

Dark mode uses a warm near-black (`#1C1917`), never pure black.

### Status

Always icon + word + colour together.

| State | Colour | Icon | Vietnamese label |
|---|---|---|---|
| Available | Green `#15803D` | book-open | Còn sách |
| On loan | Amber `#B45309` | book-marked | Đang mượn |
| Held | Blue `#1D4ED8` | bookmark | Đang giữ chỗ |
| Overdue | Red `#DC2626` | alert-triangle | Quá hạn |
| Lost | Dark red `#991B1B` | help-circle | Đã mất |
| Retired | Grey `#78716C` | archive | Ngừng dùng |

All text meets WCAG AA. Primary actions and status badges target AAA where achievable.

## Typography

One sans-serif family with strong Vietnamese diacritic support — Be Vietnam Pro preferred, Inter acceptable. Self-hosted, never a third-party CDN.

- Public pages: 16px base
- Manager interface: 17px base — volunteers work fastest here
- Body line height: 1.6
- Headings are weight 600–700, never all-caps (Vietnamese diacritics suffer)

## Shape and spacing

- Corner radius: 8px on cards and inputs, 12px on large surfaces
- Spacing on a restricted 4px scale: 8, 12, 16, 24, 32, 48, 64
- Card padding: 16px mobile, 24px desktop
- Touch targets: minimum 44×44px; primary action buttons 56px tall
- Interactive elements never closer than 8px apart

## Components

**Cards** carry a subtle 1px border, not a heavy shadow.

**Book cards** are cover-dominant, 2:3 aspect ratio, title clamped to two lines, author to one, availability badge pinned to the cover's corner. A missing cover gets a generated placeholder: the title's first letter over a colour derived from the title, so the grid never looks broken.

**Tables** become stacked cards below 768px. Never a horizontally scrolling table. Each card leads with the identifying field and shows two or three others. Sorting is a select on mobile, column headers on desktop.

**Forms** are single-column, always. Labels above inputs, never beside. Required fields marked with the word *Bắt buộc*, not only an asterisk. Errors appear beneath the field in red with an icon. Inputs are 48px tall.

**The condition picker** is a row of large icon buttons, never a dropdown. Selection shows as a filled background plus a check — not colour alone. Options: Nguyên vẹn · Hơi cũ · Cũ · Rách · Mất trang · Bị vẽ vào.

**Charts** are bar and line only. No pie charts. Every chart carries a plain-text summary above it.

**Icons** are 20px inline, 24px standalone, from a Lucide-style outline set. Never without a text label in navigation or actions.

## Navigation

**Public:** top bar — shelf name, catalogue, announcements, search, login. Collapses to a hamburger below 768px.

**Manager:** sidebar on desktop; a five-item bottom tab bar on mobile — *Trang chính · Sách · Cho mượn · Người đọc · Thêm*. Five is the ceiling. Lend and return are one tap from anywhere.

## Motion

Restrained. 150–200ms ease-out on state changes. No entrance animations on content — volunteers are working, not being entertained. Buttons that trigger a change disable and show a spinner while in flight.
