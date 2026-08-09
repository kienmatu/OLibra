"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: `tests/lib/lending-actions.test.ts`
// imports this module and Vitest resolves no alias. The distinction these three
// functions are built around — a refusal is a sentence, a fault still throws —
// is only worth writing down if it is the *shipped* function a test can reach.
import { RuleViolated, ValidationFailed } from "../../../../domain/kernel/errors";
import { createBook } from "../../../../domain/catalogue/commands/create-book";
import { markCopyFound } from "../../../../domain/catalogue/commands/mark-copy-found";
import { reportCopyLost } from "../../../../domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "../../../../domain/catalogue/commands/retire-copy";
import { lendCopy } from "../../../../domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../../domain/circulation/commands/receive-return";
import { approveMembership } from "../../../../domain/members/commands/approve-membership";
import { approveProfileChange } from "../../../../domain/members/commands/approve-profile-change";
import { registerMemberOnBehalf } from "../../../../domain/members/commands/register-member-on-behalf";
import { rejectMembership } from "../../../../domain/members/commands/reject-membership";
import { rejectProfileChange } from "../../../../domain/members/commands/reject-profile-change";
import type { CopyCondition } from "../../../../domain/catalogue/policy";
import type { Command } from "../../../../domain/kernel/unit-of-work";
import { decideAndDiscardAvatar } from "../../../../lib/avatar";
import { submitCommand } from "../../../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../../../lib/search-params";

/**
 * Every button on the manager's surface that writes something — the three
 * confirm buttons of the circulation flows (U1), and U3 wave 2's eight: approve
 * and reject a registration, approve and reject a profile change, create a
 * book, register a reader on somebody's behalf, mark a copy found, retire one.
 *
 * **The one distinction worth the whole file: a `RuleViolated` is an answer, a
 * fault is a fault.**
 *
 * Every command in `domain/circulation/` refuses by throwing
 * `RuleViolated(code)`, where `code` is an `ErrorCode` whose Vietnamese
 * sentence lives in `errors.ts` and whose failure mode is listed under OPS
 * §4.2. Those are the sentences BR §16.3 wants beside the confirm button, and
 * they are OPERATIONS.md's own wording rather than anything BR spells out:
 * "Bạn đọc đã mượn tối đa số sách cho phép." is OPERATIONS.md:234 under
 * `LendCopy`, paired with its code at `errors.ts:59`, and it tells a volunteer
 * what to do next. So each action catches `RuleViolated`, and *only*
 * `RuleViolated`, and redirects back to the form with the code in `?loi=`.
 *
 * Everything else is rethrown. The tempting implementation is
 * `catch (e) { return { error: messageFor(...) } }`, and it is wrong in a way
 * nobody notices until it matters: a `PostgresError` from a database that is
 * down, a `ValidationFailed` for a condition grade this form cannot submit, a
 * `NotWired` from a boot sequence that skipped a setter — every one of them
 * would be rendered to a volunteer as "your input was wrong". U1 §3.3 calls
 * this "the one worth a test", and `tests/lib/lending-actions.test.ts` is it.
 *
 * **The one exception, and it is one function rather than a wider `catch`.**
 * `registerReaderOnBehalfAction` uses `attemptTyped` below, which also catches
 * `ValidationFailed`. A registration form is the one screen here where a
 * `ValidationFailed` is a *normal* outcome rather than a fault dressed as an
 * answer: a volunteer typing a child's details can produce
 * `required_fields_missing` or a date `::date` would misread, and both are
 * things they did and can undo. `toi/ho-so/actions.ts` made the same call for
 * the avatar upload and gives the long version. What it does **not** catch,
 * where that file does, is `NotWired` — see `registerReaderOnBehalfAction`.
 *
 * **A rejection's missing reason is checked here, not caught from there.** Four
 * commands in this file raise `ValidationFailed` for a blank reason
 * (`reject_reason_required`, `retire_reason_required`), and `complete()` below
 * already establishes that a field the surface left empty is the surface's own
 * doing. So each of those actions checks its own reason and returns the
 * command's own code, which keeps "anything that is not a `RuleViolated` keeps
 * throwing" literally true for them — and means the command's `ValidationFailed`
 * is unreachable from a form and stays loud if it ever fires anyway. The
 * sentence is still the domain's; `messageFor` looks it up.
 *
 * A `NotFound` is the exception, and it never reaches this file: OPS §2 gives
 * "not found" its own shape and its own answer — a 404 page — and
 * `submitCommand` makes it one. See its docstring for why
 * `write_target_not_found` is excluded from that.
 *
 * **No `requireManager` here, and none in the pages either.** All three
 * commands open with it (and `lendCopy` and `receiveReturn` with
 * `requireIdentifiedActor` besides), inside the transaction that does the
 * write. A second copy in this file would be a second definition of who may
 * lend a book, and the two would eventually disagree — U1 §3.4: the page
 * decides visibility, the domain decides permission. A refusal from those
 * guards is a `RuleViolated("not_permitted")` like any other, so it comes back
 * as "Bạn không có quyền thực hiện việc này." rather than as a crash.
 *
 * **`redirect()` is called outside every `try`.** It signals by throwing, so a
 * `catch` wrapped around it would mistake a successful redirect for a failed
 * command — the same structure, and the same comment, as
 * `dang-nhap/actions.ts`, which learned it first.
 */

