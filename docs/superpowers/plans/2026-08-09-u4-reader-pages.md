# U4 · The reader's own pages

**Blocked by:** U1 (the seam), U2 (`Viewer`, the guards), B2b, C2, C3, D1, B3 — all merged.
**Blocks:** nothing.

The last large surface gap. Every command and query these pages need is already shipped and unreachable: D1's bell, C3's renew button, B3's announcements and donations, B2b's profile proposals.

---

## 1. Reconciliation, before anything else

Write the findings into this document as a `## Reconciliation against shipped code` table, against `main` at `fcc17f7`. Every plan here has gone stale; U2's premise was wrong outright, U3's found a defect already shipped.

Known before starting:

- **Four queries do not exist** and OPS §3.2 specifies all four: `GetMyDashboard`, `GetMyLoanHistory`, `GetAnnouncementDetail`, and B3's `GetMyDonations` (master §7.3 names the file; it was not built).
- `toi/ho-so` is **partly wired already** — B2b gave it `actions.ts` for the avatar upload and the page renders the existing control. Everything else on it is fixtures.
- The bell has no home yet. `ShellHeader` renders no notification affordance at all; D1's `getMyNotifications` returns the count that belongs on one.

## 2. Waves

**A — The dashboard and the bell.** `GetMyDashboard`, `GetMyLoanHistory`, `toi/`, `toi/lich-su`, `toi/thong-bao`, and the bell in the header. This is where C3's renew button and D1's notifications become reachable, which is the point of the slice.

**B — Profile, announcements, donations, feedback.** `toi/ho-so`, `[shelf]/thong-bao`, `GetAnnouncementDetail`, `toi/tang-sach`, `GetMyDonations`, `[shelf]/gop-y`.

## 3. Decisions

### 3.1 Days remaining is read from `loans_current`, never recomputed

`get-reader-detail.ts` already carries the rule and the correction: `isOverdue`/`daysRemaining` come from the view's own derived columns, and **must not** be re-derived in TypeScript, because the view follows `ctx.clock` through `olibra_now()`. A second definition of "overdue" is exactly what G5 exists to prevent, and U1's review found a stale comment talking a future implementer into building one.

The reader's dashboard is the screen where that temptation is strongest — a child wants "còn 3 ngày" and the number is right there in `due_on`.

### 3.2 The renew button shows *why* it cannot be pressed

C3 refuses a renewal for two different reasons and gives each its own sentence: `no_renewals_remaining` and `title_has_queue`. A disabled button with no explanation is what U2's review objected to for "Xin mượn", and the fix there was one line of plain Vietnamese.

So the dashboard must know, per loan, whether renewal is available — which means the *query* answers it, not the page. The same rule the lending screens follow: a query's block reason is an `ErrorCode`, rendered through `messageFor`, and **it must equal the code the command throws**. C1's review found those two disagreeing once, in the direction that turns a child away from a book that is there.

### 3.3 Queue position is derived on read

OPS §3.2 lists it as derived. C2's queue is `requested_at` order with a unique tiebreak; a position is a count of the requests ahead of this one for the same title. No column, no job — the same rule everything else in this system follows.

### 3.4 The bell is a count, and it is the seam's job

`loadPage` already resolves a `Viewer` once per render. The unread count belongs beside it rather than in each page, for exactly the reason U2 gave for the viewer's name: a page that forgets it renders a bell with no number, and nothing notices.

**A guest has no bell.** The header renders on public pages too.

## 4. Acceptance

- [ ] `toi/` shows real loans with days remaining from `loans_current`, and no page recomputes it
- [ ] The renew button's refusal sentence equals the code `renewLoan` throws — asserted against the thrown code, not a literal
- [ ] Renewing from the dashboard extends the loan and the page reflects it
- [ ] The bell shows the unread count; marking read clears it
- [ ] Queue position is derived, and moves when somebody ahead is served
- [ ] A reader sees only their own loans, requests, notifications and donations — asserted cross-reader, not just cross-shelf
- [ ] `bun run check` green, **CI green on the PR**

## 5. Out of scope

B4 administration, D2 statistics, `/quan-tri/*`, and the manager screens U3 already wired.
