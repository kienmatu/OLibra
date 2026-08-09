# P1 · The audit browser and CSV export

**Blocked by:** U3 (merged). **Blocks:** nothing. **This is the last of Phase 1.**

---

## 1. Reconciliation, before anything else

Every plan in this project has gone stale and every reconciliation pass has found something — C1's found 14, one of which would have survived a naive fix; U3's found a paging defect already shipped in a query the plan only warned *new* queries about. Verify against `main` at `f000c19` and write the results into this document as a `## Reconciliation against shipped code` table (`docs/superpowers/plans/2026-08-08-b5-object-storage.md` §2 is the shape).

Verify at least:

- **Every audit action name actually written**, discovered from the code rather than from any list. `runCommand` makes a command *return* its audit entry, so the set is enumerable — find where, and how reliably.
- `src/domain/kernel/audit.ts` — the entry shape, `before`/`after`, `toRow`, and the FORBIDDEN token list that throws `audit_forbidden_field`.
- `audit_log`'s real columns (`before`/`after`, **not** `*_values` — C1's reconciliation had to correct exactly that).
- Whether any query reads `audit_log` today.
- `src/lib/page-data.ts`'s seam, U3's `src/lib/roles.ts` / `membership-status.ts` / `profile-labels.ts` — label maps already exist and must not be duplicated.

## 2. What this slice is

Two surfaces, both about *looking at what happened*:

- **The shelf's audit browser** (`quan-ly/nhat-ky`), OPS §3.3's `GetAuditLog`, filterable by actor, action type and date range.
- **Three CSV exports** — books, readers, loans. OPS §3.3 calls them "data-export insurance (§2)".

BR §14's last line is a requirement, not a nicety: *"Answering 'what has manager A been doing' is a headline requirement and must be fast."*

## 3. Decisions

### 3.1 The Vietnamese sentence is owned by the domain, and the mapping must be total by test

BR §14: *"The audit browser renders each entry as a readable Vietnamese sentence — 'Quản lý Maria Lan đã cho Giuse Minh mượn *Dế Mèn Phiêu Lưu Ký* lúc 14:32 ngày 03/08' — with the raw before/after values available on expansion."*

`errors.ts:11-16` already settled where copy like this lives: *"a screen calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it did not define."* The same holds here. The sentence is a fact about a domain event, not a presentation choice.

**The guard that matters: an audit action with no sentence must never render its raw action name.** `loan.created` on a volunteer's screen is a failure, not a fallback. So:

- the mapping is exhaustive over the action names **discovered from the shipped commands**, not over a hand-maintained list — a hand-maintained list beside a transition graph is exactly what let a suspended reader clear their own suspension in B2a;
- a test fails when a command writes an action the mapping does not cover;
- and the type system should make an uncovered action a compile error if that is achievable, because a test that runs after the fact is the weaker of the two.

### 3.2 Raw before/after is behind an expansion, and it is the *stored* value

BR §14 is precise: readable by default, raw *"for when something is genuinely being investigated"*. Render the sentence; put `before`/`after` behind a `<details>`.

Show what is stored, not a re-derivation. The point of an audit trail is that it says what was recorded at the time — a screen that recomputes a label from today's data would quietly rewrite history when a category is renamed.

**Nothing in the payload is secret** — `audit.ts` throws `audit_forbidden_field` rather than trusting the caller. Verify that guard actually covers what this screen will render, rather than assuming it.

### 3.3 CSV has two traps, and both are specific to this audience

**Excel and Vietnamese.** A UTF-8 CSV opened by double-click in Excel on Windows renders `Đặng Thị Kim Chi` as mojibake unless the file begins with a UTF-8 BOM. The person opening this file is a volunteer with Excel, not an engineer with a text editor — the export exists as *insurance*, and insurance that reads as garbage is not insurance. Emit the BOM, and test for its bytes.

**Formula injection.** A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel and LibreOffice. Book titles, reader names and audit reasons are all free text a person typed. Neutralise it, and test with a title that starts `=`.

Neither is hypothetical and neither is caught by "the CSV parses".

### 3.4 An export streams, or it is honest about not streaming

Three exports over a few hundred books are small. Say what the limit is and where it bites, rather than discovering it — U3's lost-copies query shipped a false parity argument about being unpaged and had to be corrected.

### 3.5 A CSV of children is a disclosure surface

`ExportReadersCSV` puts every child's name, date of birth, parents' names and phone number into a file that leaves the system. It is `manager`-gated and BR §2 authorises it, so this is not a reason to refuse — it *is* a reason to (a) make the gate provable by test, (b) put nothing in it that BR §16.1 does not already show a manager on screen, and (c) not put it in a URL a shared parish phone keeps in its address bar.

## 4. Tasks

**1 — Reconciliation, written into this document.**

**2 — `GetAuditLog`** with its filters, plus the sentence mapping and its totality guard.

**3 — `quan-ly/nhat-ky`**, following U3's worked pages.

**4 — The three exports**, with BOM and injection handled, and the download route or action they come back through.

**5 — Verify in a browser.** Download all three, **open them and look at the diacritics** — do not verify a CSV by reading the code that generated it.

## 5. Acceptance

- [ ] Every audit action a shipped command writes renders as a Vietnamese sentence; a new action with no sentence fails a test (or does not compile)
- [ ] Raw before/after is available on expansion and is the stored value, not a re-derivation
- [ ] "What has manager A been doing" is answerable by a filter and is fast — say what makes it fast
- [ ] Each CSV opens in a spreadsheet with Vietnamese intact — verified by opening one, not by reading the writer
- [ ] A title beginning `=` does not become a formula
- [ ] A reader cannot reach the audit browser or any export; a manager of shelf A cannot export shelf B
- [ ] `bun run check` and `bun run check:links` green, and **CI green on the PR**

## 6. Out of scope

The cross-shelf audit browser and everything else under `/quan-tri/*` (B4, Phase 3); statistics (D2); comments, announcements and donations (B3); borrow requests (C2); notifications (D1).