/** `/tu-sach/<slug>/quan-ly`, from a slug that came in on the form. */
function managerBase(shelfSlug: string): string {
  return `/tu-sach/${encodeURIComponent(shelfSlug)}/quan-ly`;
}

/**
 * Runs one command and reports whether a business rule refused it.
 *
 * The `try` wraps the command and nothing else, so the `redirect()` each
 * caller performs afterwards cannot be swallowed by it.
 */
async function attempt<I, O>(
  shelfSlug: string,
  command: Command<I, O>,
  input: I,
): Promise<{ ok: true; result: O } | { ok: false; code: string }> {
  try {
    return { ok: true, result: await submitCommand(shelfSlug, command, input) };
  } catch (err) {
    // Matched on the class, and then on nothing else. Every `ErrorCode` a
    // command throws this way has a sentence in `ERROR_MESSAGES`, so the page
    // can render whichever one arrives without this file knowing the list —
    // which is what stops it from going stale when C2 adds a refusal.
    if (err instanceof RuleViolated) return { ok: false, code: err.code };
    throw err;
  }
}

/**
 * `attempt`, widened to `ValidationFailed` — for the one form where malformed
 * input is a volunteer's ordinary mistake rather than a fault.
 *
 * Kept as a second function rather than as a flag on `attempt`, so that the
 * narrow catch stays the default and a new action has to *choose* the wider one
 * and say why. `toi/ho-so/actions.ts` reached the same shape from the other
 * direction and its docstring holds the general argument.
 */
async function attemptTyped<I, O>(
  shelfSlug: string,
  command: Command<I, O>,
  input: I,
): Promise<{ ok: true; result: O } | { ok: false; code: string }> {
  try {
    return { ok: true, result: await submitCommand(shelfSlug, command, input) };
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return { ok: false, code: err.code };
    }
    throw err;
  }
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/** An optional text field: what the person typed, or `null` for an empty box. */
function optional(form: FormData, name: string): string | null {
  const value = field(form, name);
  return value === "" ? null : value;
}

/**
 * A whole number typed into a `type="number"` box, or `null` for anything else.
 *
 * `Number.parseInt` alone answers `12` for `"12abc"` and `NaN` for `""`, and
 * `NaN` reaching `createBook`'s `Number.isInteger` check comes back as
 * `copy_count_invalid` — the right refusal by accident. This is the same guard
 * `pageNumber` in `src/lib/search-params.ts` applies to `?trang=`, for the same
 * reason: `Number.isSafeInteger` also refuses `1e21`, which would otherwise
 * reach Postgres in exponential notation.
 */
