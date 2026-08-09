# B3 · Community

**Blocked by:** S3 (long merged). **Blocks:** nothing. Master plan §7.3.

Seventeen commands across four unrelated lifecycles — comments, announcements, feedback, donations — which is why this is planned in three waves rather than one.

---

## 1. Reconciliation, before anything else

Write the findings into this document as a `## Reconciliation against shipped code` table. Verify against `main` at `bf3804e`. Every plan here has gone stale and every reconciliation has found something: C1's found 14, U2's found the slice's whole premise wrong, U3's found a defect already shipped in a query the plan only warned *new* queries about.

Verified already, and load-bearing:

- **`book_donations.donor_membership_id` references `memberships(id)`** (`0006_community.sql:68`) — a **membership** id, which is the *reverse* of this codebase's recurring trap. `comments.author_id`, `feedback.member_id`, `feedback.handled_by` and `book_donations.decided_by` are all `users(id)`. Getting either direction wrong inserts cleanly against the wrong FK or fails loudly; neither is a rule a reader can infer from the column name.
- `feedback` has **no `bookshelf_id` not-null** — it is nullable, "null for site-wide" (`:51`). B2b's review already found `feedback_tenant`'s policy is `bookshelf_id = … OR bookshelf_id IS NULL`, which is why a site-wide row is visible from inside any shelf's scope. That is deliberate and it is the one table in the system that behaves that way.
- `feedback` has **no `updated_at` and no `deleted_at`** — unlike every other table here.
- `announcements` has `unique (bookshelf_id, slug)` (`:43`) and both `body` and `body_text`.
- `book_donations_declined_has_reason` (`:83`) is `check (status <> 'declined' or decision_note is not null)` — the same shape as `loans_voided_has_reason`, and it catches null but says nothing about whitespace.

## 2. Waves

**A — Comments.** `CreateComment`, `ApproveComment`, `RejectComment`, `HideComment`, the member-facing and moderation queries, and INV-9's named test.

**B — Announcements.** `CreateAnnouncement`, `UpdateAnnouncement`, `PublishAnnouncement`, `PinAnnouncement`, `UnpinAnnouncement`, `HideAnnouncement`, plus reader and manager queries.

**C — Feedback and donations.** `SubmitFeedback`, `MarkFeedbackRead`, `ResolveFeedback`, `ArchiveFeedback`; `OfferDonation`, `ReceiveDonation`, `DeclineDonation`; the inbox and queue queries.

## 3. Decisions

### 3.1 INV-9 is asserted through the access path, not by filtering in the test

Master §7.3 is specific: *"a pending comment is absent from the member-facing query and present in the moderation query, asserted through the partial index's access path rather than by filtering in the test."*

`0006_community.sql:24` says the partial index "encodes that in the access path itself". So the member-facing query must be the thing that excludes a pending comment — a test that reads every comment and filters in TypeScript would pass against a query with no `status` predicate at all, which is the defect INV-9 exists to prevent.

### 3.2 Comments are plain text, and the test proves it round-trips

BR §5.4: plain text, rendered escaped, no rich text, no HTML. The acceptance test stores a body containing `<script>` and asserts it comes back as **literal characters** — because the failure this guards is not "the database rejected it" but "somebody later added a sanitiser and dropped the tags", which silently rewrites what a child wrote.

Rendering escaped is React's default and needs no work; what needs a test is that nothing on the way in or out alters the bytes.

### 3.3 The feedback rate limit stores a hash, never a number

OPS §8: three per phone number per day, and *"it uses a **hashed** identifier (§5.4), not the raw phone number, so the rate-limit store itself doesn't become another place personal data sits in plaintext."*

`feedback.guest_hash` is that column. Two things must be tested rather than assumed: that the raw number appears nowhere in the row (assert on the stored values, not on the writer), and that the fourth submission in a day is refused while the first of the next day is not — which means the window is computed against `ctx.clock`, not `now()`.

**A guest submits feedback**, so this is the one write in the system open to an unauthenticated caller. It has no `TenantContext` actor.

### 3.4 An announcement expires on read, never by a job

G5, and the same rule `loans_current` and `copies_borrowable` already follow: `expires_at` is compared against `olibra_now()` in the query. The test advances a `fixedClock` and asserts an announcement drops out of the reader-facing list **with no write and nothing having run** — the shape `tests/db/sql-clock.test.ts` established and D1's sweep test reuses.

### 3.5 `ReceiveDonation` changes only the donation's status

Master §7.3, and it is the decision most likely to be "improved" later: it writes **no book row and no copy row**. Cataloguing what arrived is a separate, manager-typed `CreateBook`/`AddCopies` with the donor pre-filled — because a bag of books is not a catalogue entry, and only a person holding them knows what they are.

A test asserts no `books` or `book_copies` row appears, so a future convenience that "just creates the book too" fails rather than quietly inventing catalogue data.

### 3.6 Every rejection that requires a reason trims it

`DeclineDonation` fails `reason_required` with no note — matching `RejectComment`, `RejectMembership` and `voidLoan`. The database constraint catches null; the command catches whitespace, for the reason `voidLoan` records: a reason of three spaces is the same as no reason, and the constraint would surface as a `23514` rather than as OPS's sentence.

## 4. Standards

Falsify every guard. Timestamps from `ctx.clock`. Every new audit action needs its sentence in `audit-actions.ts` — P1 made that map the type, so an uncovered action will not compile. Every new notification kind likewise in `notifications/kinds.ts`, and **`ApproveComment` is the one command in this slice OPS §7 names as writing one** (`Bình luận được duyệt`), which means `tests/architecture/notifications-are-reader-facing.test.ts`'s table gains a row.

No invented Vietnamese: copy comes from OPERATIONS.md or `ERROR_MESSAGES`. Check for OPS sentence collisions before adding a code — four slices have each had to split one.

## 5. Acceptance

- [ ] INV-9's named test, asserted through the query rather than by filtering
- [ ] A `<script>` body round-trips as literal text
- [ ] Feedback stores a hash and no raw number; the fourth in a day is refused and the next day's first is not
- [ ] An expired announcement drops out on a clock advance, with no write
- [ ] `ReceiveDonation` writes no book and no copy
- [ ] `DeclineDonation` refuses a blank reason
- [ ] `ApproveComment` notifies the comment's author and nobody else
- [ ] `bun run check` green, **CI green on the PR**

## 6. Out of scope

The screens (`quan-ly/binh-luan`, `quan-ly/thong-bao`, `quan-ly/tang-sach`, `tu-sach/[shelf]/gop-y`, `toi/tang-sach` and the rest are among the ~28 pages still on fixtures); B4 administration; D2 statistics.