function wholeNumber(form: FormData, name: string): number | null {
  const raw = field(form, name);
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Whether every id this command needs actually arrived.
 *
 * **The case:** `xac-nhan` renders `value={copy?.copyId ?? ""}` and disables
 * the confirm button when there is no copy to hand over. Remove the `disabled`
 * attribute in a browser's inspector and the form posts `ban=""`, which reaches
 * Postgres as a failed `uuid` cast and comes back a raw `22P02` — a bare 500,
 * which OPS §2 forbids, for a form this application itself rendered incomplete.
 *
 * **The line drawn, and it is a decision rather than an oversight:** this
 * checks *presence*, not shape. A field the surface left empty is the surface's
 * own doing and must never travel to the database; a field carrying a
 * well-formed-looking non-uuid is somebody rewriting the request by hand, and
 * the honest answer to that is the fault the database raises. That distinction
 * is also what keeps `tests/lib/lending-actions.test.ts`'s "a fault is not
 * swallowed into a friendly refusal" load-bearing — a `22P02` is its only
 * vehicle, and turning every malformed id into a friendly sentence would
 * disarm the one guard U1 §3.3 calls "the one worth a test".
 *
 * `readerFromParam` (`src/lib/lending.ts`) does check the shape, and the two
 * are not in disagreement: it guards a **GET a volunteer can reach from a stale
 * bookmark or a pasted link**, where a 500 is a dead end with no author. This
 * guards a **POST that only this app's own forms produce**.
 *
 * `validation_failed` — "Vui lòng kiểm tra lại thông tin." — rather than a
 * per-field code, because the action cannot know *why* the field is empty. Only
 * the screen knows that, and it is already showing the reason: BR §16.3's
 * blocking message sits directly above the button, in the copy's or the
 * reader's own words.
 */
function complete(form: FormData, names: string[]): boolean {
  return names.every((name) => field(form, name) !== "");
}

/** What `complete` returning false comes back as — `attempt`'s refusal shape. */
const INCOMPLETE = { ok: false, code: "validation_failed" } as const;

/**
 * OPS §4.2's `LendCopy` — step 3 of quick-lend, and the two-step entry from a
 * book's detail page.
 *
 * `copyId` and `membershipId` arrive as hidden fields the confirm page put
 * there from rows it had just read through manager-gated queries. Neither is
 * trusted on that account: `lendCopy` re-reads both inside its transaction and
 * re-applies `copyLendable` and `memberMayBorrow` (OPS §5 — "the command
 * re-checks anyway, because the data can go stale in the seconds between").
 */
export async function lendCopyAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["ban", "nguoi-doc"])
    ? await attempt(shelfSlug, lendCopy, {
        copyId: field(form, "ban"),
        membershipId: field(form, "nguoi-doc"),
      })
    : INCOMPLETE;

  const base = managerBase(shelfSlug);
  if (!outcome.ok) {
    // Back to the confirm screen the volunteer is looking at, with both
    // choices intact — retyping a reader's name to read a refusal would be
    // the same discourtesy `dang-nhap/actions.ts` fixed by keeping `?ten=`.
    const params = new URLSearchParams({
      sach: field(form, "sach"),
      "nguoi-doc": field(form, "nguoi-doc"),
      [ACTION_ERROR_PARAM]: outcome.code,
    });
    redirect(`${base}/cho-muon/xac-nhan?${params.toString()}`);
  }

  redirect(base);
}

/**
 * OPS §4.2's `ReceiveReturn` — the return flow's terminal step.
 *
 * `holdForRequestId` is deliberately never sent. OPS §5 makes the queued-reader
 * decision a second, explicit choice by the manager, and the panel offering it
 * needs `GetBorrowRequestQueue` (OPS §3.3), which no slice has shipped. An
 * un-offered choice is honest; a choice made silently on the manager's behalf
 * is the thing §5 says must never happen.
 *
 * `condition` is passed through as it arrives. `receiveReturn` validates it
 * against the `copy_condition` enum itself and throws `ValidationFailed` for
 * anything else — not a `RuleViolated`, so it stays loud. The form can only
 * ever submit one of the six.
 */
export async function receiveReturnAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const note = field(form, "ghi-chu");
  const outcome = complete(form, ["muon", "tinh-trang"])
    ? await attempt(shelfSlug, receiveReturn, {
        loanId: field(form, "muon"),
        condition: field(form, "tinh-trang") as CopyCondition,
        // An empty textarea is no note, not a note that says nothing —
        // `condition_assessments.note` is nullable and a blank string would
        // read, a year later, as a manager who wrote something illegible.
        note: note === "" ? null : note,
      })
    : INCOMPLETE;

  const base = managerBase(shelfSlug);
  if (!outcome.ok) {
    const params = new URLSearchParams({
      q: field(form, "q"),
      muon: field(form, "muon"),
      [ACTION_ERROR_PARAM]: outcome.code,
    });
    redirect(`${base}/nhan-tra?${params.toString()}`);
  }

  redirect(base);
}

/**
 * OPS §4.1's `ReportCopyLost`, reached from the "Bạn đọc báo làm mất" branch of
 * step 2 of the return flow.
 *
 * **Not a variant of `ReceiveReturn`, and not a seventh condition.** OPS §4.2
 * is explicit: choosing it "does not call `ReceiveReturn` at all — it switches
 * to `ReportCopyLost` with the loan's copy already identified, and the loan
 * closes as `lost` rather than `returned`." The command closes the active loan
 * itself, which is why only the copy is sent.
 */
export async function reportCopyLostAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const note = field(form, "ghi-chu");
  const outcome = complete(form, ["ban"])
    ? await attempt(shelfSlug, reportCopyLost, {
        copyId: field(form, "ban"),
        // BR §5.4 gives BookCopy no lost-note column, so this reaches the audit
        // entry and nowhere else — see `reportCopyLost`'s own docstring.
        note: note === "" ? null : note,
      })
    : INCOMPLETE;

  const base = managerBase(shelfSlug);
  if (!outcome.ok) {
    const params = new URLSearchParams({
      q: field(form, "q"),
      muon: field(form, "muon"),
      [ACTION_ERROR_PARAM]: outcome.code,
    });
    redirect(`${base}/nhan-tra/bao-mat?${params.toString()}`);
  }

  redirect(base);
}

/**
 * Where a decision on this queue lands, whichever way it went.
 *
 * Back to the queue, never to the dashboard: the manager is working through a
 * stack of cards, and BR §16.3 describes exactly that ("a review card per
 * application"). A refusal carries its code; a success carries nothing, and the
 * card is simply gone from the list because the queue query only returns
 * `pending` rows.
 */
function backToQueue(
  base: string,
  queue: string,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  const suffix = outcome.ok ? "" : `?${ACTION_ERROR_PARAM}=${outcome.code}`;
  redirect(`${base}/${queue}${suffix}`);
}

/**
 * What a reject action returns when its reason box was left empty — the
 * command's own code, so the sentence a volunteer reads is `errors.ts`'s
 * ("Vui lòng ghi lý do từ chối.") rather than a second wording invented here.
 *
 * See this file's header for why the check is on this side of the call at all.
 */
const NO_REJECT_REASON = { ok: false, code: "reject_reason_required" } as const;

/**
 * OPS §4.3's `ApproveMembership` — `pending → active`, the **Duyệt đăng ký**
 * button on BR §16.3's review card.
 *
 * BR §4's assumption 3 makes this the consent step for holding a minor's data,
 * which is why `RegisterMemberOnBehalf` below deliberately cannot skip it.
 */
export async function approveMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["thanh-vien"])
    ? await attempt(shelfSlug, approveMembership, {
        membershipId: field(form, "thanh-vien"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "dang-ky-cho-duyet", outcome);
}

/**
 * OPS §4.3's `RejectMembership` — `pending → rejected`, with the reason BR §2
 * requires so the person may re-apply. Nothing is deleted (G10).
 */
export async function rejectMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["thanh-vien"])
    ? INCOMPLETE
    : reason === ""
      ? NO_REJECT_REASON
      : await attempt(shelfSlug, rejectMembership, {
          membershipId: field(form, "thanh-vien"),
          reason,
        });

  backToQueue(managerBase(shelfSlug), "dang-ky-cho-duyet", outcome);
}

/**
 * OPS §4.3's `ApproveProfileChange` — the proposed values are written to the
 * person in the same transaction as the audit record (BR §7.4's diagram).
 *
 * **Routed through `decideAndDiscardAvatar`, not `submitCommand`.** Approving a
 * new photograph makes the old one unreferenced, and an unreferenced avatar goes
 * on answering 200 from a public bucket until something deletes it — a retention
 * problem rather than a storage one, because the readers here are children.
 * `src/lib/avatar.ts` owns the ordering (delete strictly after the commit) and
 * that is why the composition lives there rather than being spelled out here.
 * All three decisions in this lifecycle return the same `avatarObject` field for
 * exactly this reason.
 *
 * **No parish units are sent.** `ApproveProfileChange` accepts
 * `parishUnitL1Id`/`parishUnitL2Id` so a manager may correct the placement in
 * the same action, and *omitting* both is what leaves it alone (the command
 * branches on `!== undefined`). Offering that control means a second form on the
 * card and a second decision at the moment a manager is deciding something else;
 * BR §16.3 asks this screen for "Approve and Reject" and nothing more, and
 * `quan-ly/nguoi-doc/[id]` is where a placement is edited. Recorded because
 * sending an empty string here instead would silently *clear* both units.
 */
export async function approveProfileChangeAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["yeu-cau"])
    ? await attemptDiscardingAvatar(shelfSlug, approveProfileChange, {
        profileChangeRequestId: field(form, "yeu-cau"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "doi-thong-tin", outcome);
}

/**
 * OPS §4.3's `RejectProfileChange` — the existing values are untouched, because
 * `ProposeProfileChange` never wrote them. The reason is required and the reader
 * sees it (BR §16.3).
 *
 * Also through `decideAndDiscardAvatar`: here the orphan is the *proposed*
 * image, which nothing points at once the request is refused. OPS §4.3 requires
 * that "a rejected or cancelled proposal's image is deleted rather than left
 * orphaned in storage".
 */
export async function rejectProfileChangeAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["yeu-cau"])
    ? INCOMPLETE
    : reason === ""
      ? NO_REJECT_REASON
      : await attemptDiscardingAvatar(shelfSlug, rejectProfileChange, {
          profileChangeRequestId: field(form, "yeu-cau"),
          reason,
        });

  backToQueue(managerBase(shelfSlug), "doi-thong-tin", outcome);
}

/**
 * `attempt`, for the two commands whose result names a photograph to delete.
 *
 * The `try` still wraps one call and nothing else, and that call is
 * `decideAndDiscardAvatar` rather than `submitCommand` — so the delete is inside
 * the guarded region and a storage fault propagates as a fault, exactly like a
 * `PostgresError`. It is not a refusal a volunteer can act on, and dressing it
 * as one would tell them their decision failed when the decision committed.
 */
async function attemptDiscardingAvatar<I>(
  shelfSlug: string,
  command: Command<I, { avatarObject: string | null }>,
  input: I,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await decideAndDiscardAvatar(shelfSlug, command, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof RuleViolated) return { ok: false, code: err.code };
    throw err;
  }
}

/**
 * OPS §4.1's `CreateBook` — the title and its first copies in one transaction,
 * because OPS §1 is explicit that "a book with zero copies is not yet
 * meaningfully catalogued".
 *
 * **Lands on the list rather than on the new book.** `createBook` returns
 * `{ bookId, copyIds }` and not the slug it disambiguated, so this cannot build
 * the book's own URL without a second read; the list's default sort is
 * `created_at desc`, so the new title is the first row. Naming the shape of the
 * gap rather than adding a lookup: widening the command's result is a domain
 * change, and it is a small one that belongs to whoever next needs it.
 *
 * `so-ban` reaches the command as whatever whole number arrived, or `-1` for a
 * box that held something else — `copy_count_invalid` ("Số bản phải lớn hơn 0.")
 * is the command's own answer to both, and re-deriving that refusal here would
 * be a second copy of a rule the command already owns.
 */
export async function createBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = await attemptTyped(shelfSlug, createBook, {
    title: field(form, "ten-sach"),
    author: field(form, "tac-gia"),
    categorySlug: field(form, "the-loai"),
    publisher: optional(form, "nxb"),
    publishedYear: wholeNumber(form, "nam-xb"),
    pageCount: wholeNumber(form, "so-trang"),
    isbn: optional(form, "isbn"),
    description: optional(form, "mo-ta"),
    // An unchecked checkbox posts nothing at all, which is what makes this the
    // right way round: "Hiện sách này cho bạn đọc" checked means published.
    published: form.get("hien-thi") !== null,
    copyCount: wholeNumber(form, "so-ban") ?? -1,
    donorMembershipId: optional(form, "donorMembershipId"),
    donorName: optional(form, "donorName"),
    acquiredOn: optional(form, "acquiredOn"),
  });

  const base = managerBase(shelfSlug);
  if (!outcome.ok) {
    redirect(`${base}/sach/moi?${ACTION_ERROR_PARAM}=${outcome.code}`);
  }
  redirect(`${base}/sach`);
}

/**
 * OPS §4.3's `RegisterMemberOnBehalf` — BR §16.1's "a manager can also complete
 * this form on behalf of a child standing in front of them, which is the common
 * case for the youngest readers."
 *
 * **`registerMemberOnBehalf`, not `managerRegisterReader`, and not
 * `registerMembership`.** The plan named the third, which is the *guest's own*
 * registration and carries no manager gate at all — posting a screen behind
 * `requireManager` to it would have been posting to a command that has none. Of
 * the two that remain, BR §16.1 settles which belongs here in one sentence:
 * "Registering on behalf still creates a pending application rather than an
 * active member, so the approval step and its audit record are never skipped."
 * This page's own shipped copy already promises that — "Hồ sơ này vẫn vào hàng
 * chờ duyệt, kể cả khi bạn là người điền", above a button reading "Tạo hồ sơ chờ
 * duyệt". `managerRegisterReader` creates an `active` membership and is BR
 * §16.3's quick-lend escape hatch, which lives on `quan-ly/cho-muon/nguoi-doc`
 * and is a different screen for a different moment (mid-lend, with a book in
 * hand). The two commands "disagree about `pending` on purpose", as their own
 * docstrings put it.
 *
 * **Nothing the volunteer typed comes back on a refusal, and that is deliberate
 * rather than lazy.** Every other form in this file carries its state in the
 * query string so a refusal does not lose it. The fields here are a child's date
 * of birth, their parents' names and a family telephone number — BR §5.3's
 * manager-only facts — and a query string is written into browser history, into
 * a proxy's access log and into the address bar of a shared parish phone. The
 * form is re-typed instead. The alternative is a real cost, named here rather
 * than left to be discovered.
 *
 * **It lands on the approval queue**, not on the readers list: the application
 * this just created is `pending`, so the readers list's default view is exactly
 * where it is not, and the queue is where a manager finishes the job.
 */
export async function registerReaderOnBehalfAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = await attemptTyped(shelfSlug, registerMemberOnBehalf, {
    saintName: optional(form, "ten-thanh"),
    fullName: field(form, "ho-ten"),
    dateOfBirth: field(form, "ngay-sinh"),
    fatherName: field(form, "ten-cha"),
    motherName: field(form, "ten-me"),
    phone: field(form, "dien-thoai"),
    // `ParishUnitFields` posts these names, and posts "" for "— Không chọn —".
    parishUnitL1Id: optional(form, "parishUnitL1Id"),
    parishUnitL2Id: optional(form, "parishUnitL2Id"),
  });

  const base = managerBase(shelfSlug);
  if (!outcome.ok) {
    redirect(`${base}/nguoi-doc/moi?${ACTION_ERROR_PARAM}=${outcome.code}`);
  }
  redirect(`${base}/dang-ky-cho-duyet`);
}

/**
 * OPS §4.1's `MarkCopyFound` — BR §7.1's `lost → available`, and the whole
 * reason the lost-copies screen exists: **"Báo mất" appears in three places in
 * the built interface, and marking a copy found appears in none of them**
 * (BR:559, quoted as written — `sach/mat/page.tsx:29` and
 * `lost-copies.test.ts:121` quote the same sentence and this one used to
 * paraphrase it inside quotation marks).
 *
 * The loan is not reopened; the command's own docstring gives BR §7.3's reason.
 */
export async function markCopyFoundAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["ban"])
    ? await attempt(shelfSlug, markCopyFound, { copyId: field(form, "ban") })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "sach/mat", outcome);
}

/**
 * OPS §4.1's `RetireCopy` — BR §7.1's other exit from `lost`, for a copy a shelf
 * knows is not coming back. The reason is required by
 * `book_copies_retired_has_reason` as well as by the catalogue.
 */
export async function retireCopyAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["ban"])
    ? INCOMPLETE
    : reason === ""
      ? // The command's own code for this, which has its own sentence: *huỷ* in
        // `reason_required` is cancelling something, not taking a book off the
        // shelf for good.
        ({ ok: false, code: "retire_reason_required" } as const)
      : await attempt(shelfSlug, retireCopy, {
          copyId: field(form, "ban"),
          reason,
        });

  backToQueue(managerBase(shelfSlug), "sach/mat", outcome);
}
