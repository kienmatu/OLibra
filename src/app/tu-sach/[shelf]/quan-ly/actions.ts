"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "@/domain/kernel/errors";
import {
  createAnnouncement,
  hideAnnouncement,
  pinAnnouncement,
  publishAnnouncement,
  unpinAnnouncement,
  updateAnnouncement,
} from "@/domain/community/commands/announcements";
import {
  approveComment,
  hideComment,
  rejectComment,
} from "@/domain/community/commands/comment-moderation";
import {
  declineDonation,
  receiveDonation,
} from "@/domain/community/commands/donations";
import { addCopies } from "@/domain/catalogue/commands/add-copies";
import { assessCondition } from "@/domain/catalogue/commands/assess-condition";
import { createBook } from "@/domain/catalogue/commands/create-book";
import { markCopyFound } from "@/domain/catalogue/commands/mark-copy-found";
import { reportCopyLost } from "@/domain/catalogue/commands/report-copy-lost";
import { retireCopy } from "@/domain/catalogue/commands/retire-copy";
import { updateBook } from "@/domain/catalogue/commands/update-book";
import { approveBorrowRequest } from "@/domain/circulation/commands/approve-borrow-request";
import { handoverRequest } from "@/domain/circulation/commands/handover-request";
import { lendCopy } from "@/domain/circulation/commands/lend-copy";
import { receiveReturn } from "@/domain/circulation/commands/receive-return";
import { rejectBorrowRequest } from "@/domain/circulation/commands/reject-borrow-request";
import { approveMembership } from "@/domain/members/commands/approve-membership";
import { approveProfileChange } from "@/domain/members/commands/approve-profile-change";
import { createParishUnit } from "@/domain/members/commands/create-parish-unit";
import { deleteParishUnit } from "@/domain/members/commands/delete-parish-unit";
import { markMembershipLeft } from "@/domain/members/commands/mark-membership-left";
import { reactivateMembership } from "@/domain/members/commands/reactivate-membership";
import { registerMemberOnBehalf } from "@/domain/members/commands/register-member-on-behalf";
import { rejectMembership } from "@/domain/members/commands/reject-membership";
import { rejectProfileChange } from "@/domain/members/commands/reject-profile-change";
import { renameParishUnit } from "@/domain/members/commands/rename-parish-unit";
import { reorderParishUnits } from "@/domain/members/commands/reorder-parish-units";
import { setReaderCredentials } from "@/domain/members/commands/set-reader-credentials";
import { suspendMembership } from "@/domain/members/commands/suspend-membership";
import { updateParishTaxonomy } from "@/domain/members/commands/update-parish-taxonomy";
import { updateReaderProfile } from "@/domain/members/commands/update-reader-profile";
import type { CopyCondition } from "@/domain/catalogue/policy";
import type { Command } from "@/domain/kernel/unit-of-work";
import { decideAndDiscardAvatar } from "@/lib/avatar";
import { submitCommand } from "@/lib/page-data";
import { ACTION_DONE_PARAM, ACTION_ERROR_PARAM } from "@/lib/search-params";

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
 * things they did and can undo. `ho-so/profile-actions.ts` made the same call for
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
 * and say why. `ho-so/profile-actions.ts` reached the same shape from the other
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
 *
 * ── The confirmation this redirects to, and what it does not name ───────────
 *
 * QA remediation Task 16: this used to `redirect(base)` on success with
 * nothing to say a lend had just happened — the dashboard it landed on was
 * the same dashboard a manager sees by tapping "Trang chính" from the menu.
 * The brief's own sentence is "Đã cho {tên} mượn {mã bản}, hạn trả {ngày}.",
 * and the middle piece is missing here on purpose.
 *
 * **The copy code and the due date travel in the query string; the reader's
 * name does not.** `mã bản` is a shelf-mark printed on the book itself
 * (`xac-nhan/page.tsx` already shows it in a `<Row>`, and prints it again in
 * "Sau khi xác nhận, bản {code} sẽ chuyển sang…") and `hạn trả` is a calendar
 * date `lendCopy`'s own result carries — neither identifies a person. A
 * borrower's name does, and this branch (`2fb0ee8`) reverted exactly that
 * mistake for two other forms in the same session it was made in: a child's
 * date of birth, both parents' names and a phone number, carried back through
 * a query string, are a permanent leak on a shared parish phone via browser
 * history and a proxy's access log. `lendCopy`'s own result never carried a
 * name to begin with (`LendCopyResult` is `{ loanId, dueOn }`), and adding a
 * lookup keyed on `loanId` just to put a name in a *courtesy* sentence would
 * be reaching for the same shape of risk through a side door — a request for
 * "the reader's name" is a request for the reader's name, whether it arrives
 * by parameter or by a fetch this action triggers.
 *
 * **So the sentence names no one, and that is a real precedent rather than an
 * improvisation.** `domain/kernel/audit-actions.ts`'s own `loan.created`
 * phrase already has exactly this fallback — `f.subject ? "cho ${f.subject}
 * mượn …" : "cho mượn …"` — for the one case *it* has no name to put in a
 * sentence (an audit row whose actor is the system). The notice below is that
 * same shape, chosen for the reason stated above rather than copied
 * uncritically: BR §14's audit trail is read by a manager who is already
 * signed in to a permissioned screen built to name people; a URL is read by
 * whoever picks up the phone next.
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

  const params = new URLSearchParams({
    [ACTION_DONE_PARAM]: "cho-muon",
    "ma-ban": field(form, "ma-ban"),
    han: outcome.result.dueOn,
  });
  redirect(`${base}?${params.toString()}`);
}

/**
 * OPS §4.2's `ReceiveReturn` — the return flow's terminal step.
 *
 * **`holdForRequestId` is sent only when the manager chose to send it** (C2).
 * It was never sent at all until this slice, because the panel offering the
 * choice needs `GetBorrowRequestQueue` (OPS §3.3) and no slice had shipped it.
 * Now the return screen shows who is waiting and offers "Giữ chỗ cho …" beside
 * "Không giữ chỗ, trả về kệ" — a radio group whose default is *not* holding, so
 * a manager who taps straight through makes the choice §5 describes rather than
 * having one made for them. An empty value becomes `undefined` rather than
 * `""` — belt-and-braces, and said to be that rather than presented as the
 * guard: `receiveReturn` branches on the truthiness of `holdForRequestId`, so
 * an empty string never reaches `resolveHold` either way. Measured, by swapping
 * `optional` for `field` and watching the suite stay green.
 *
 * The `complete()` guard below deliberately does not list it. It is optional by
 * design — "no hold" is a real answer — so its absence is not an incomplete
 * form.
 *
 * `condition` is passed through as it arrives. `receiveReturn` validates it
 * against the `copy_condition` enum itself and throws `ValidationFailed` for
 * anything else — not a `RuleViolated`, so it stays loud. The form can only
 * ever submit one of the six.
 *
 * **The success redirect carries a copy code, per QA remediation Task 16.**
 * "Đã nhận lại {mã bản}." — the brief's own sentence — names no person, so
 * none of `lendCopyAction`'s reasoning above about what stays out of the URL
 * has anything to add here; the code is a shelf-mark, exactly as it is on
 * `nhan-tra/page.tsx`'s own "Sau khi xác nhận, bản {code} sẽ chuyển sang…".
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
        // "Không giữ chỗ, trả về kệ" posts the empty string, which is the
        // absence of a choice to hold and not a request id of zero length.
        holdForRequestId: optional(form, "giu-cho") ?? undefined,
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

  const params = new URLSearchParams({
    [ACTION_DONE_PARAM]: "nhan-tra",
    "ma-ban": field(form, "ma-ban"),
  });
  redirect(`${base}?${params.toString()}`);
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
 * Where a comment decision lands when it was made somewhere other than the
 * queue — today, `/quan-ly/sach/[slug]`, which shows this book's own waiting
 * comments so a manager reading the title can act on them without leaving it.
 *
 * **A slug, never a path.** The three comment actions take `sach` as an
 * optional *book slug* and this builds the URL from it; nothing a form submits
 * is ever redirected to as given. A `ve=` carrying a return path would be an
 * open redirect on a `"use server"` action reachable by anyone who can post to
 * it, and the fact that the page only ever puts its own path in it is not a
 * property of the action. A slug that names nothing lands on a 404 inside this
 * shelf's own manager area, which is the worst it can do.
 *
 * Absent means the queue, so `/quan-ly/binh-luan` is untouched: it posts no
 * `sach`, and `backToQueue`'s docstring above still describes what it gets.
 */
function afterCommentDecision(
  base: string,
  bookSlug: string,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  if (bookSlug === "") backToQueue(base, "binh-luan", outcome);
  const suffix = outcome.ok ? "" : `?${ACTION_ERROR_PARAM}=${outcome.code}`;
  redirect(`${base}/sach/${encodeURIComponent(bookSlug)}${suffix}`);
}

/**
 * Where a pin/unpin decision lands when it was made somewhere other than the
 * manager's list — today, Task 12's control on the announcement's own
 * reader-facing detail page (`/tu-sach/{slug}/thong-bao/{annSlug}`), added so
 * a manager reading a notice is not yanked into the admin console just for
 * pinning it.
 *
 * `src/lib/return-path.ts`'s `safeReturnPath` was the first thing checked for
 * this and does not fit: it is built for the pre-auth guest redirect — an
 * unauthenticated `GET` landing on `/dang-nhap`, willing to honour *any*
 * same-origin path. This is a `"use server"` action anyone can `POST` to
 * directly, which is exactly the distinction `afterCommentDecision` immediately
 * above already draws for this same file (its own docstring: "A `ve=` carrying
 * a return path would be an open redirect on a `"use server"` action reachable
 * by anyone who can post to it"). So this follows `afterCommentDecision`'s
 * shape instead of inventing a third one: **a slug, never a path** — the field
 * names which announcement to return to, not where to go, and the URL is built
 * from a closed template with exactly two shapes.
 *
 * Absent means the manager list, so its existing control (which posts no
 * `thong-bao-slug`) is untouched.
 */
function afterPinDecision(
  shelfSlug: string,
  announcementSlug: string | null,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  if (!announcementSlug) backToQueue(managerBase(shelfSlug), "thong-bao", outcome);
  const suffix = outcome.ok ? "" : `?${ACTION_ERROR_PARAM}=${outcome.code}`;
  redirect(
    `/tu-sach/${encodeURIComponent(shelfSlug)}/thong-bao/${encodeURIComponent(announcementSlug)}${suffix}`,
  );
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
 *
 * **Widened to `ValidationFailed`, post-review fix wave, item 3.** This used
 * to catch `RuleViolated` only, which was enough the day it was written —
 * `approveProfileChange` raised nothing else. It now reaches
 * `normaliseProfilePatch` on the way to writing the person record, and that
 * throws `ValidationFailed("required_fields_missing", "saint_name")` for any
 * proposal written before saint name became mandatory (§8) and blanked it,
 * which was legal when it was written. Narrow to `RuleViolated` meant that
 * threw straight past this `catch`, out of the server action, and into Next's
 * generic error page — on a request the deciding manager or super admin can
 * otherwise only *reject*, which OPS §2's "no bare 500" rule exists to
 * prevent. Same shape `attemptTyped` above already uses for the identical
 * reason.
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
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return { ok: false, code: err.code };
    }
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
 *
 * **The title, author and the rest of `BookFields` now come back on a refusal**
 * (Task 13, 2026-08-10 QA remediation) — `sach/moi/page.tsx` used to say a
 * title and an author are quick enough to retype that losing them was a small
 * cost, and that stood while this was the only long form in `quan-ly/` that lost
 * everything on a refusal. The copy-count box, the donor picker and "Hiện sách
 * này" stay out of it — each already defaults to something sensible (`so-ban`
 * to 1, the checkbox to checked), and none of `createBook`'s refusal codes
 * (`duplicate_isbn`, `category_not_found`, `copy_count_invalid`,
 * `required_fields_missing`) is caused by any of the three, so losing them back
 * to their defaults costs a manager nothing a refusal itself did not already
 * ask them to reconsider.
 *
 * **This is the one of the three Task 13 forms where the carry-back stuck.**
 * The identical fix went into `dang-ky` and `nguoi-doc/moi` in the same task
 * and was reverted from both before merge — a child's date of birth, both
 * parents' names and a family telephone number in a query string are a real
 * and permanent leak on a shared parish phone (browser history, a proxy's
 * access log), and neither of those two forms' own docstrings had ever argued
 * otherwise. Title, author, publisher, year, ISBN and description are
 * bibliographic facts about a *book*, not personal data about a child — the
 * one part of this form that names a person, the donor picker, was already
 * excluded above, before the leak in the other two forms was even found. A
 * long "Mô tả" lost to a mistyped ISBN is a real cost with no privacy
 * counterweight, which is the distinction that keeps this carry-back in place
 * while the other two came out.
 */
export async function createBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");

  // Read once, used both as `createBook`'s input and — on a refusal — as what
  // rides back in the query string. The raw, untrimmed-of-meaning strings for
  // `nam-xb`/`so-trang`, not `wholeNumber`'s parse of them: a box that held
  // "199x" should show "199x" again, not an empty one, even though `createBook`
  // itself only ever sees the parsed number or `null`.
  const title = field(form, "ten-sach");
  const author = field(form, "tac-gia");
  const categorySlug = field(form, "the-loai");
  const publisher = optional(form, "nxb");
  const publishedYearRaw = field(form, "nam-xb");
  const pageCountRaw = field(form, "so-trang");
  const isbn = optional(form, "isbn");
  const description = optional(form, "mo-ta");

  const outcome = await attemptTyped(shelfSlug, createBook, {
    title,
    author,
    categorySlug,
    publisher,
    publishedYear: wholeNumber(form, "nam-xb"),
    pageCount: wholeNumber(form, "so-trang"),
    isbn,
    description,
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
    const params = new URLSearchParams({ [ACTION_ERROR_PARAM]: outcome.code });
    for (const [name, value] of Object.entries({
      "ten-sach": title,
      "tac-gia": author,
      "the-loai": categorySlug,
      nxb: publisher,
      "nam-xb": publishedYearRaw,
      "so-trang": pageCountRaw,
      isbn,
      "mo-ta": description,
    })) {
      if (value) params.set(name, value);
    }
    redirect(`${base}/sach/moi?${params.toString()}`);
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
 * **Proposed and withdrawn once already (Task 13, 2026-08-10 QA remediation).**
 * A same-session task carried these eight fields back through this same query
 * string, reasoning from the QA sweep's observation about `/dang-ky` without
 * re-reading this paragraph first. Reverted before merge on the ground stated
 * above: the next child to pick up a shared parish phone would see the
 * previous child's mother's name and telephone number in the address bar, and
 * browser history and a proxy's access log make that permanent. If this is
 * proposed again, a short-lived same-origin cookie or `useActionState` would
 * get the UX without the leak — neither touches the URL — and it is a design
 * decision for its own task with the product owner's input, not a quick
 * change here.
 *
 * **It lands on the approval queue**, not on the readers list: the application
 * this just created is `pending`, so the readers list's default view is exactly
 * where it is not, and the queue is where a manager finishes the job.
 */
export async function registerReaderOnBehalfAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = await attemptTyped(shelfSlug, registerMemberOnBehalf, {
    saintName: field(form, "ten-thanh"),
    fullName: field(form, "ho-ten"),
    dateOfBirth: field(form, "ngay-sinh"),
    fatherName: field(form, "ten-cha"),
    motherName: field(form, "ten-me"),
    phone: field(form, "dien-thoai"),
    // PO feedback round 1, Task 8: same rule as `dang-ky/actions.ts`'s
    // `registerMembershipAction` — `register()` refuses `thieu-so-dien-thoai`
    // when this and `phone` above are both blank.
    phoneMissingReason: optional(form, "ly-do-thieu-sdt"),
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

/**
 * OPS §4.2's `ApproveBorrowRequest` — **Duyệt & giữ chỗ** on the queue screen,
 * BR §16.3's "Approve (creating a hold with a visible expiry)".
 *
 * Two ids, both hidden fields the queue page put there from rows it had just
 * read through a manager-gated query, and neither trusted on that account: the
 * command re-reads both inside its transaction, re-applies `copyHoldable`, and
 * locks the copy row so that two managers deciding at once cannot both win.
 *
 * The copy is chosen by the page, from that title's available copies, because
 * OPS §4.2 makes `copyId` an input and BR §16.3 gives the manager the choice —
 * a shelf has copies in different conditions and a volunteer standing at it
 * knows which one to put aside.
 */
export async function approveBorrowRequestAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["yeu-cau", "ban"])
    ? await attempt(shelfSlug, approveBorrowRequest, {
        requestId: field(form, "yeu-cau"),
        copyId: field(form, "ban"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "yeu-cau-muon", outcome);
}

/**
 * OPS §4.2's `RejectBorrowRequest` — **Từ chối**, `pending → rejected`.
 *
 * **No `NO_REJECT_REASON` guard, unlike the two rejections above it**, and that
 * is Q2 rather than an oversight. `RejectMembership` and `RejectProfileChange`
 * both require a reason and both screens say so ("Từ chối cần ghi lý do"); the
 * borrow queue's button carries no such statement and OPS §4.2 lists no
 * `reason_required` among this command's failure modes. The C2 plan §3.4 records
 * the reading and what reversing it costs: this guard, and a field in D1's
 * notification.
 */
export async function rejectBorrowRequestAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["yeu-cau"])
    ? await attempt(shelfSlug, rejectBorrowRequest, {
        requestId: field(form, "yeu-cau"),
        reason: optional(form, "ly-do"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "yeu-cau-muon", outcome);
}

/**
 * OPS §4.2's `HandoverRequest` — **Xác nhận trao sách**, the moment the book
 * changes hands.
 *
 * One id, because the request already names the copy and the reader. This is
 * the whole difference between it and `lendCopyAction` above, which takes both:
 * there the manager picked a book and then a reader, and here a hold made both
 * choices days ago.
 */
export async function handoverRequestAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["yeu-cau"])
    ? await attempt(shelfSlug, handoverRequest, {
        requestId: field(form, "yeu-cau"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "yeu-cau-muon", outcome);
}

// ── B3's community moderation, wired by U5 ─────────────────────────────────

/**
 * OPS §4.4's `ApproveComment` — INV-9's `pending → approved`, and the moment a
 * child's words become visible to the parish.
 */
export async function approveCommentAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["binh-luan"])
    ? await attempt(shelfSlug, approveComment, {
        commentId: field(form, "binh-luan"),
      })
    : INCOMPLETE;

  // `sach` is optional and is a *slug*, not a path — see
  // `afterCommentDecision`. The queue posts none and lands where it always did.
  afterCommentDecision(managerBase(shelfSlug), field(form, "sach"), outcome);
}

/**
 * `RejectComment`, with the reason the reader is shown.
 *
 * The empty-box check is on this side for the reason this file's header gives
 * for the other two rejects: the command's own `reject_reason_required` is what
 * a volunteer reads, so there is no second wording invented here.
 */
export async function rejectCommentAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["binh-luan"])
    ? INCOMPLETE
    : reason === ""
      ? NO_REJECT_REASON
      : await attempt(shelfSlug, rejectComment, {
          commentId: field(form, "binh-luan"),
          reason,
        });

  afterCommentDecision(managerBase(shelfSlug), field(form, "sach"), outcome);
}

/**
 * `HideComment` — for something already approved that should not have been.
 *
 * This is the button that had no way to name a comment until U5: the moderation
 * queue returns `pending` rows only, so an approved one left that list forever
 * and `hideComment` had existed since B3 with nothing able to call it.
 */
export async function hideCommentAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["binh-luan"])
    ? await attempt(shelfSlug, hideComment, {
        commentId: field(form, "binh-luan"),
      })
    : INCOMPLETE;

  afterCommentDecision(managerBase(shelfSlug), field(form, "sach"), outcome);
}

/**
 * OPS §4.4's `ReceiveDonation` — **Duyệt**.
 *
 * **It writes no book, and BR §16.3 is why the screen then goes somewhere.**
 * `receiveDonation` records that the shelf accepted the offer and stops:
 * cataloguing is a separate, manager-typed `CreateBook` with **Người tặng**
 * pre-filled, "because a bag of books is not a catalogue entry and only a person
 * holding them knows what they are". So this redirects to the add-book form
 * carrying the donor, rather than to the queue — the hand-off the command
 * deliberately does not perform itself.
 */
export async function receiveDonationAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const donor = field(form, "nguoi-tang");
  const outcome = complete(form, ["loi-tang"])
    ? await attempt(shelfSlug, receiveDonation, {
        donationId: field(form, "loi-tang"),
      })
    : INCOMPLETE;

  if (!outcome.ok) backToQueue(managerBase(shelfSlug), "tang-sach", outcome);

  const base = managerBase(shelfSlug);
  // `nguoi-tang` is a `memberships(id)` — `book_donations.donor_membership_id`,
  // the reverse of this codebase's usual actor column, and the form field is
  // named for what it carries rather than for the person.
  redirect(donor ? `${base}/sach/moi?nguoi-tang=${donor}` : `${base}/sach/moi`);
}

/** `DeclineDonation`, with the reason the reader reads on their own page. */
export async function declineDonationAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["loi-tang"])
    ? INCOMPLETE
    : reason === ""
      ? NO_REJECT_REASON
      : await attempt(shelfSlug, declineDonation, {
          donationId: field(form, "loi-tang"),
          reason,
        });

  backToQueue(managerBase(shelfSlug), "tang-sach", outcome);
}

/**
 * The five buttons on the announcements screen, and one form.
 *
 * `PublishAnnouncement` serves both **Đăng ngay** and **Đăng lại**: the command
 * refuses a second publication only when no new expiry is supplied, precisely so
 * republishing a lapsed notice goes through the same door. That is why the
 * republish form carries a `het-han` field and the first publish does not need
 * one.
 */
export async function createAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = await attemptTyped(shelfSlug, createAnnouncement, {
    title: field(form, "tieu-de"),
    body: field(form, "noi-dung"),
  });

  backToQueue(managerBase(shelfSlug), "thong-bao", outcome);
}

export async function publishAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const expiresAt = expiryDate(form, "het-han");
  const outcome = complete(form, ["thong-bao"])
    ? await attemptTyped(shelfSlug, publishAnnouncement, {
        announcementId: field(form, "thong-bao"),
        // Absent leaves `already_published` in force; present is the republish
        // path. `null` from an empty box means "no expiry", which is a
        // legitimate answer and distinct from not asking.
        ...(form.has("het-han") ? { expiresAt } : {}),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "thong-bao", outcome);
}

export async function hideAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["thong-bao"])
    ? await attempt(shelfSlug, hideAnnouncement, {
        announcementId: field(form, "thong-bao"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "thong-bao", outcome);
}

export async function pinAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["thong-bao"])
    ? await attempt(shelfSlug, pinAnnouncement, {
        announcementId: field(form, "thong-bao"),
      })
    : INCOMPLETE;

  afterPinDecision(shelfSlug, optional(form, "thong-bao-slug"), outcome);
}

export async function unpinAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["thong-bao"])
    ? await attempt(shelfSlug, unpinAnnouncement, {
        announcementId: field(form, "thong-bao"),
      })
    : INCOMPLETE;

  afterPinDecision(shelfSlug, optional(form, "thong-bao-slug"), outcome);
}

/**
 * OPS §4.4's `UpdateAnnouncement` — **Sửa**, in place on the card.
 *
 * Every field is optional in the command ("a field that is present must be
 * valid; a field that is absent is untouched"), and this form always sends both,
 * so an empty title is a refusal rather than a silent no-op. The expiry keeps
 * its three cases: the box is always posted, so an empty one clears the expiry
 * deliberately rather than by omission.
 */
export async function updateAnnouncementAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["thong-bao"])
    ? await attemptTyped(shelfSlug, updateAnnouncement, {
        announcementId: field(form, "thong-bao"),
        title: field(form, "tieu-de"),
        body: field(form, "noi-dung"),
        expiresAt: expiryDate(form, "het-han"),
      })
    : INCOMPLETE;

  backToQueue(managerBase(shelfSlug), "thong-bao", outcome);
}

/**
 * A `type="date"` box read as an expiry instant, or `null` for an empty one.
 *
 * **End of that day, not the start of it.** `2026-08-14` from a date input is
 * midnight, so an announcement set to expire "on the 14th" would vanish as the
 * 13th ended — a manager writes a date meaning "up to and including". The
 * shift is a whole day added to the parsed instant.
 *
 * An unparseable value is `null` rather than an `Invalid Date`: the latter
 * reaches `assertValidClockInstant`-shaped territory inside the kernel and
 * raises a `RangeError` from inside a transaction, which is the shape OPS §2
 * forbids. A browser's date input cannot produce one; a hand-written POST can.
 */
function expiryDate(form: FormData, name: string): Date | null {
  const raw = field(form, name);
  if (raw === "") return null;
  const at = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(at.getTime())) return null;
  return new Date(at.getTime() + 24 * 60 * 60 * 1000);
}

// ── Parish taxonomy and units — `quan-ly/co-cau`, wired by Task 3 ─────────
//
// OPS §4.5's five administration commands, fully implemented and fully
// tested since B2b and called from nowhere until now — the QA sweep this
// task's plan is named for found the visible consequence: an empty "Giáo xứ"
// section on the reader-registration form, a `Tổ` column permanently
// "Chưa có", and a `?don-vi=` filter that could never match.
//
// **`attemptTyped`, not `attempt`, for four of the five.** `createParishUnit`,
// `renameParishUnit`, `reorderParishUnits` and `updateParishTaxonomy` all
// throw `ValidationFailed` for a mistake a manager can make and undo by
// retyping — an empty name, a duplicate name, a third level, a stale
// reorder — the same reasoning `createCategoryAction`
// (`src/app/quan-tri/admin-actions.ts`) already applies to the sibling
// screen this one is modelled on. `deleteUnitAction` keeps the narrow
// `attempt`: `deleteParishUnit` throws only `RuleViolated` and `NotFound`,
// and `NotFound` is deliberately left to `submitCommand`'s own translation
// into a 404 — the same thing a stale "Xoá" double-click already does to
// every other delete-style command in this file.
//
// **Every one of the five is `super_admin`-only** (OPS §4.5), and this
// screen renders under the ordinary manager surface anyway rather than
// under `/quan-tri`. `parish_units` is tenant-scoped under RLS — unlike
// `categories`, which needed `runAdminCommand`'s escalation because it has
// no `bookshelf_id` at all — so the ordinary `submitCommand` path is the
// right one; a plain `manager` reaching this screen sees the same read-only
// tree everyone with at least `reader` can (`getParishUnits`'s own gate),
// and a write attempt comes back "Bạn không có quyền thực hiện việc này."
// through the same `RuleViolated` path every other refusal in this file
// takes. No second copy of that check belongs here — see this file's own
// header on why `requireManager` never appears beside a command call.

/** `/tu-sach/<slug>/quan-ly/co-cau`, with or without a refusal code. */
function backToCoCau(
  shelfSlug: string,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  const base = managerBase(shelfSlug);
  if (!outcome.ok) redirect(`${base}/co-cau?${ACTION_ERROR_PARAM}=${outcome.code}`);
  redirect(`${base}/co-cau`);
}

/**
 * OPS §4.5's `UpdateParishTaxonomy` — the "Cách gọi các đơn vị" form.
 *
 * All four fields are sent on every submit, never `optional()`. The command
 * itself treats each as independently optional and merges onto the stored
 * value (see its own docstring), but this form always renders every field
 * pre-filled from `loadParishContext`, so an empty box on submit is a
 * manager who cleared it — a refusal, not a silent no-op. Exactly the choice
 * `updateAnnouncementAction` already makes for the same reason, above.
 */
export async function updateTaxonomyAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = await attemptTyped(shelfSlug, updateParishTaxonomy, {
    levels: field(form, "so-bac") === "2" ? 2 : 1,
    // An unchecked box posts nothing at all — `form.has` is the right read,
    // the same one `createBookAction`'s "hien-thi" and
    // `updateBookshelfPolicyAction`'s two comment toggles already use.
    nested: form.has("long-nhau"),
    level1Label: field(form, "ten-bac-1"),
    level2Label: field(form, "ten-bac-2"),
  });

  backToCoCau(shelfSlug, outcome);
}

/**
 * OPS §4.5's `CreateParishUnit` — the "Thêm đơn vị" disclosure at the foot of
 * each level's list, and of each level-1 unit's own level-2 list when nested.
 *
 * **`cha` only ever arrives from a form that can supply a real parent.** The
 * co-cau screen's nested level-2 "Thêm" disclosures each sit inside one
 * specific level-1 unit's own block and carry that unit's id as a hidden
 * field; the flat level-2 disclosure and every level-1 disclosure carry no
 * `cha` field at all. So a manager cannot construct a request `createParishUnit`
 * would refuse for `parentId` — see that command's own docstring for the
 * nesting rule this shape is built to agree with.
 */
export async function createUnitAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const level = field(form, "bac") === "2" ? 2 : 1;
  const outcome = complete(form, ["ten"])
    ? await attemptTyped(shelfSlug, createParishUnit, {
        level,
        parentId: optional(form, "cha"),
        name: field(form, "ten"),
      })
    : INCOMPLETE;

  backToCoCau(shelfSlug, outcome);
}

/** OPS §4.5's `RenameParishUnit` — "Đổi tên" on a unit's own row. */
export async function renameUnitAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["don-vi", "ten"])
    ? await attemptTyped(shelfSlug, renameParishUnit, {
        unitId: field(form, "don-vi"),
        name: field(form, "ten"),
      })
    : INCOMPLETE;

  backToCoCau(shelfSlug, outcome);
}

/**
 * OPS §4.5's `DeleteParishUnit` — "Xoá" on a unit's own row, cascading to a
 * level-1 unit's live level-2 children in the same transaction (the
 * command's own docstring has the reasoning).
 */
export async function deleteUnitAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const outcome = complete(form, ["don-vi"])
    ? await attempt(shelfSlug, deleteParishUnit, { unitId: field(form, "don-vi") })
    : INCOMPLETE;

  backToCoCau(shelfSlug, outcome);
}

/**
 * OPS §4.5's `ReorderParishUnits` — "Lên" / "Xuống" on a unit's own row.
 *
 * **No client JavaScript, like the rest of this app.** Each row's pair of
 * buttons lives in one `<form>` that also carries a hidden `thu-tu` input per
 * sibling in the group, in their *current* rendered order — the same list
 * `reorderParishUnits` itself requires ("all at one level, under one
 * parent"). The two buttons share that one form and differ only in their own
 * `name="huong"` `value`, which is how a native form tells two submit
 * buttons apart without any script at all: only the clicked button's
 * name/value pair is submitted.
 *
 * The new order is computed here, from the posted order and which id moved,
 * never on the client: swap `di-chuyen`'s position with its neighbour in the
 * direction named by `huong`, then post the whole array as `unitIds`. This is
 * the "server computes `orderedIds` from the current order and the row being
 * moved" shape the plan calls for, and it is also what
 * `reorderParishUnits`'s own docstring insists on — a **partial** list is
 * refused rather than repaired, so the posted `thu-tu` inputs have to be the
 * *whole* sibling group or the command's own completeness check answers
 * `validation_failed`.
 *
 * A move with nowhere to go — `di-chuyen` missing from `thu-tu`, or already
 * at the edge `huong` points past — is the same `INCOMPLETE` refusal a
 * malformed form gets elsewhere in this file. The rendered page never
 * constructs this request (the edge button is simply not drawn), so reaching
 * it means the form was tampered with or the list went stale between render
 * and submit; `validation_failed`'s "Vui lòng kiểm tra lại thông tin." is the
 * honest answer to a stale list, same as `reorderParishUnits`'s own.
 */
export async function reorderUnitsAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const order = form.getAll("thu-tu").map(String);
  const moving = field(form, "di-chuyen");
  const delta = field(form, "huong") === "xuong" ? 1 : -1;
  const from = order.indexOf(moving);
  const to = from + delta;

  const outcome =
    from === -1 || to < 0 || to >= order.length
      ? INCOMPLETE
      : await attemptTyped(shelfSlug, reorderParishUnits, {
          unitIds: order.map((id, i) => {
            if (i === from) return order[to];
            if (i === to) return order[from];
            return id;
          }),
        });

  backToCoCau(shelfSlug, outcome);
}

// ── Reader administration — `quan-ly/nguoi-doc/[id]`, wired by Task 4 ─────
//
// OPS §4.3's other five: give a reader a login, reset one, suspend, reactivate,
// mark left, correct a profile directly. All fully implemented and fully
// tested since B2a/B2b and, like the parish-unit family Task 3 wired, called
// from nowhere until now — the reader-detail screen showed the badge "Chưa có
// tài khoản đăng nhập" and no control of any kind behind it.
//
// **Every one of the five opens with `requireManager`, unlike the parish-unit
// family.** Checked before writing a single form: `co-cau/page.tsx`'s
// `canEdit` split exists because those five commands are `super_admin`-only
// while the *page* only raises the read floor to `manager` — a plain manager
// could see the tree but not touch it. Here there is no such gap to close:
// `getReaderDetail` (the query this screen already runs) opens with the same
// `requireManager` every one of these five commands opens with, so a viewer
// who can reach this page at all — `manager`, `admin`, `super_admin` alike —
// can use every control on it. Nothing here renders a form that only some of
// those roles could submit, which is what Task 3 shipped once and a review
// rated Critical for. The state that gates each disclosure below is the
// *reader's*, never the viewer's role.
//
// **One terracotta primary, and it is conditional on the reader, not fixed.**
// "Cấp tài khoản đăng nhập" is the only `primary` `SubmitButton` on this
// screen, and only when `!reader.hasCredentials` — a reader who already has
// one sees no primary at all, by the same "at most one terracotta" rule every
// other manager screen in this codebase follows.

/**
 * `/tu-sach/<slug>/quan-ly/nguoi-doc/<id>`, with or without a refusal code —
 * where every one of the five actions below lands, on the same reader they
 * just acted on. `backToQueue` above cannot serve this: its target is one
 * fixed sub-route shared by every card on a list, and these five each return
 * to the *one* reader the manager was already looking at.
 */
function backToReader(
  shelfSlug: string,
  membershipId: string,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  const base = `${managerBase(shelfSlug)}/nguoi-doc/${encodeURIComponent(membershipId)}`;
  redirect(outcome.ok ? base : `${base}?${ACTION_ERROR_PARAM}=${outcome.code}`);
}

/**
 * OPS §4.3's `SetReaderCredentials` — serving both of the reader-detail
 * screen's credential disclosures, because the command itself is one act from
 * either side of it: "Cấp tài khoản đăng nhập" (a first login) and "Đặt lại
 * mật khẩu" (a forgotten one) both end here, exactly as `set-reader-
 * credentials.ts`'s own docstring argues for building one command instead of
 * two.
 *
 * **The reset form posts a username too, invisibly.** `setReaderCredentials`
 * always writes a username *and* a password (INV-14) — there is no
 * password-only variant — so "Đặt lại mật khẩu", which shows the manager only
 * a password box, still has to submit the reader's existing username. The
 * page renders it as a hidden field carrying `reader.username`, and this
 * action does not know or care which of the two forms posted to it; both
 * arrive with all three fields present.
 *
 * `attemptTyped`, not `attempt`: a blank username or a password under eight
 * characters is a manager's ordinary typo, correctable on the very form they
 * are looking at — the same `ValidationFailed` reasoning
 * `registerReaderOnBehalfAction` above already gives for its own form.
 * `username_in_use` — the one refusal a *business rule* raises, when the
 * chosen name collides with somebody else's — still arrives as
 * `RuleViolated` and is caught the same way: the command itself translates
 * Postgres's `23505` into that code (`set-reader-credentials.ts`'s own
 * docstring, note 2), so what reaches this file is already the catalogue's
 * Vietnamese sentence and never a raw constraint violation.
 */
export async function setReaderCredentialsAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const outcome = complete(form, ["thanh-vien", "ten-dang-nhap"])
    ? await attemptTyped(shelfSlug, setReaderCredentials, {
        membershipId,
        username: field(form, "ten-dang-nhap"),
        // Not trimmed, like every other password field in this codebase
        // (`ho-so/profile-actions.ts`'s `changeOwnPasswordAction` carries the
        // reasoning): a password is bytes a person chose, and trimming one
        // silently changes the secret. `field()` above trims, so this reads
        // the form directly.
        password: String(form.get("mat-khau") ?? ""),
      })
    : INCOMPLETE;

  backToReader(shelfSlug, membershipId, outcome);
}

/**
 * What the "Tạm khoá" disclosure returns when its reason box was left empty —
 * this screen's own decision and not `suspendMembership`'s: the command's
 * `reason` is optional (OPS §4.3, "a manager may suspend without typing
 * one"), but a suspension with no explanation is a decision nobody standing
 * at this shelf next month can act on, so the screen asks before the command
 * ever sees the request. See the code's own comment in `errors.ts` for why it
 * is a distinct code from `reject_reason_required`.
 */
const NO_SUSPENSION_REASON = {
  ok: false,
  code: "suspension_reason_required",
} as const;

/**
 * OPS §4.3's `SuspendMembership` — "Tạm khoá", `active → suspended`.
 *
 * `attempt`, not `attemptTyped`: past the reason check above, the only
 * refusal `suspendMembership` itself can raise is `not_active_cannot_suspend`
 * (`RuleViolated`) — a stale page re-posting against a reader some other
 * manager already suspended a moment earlier. There is no `ValidationFailed`
 * this form could ever trigger.
 */
export async function suspendMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["thanh-vien"])
    ? INCOMPLETE
    : reason === ""
      ? NO_SUSPENSION_REASON
      : await attempt(shelfSlug, suspendMembership, { membershipId, reason });

  backToReader(shelfSlug, membershipId, outcome);
}

/**
 * OPS §4.3's `ReactivateMembership` — "Mở khoá lại", `suspended → active`.
 * Takes no reason: clearing `suspension_reason` is the command's own job, not
 * a fact this form collects (`reactivate-membership.ts`'s own docstring).
 */
export async function reactivateMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const outcome = complete(form, ["thanh-vien"])
    ? await attempt(shelfSlug, reactivateMembership, { membershipId })
    : INCOMPLETE;

  backToReader(shelfSlug, membershipId, outcome);
}

/**
 * OPS §4.3's `MarkMembershipLeft` — "Đánh dấu đã rời", any status `→ left`.
 * No reason field: OPS §4.3 does not ask this command for one, unlike
 * suspension above — a decision Task 4 read as deliberate rather than an
 * oversight to correct, since the brief for this screen names a reason only
 * for "Tạm khoá".
 *
 * The one refusal a stale page can reach is `member_has_active_loans` — a
 * reader whose "Đang mượn" count this same screen shows above zero — which
 * arrives as `RuleViolated` and needs no `ValidationFailed` handling.
 */
export async function markMembershipLeftAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const outcome = complete(form, ["thanh-vien"])
    ? await attempt(shelfSlug, markMembershipLeft, { membershipId })
    : INCOMPLETE;

  backToReader(shelfSlug, membershipId, outcome);
}

/**
 * OPS §4.3's `UpdateReaderProfile` — "Sửa hồ sơ", the manager's direct
 * correction path INV-13b's restatement opened up, wrapping the identical
 * seven fields `proposeProfileChangeAction` above collects for the reader's
 * own proposal (`ho-so/profile-actions.ts`). Not the eighth, `avatar_object`: that
 * one has its own proposal-and-approve lifecycle
 * (`ProposeAvatarChange`/`ApproveProfileChange`) and no direct-write
 * counterpart exists for a manager to reach through this command — sending it
 * here would ask `updateReaderProfile` to write a field nothing uploaded.
 *
 * **Every field is sent, always, never `optional()`.** Same choice
 * `proposeProfileChangeAction` makes and for the same reason: the command
 * itself decides what counts as a change (`normaliseProfilePatch`,
 * `diffProfileFields`), so sending all seven and changing none comes back as
 * `empty_proposal` — the sentence a manager who submitted without editing
 * anything should read.
 *
 * `attemptTyped`: an emptied `full_name`/`father_name`/`mother_name` is
 * `required_fields_missing`, a malformed date is `validation_failed`, and an
 * unchanged submission is `empty_proposal` — three ordinary mistakes a
 * manager corrects on the same form, not faults.
 */
export async function updateReaderProfileAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");

  const outcome = complete(form, ["thanh-vien"])
    ? await attemptTyped(shelfSlug, updateReaderProfile, {
        membershipId,
        fields: {
          // `optional()` (this file's own helper, above): an empty box reads
          // as `null`, "clear this field", never the empty string. All seven
          // keys are still always present in the object below — only the
          // *value* of each is optional, never the field itself. See this
          // function's own docstring for why every field is sent regardless
          // of what changed.
          saint_name: optional(form, "ten-thanh"),
          full_name: optional(form, "ho-ten"),
          date_of_birth: optional(form, "ngay-sinh"),
          father_name: optional(form, "ten-cha"),
          mother_name: optional(form, "ten-me"),
          phone: optional(form, "dien-thoai"),
          // PO feedback round 1, Task 8: `applyProfileFields`'s two callers
          // both call `assertPhoneOrReason` on the resulting record — see
          // `@/domain/members/profile-fields.ts`. This form always
          // sends the field (see `EditProfileDisclosure`'s hidden/visible
          // `ly-do-thieu-sdt` input), pre-filled with whatever is already on
          // file, so leaving it untouched preserves an existing reason rather
          // than silently clearing it.
          phone_missing_reason: optional(form, "ly-do-thieu-sdt"),
          email: optional(form, "email"),
        },
      })
    : INCOMPLETE;

  backToReader(shelfSlug, membershipId, outcome);
}

// ── The book detail page's own controls — `quan-ly/sach/[id]`, wired by
// Task 11 (QA remediation) ──────────────────────────────────────────────
//
// Twelve `<button type="submit">` on that page — "Đánh giá", "Báo mất",
// "Ngừng dùng", three per non-lost copy — had no enclosing `<form>` at all,
// and "Sửa sách" linked to the book *list* rather than to any edit form. Six
// commands behind that page (`assessCondition`, `reportCopyLost`,
// `retireCopy`, `markCopyFound`, `updateBook`, `addCopies`) were all
// implemented and tested since B1; nothing in `src/app` called five of
// them, and nothing called `updateBook` at all.
// `tests/architecture/no-button-without-a-form.test.ts` is the guard
// against the twelve dead buttons recurring; it was extended in review to
// also guard against the thirteenth shape this task first shipped and a
// review round caught — a `<form>` with a submit control and no `action`,
// which "Thêm bản" was: a convincing-looking reload that silently discarded
// whatever a manager had just typed, worse than a button that visibly does
// nothing.
//
// **`assessConditionAction`, `updateBookAction` and `addCopiesAction` are
// new.** The other three commands already had action wrappers —
// `reportCopyLostAction`, `retireCopyAction`, `markCopyFoundAction`,
// above — but each one already belongs to a *different* screen with a
// locked-in redirect target: `reportCopyLostAction` returns to
// `nhan-tra/bao-mat` (it needs `q`/`muon` to put the manager back on the
// loan they were returning) and `retireCopyAction`/`markCopyFoundAction`
// return to `sach/mat`, exactly as `tests/lib/manager-actions.test.ts` pins.
// Bending any of the three to also serve this page would mean growing a
// parameter neither existing caller needs, or risking the day someone edits
// the wrong branch and both screens' redirects drift. The command
// underneath each is identical either way; only *where the screen sends the
// manager back to* differs, which is a decision this surface makes for
// itself — the same shape `backToReader` already makes for its own five,
// below `backToBook`.

/**
 * `/tu-sach/<slug>/quan-ly/sach/<bookSlug>`, with or without a refusal code —
 * where every control below lands, on the same book detail page the manager
 * was already looking at. `bookSlug` travels as a hidden `sach` field on
 * every form in this section; see this section's own header for why that is
 * a fifth redirect target rather than a parameter grown onto an existing one.
 */
function backToBook(
  shelfSlug: string,
  bookSlug: string,
  outcome: { ok: true } | { ok: false; code: string },
): never {
  const base = `${managerBase(shelfSlug)}/sach/${encodeURIComponent(bookSlug)}`;
  redirect(outcome.ok ? base : `${base}?${ACTION_ERROR_PARAM}=${outcome.code}`);
}

/**
 * OPS §4.1's `AddCopies` — "Thêm bản", the disclosure above the copy table.
 *
 * **Wired in review, not in the first pass of this task.** The brief named
 * five commands and this was not one of them; the first version of this task
 * left the form exactly as fixture-era `main` had it — no `action` at all —
 * on the reasoning that the brief's own five were the slice. A review round
 * ruled that reasoning correct about scope and wrong about the outcome: a
 * `<form>` with a submit control and no `action` is not "still unwired", it
 * is a *new* failure mode a static reading misses — the browser's default GET
 * serialises every field into a discarded query string, and the page reloads
 * looking successful while the manager's input vanishes with no error. That
 * is worse than the twelve dead buttons this task exists to remove, on the
 * same screen, so it is in scope.
 *
 * **Donors are real now too.** The page used to pass `donors={[]}` to
 * `DonorFields`, both because there was no action to post to yet and per
 * that component's own docstring ("An empty list renders no member picker at
 * all… That is what the wired caller passes today: reading the shelf's
 * members for this picker belongs to the wave that gives this form an
 * action.") This is that wave — the page now reads the shelf's active
 * members exactly as `sach/moi/page.tsx` does for its own copy of the same
 * picker.
 *
 * `attemptTyped`, not `attempt`: `copy_count_invalid` is a manager's ordinary
 * mistake (an empty or non-numeric "Số bản muốn thêm"), correctable on the
 * same form — the identical call `createBookAction` already makes for the
 * same field.
 */
export async function addCopiesAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const outcome = complete(form, ["sach-id"])
    ? await attemptTyped(shelfSlug, addCopies, {
        bookId: field(form, "sach-id"),
        count: wholeNumber(form, "so-ban") ?? -1,
        donorMembershipId: optional(form, "donorMembershipId"),
        donorName: optional(form, "donorName"),
        acquiredOn: optional(form, "acquiredOn"),
      })
    : INCOMPLETE;

  backToBook(shelfSlug, bookSlug, outcome);
}

/**
 * OPS §4.1's `AssessCondition` — "Đánh giá" on a copy's own row.
 *
 * **No copy-state check here, and none belongs here.** `assessCondition`
 * itself consults no transition table (BR §9: "a condition is not a state"),
 * so the command accepts any state; the page withholds the control for
 * `lost` and `retired` copies for a product reason — nothing to inspect —
 * not a rule this action re-checks. See `copyControls` in the page itself.
 *
 * `attemptTyped`, not `attempt`: the form can only ever submit one of the six
 * `COPY_CONDITIONS` (`ConditionPicker` renders exactly those six radios), so
 * `assessCondition`'s own `ValidationFailed("validation_failed", "condition")`
 * is unreachable from this form and stays loud if it ever fires anyway —
 * `receiveReturnAction`'s docstring makes the identical point about the same
 * picker.
 */
export async function assessConditionAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const note = field(form, "ghi-chu");
  const outcome = complete(form, ["ban", "tinh-trang"])
    ? await attemptTyped(shelfSlug, assessCondition, {
        copyId: field(form, "ban"),
        condition: field(form, "tinh-trang") as CopyCondition,
        note: note === "" ? null : note,
      })
    : INCOMPLETE;

  backToBook(shelfSlug, bookSlug, outcome);
}

/**
 * OPS §4.1's `ReportCopyLost` — "Báo mất" on a copy's own row, the book
 * detail page's own entry point rather than the return flow's
 * (`reportCopyLostAction`, above, which is `nhan-tra/bao-mat`'s).
 *
 * The page renders this control only when `copyStateTransition(copy.state,
 * "lost").allowed` — in practice only `on_loan`, BR §7.1's one arrow into
 * `lost` — so a stale page re-posting against a copy someone already
 * returned or retired a moment earlier is the only way this command's own
 * refusal (`copy_not_on_loan`, `already_lost`, `already_retired`) is reached
 * from here.
 */
export async function reportCopyLostOnBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const note = field(form, "ghi-chu");
  const outcome = complete(form, ["ban"])
    ? await attempt(shelfSlug, reportCopyLost, {
        copyId: field(form, "ban"),
        note: note === "" ? null : note,
      })
    : INCOMPLETE;

  backToBook(shelfSlug, bookSlug, outcome);
}

/**
 * OPS §4.1's `RetireCopy` — "Ngừng dùng" on a copy's own row, the same
 * required-reason shape `retireCopyAction` above already uses for `sach/mat`.
 *
 * The page renders this control only for `available` and `lost` copies (BR
 * §7.1's two arrows into `retired`), so `copy_on_loan` — the refusal a
 * `held` or `on_loan` copy would draw — is unreachable from here except by a
 * stale page.
 */
export async function retireCopyOnBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const reason = field(form, "ly-do");
  const outcome = !complete(form, ["ban"])
    ? INCOMPLETE
    : reason === ""
      ? ({ ok: false, code: "retire_reason_required" } as const)
      : await attempt(shelfSlug, retireCopy, {
          copyId: field(form, "ban"),
          reason,
        });

  backToBook(shelfSlug, bookSlug, outcome);
}

/**
 * OPS §4.1's `MarkCopyFound` — "Đánh dấu tìm thấy" on a copy's own row, the
 * book detail page's own entry point rather than `sach/mat`'s
 * (`markCopyFoundAction`, above). BR:559's complaint — "'Báo mất' appears in
 * three places… and marking a copy found appears in none of them" — is what
 * `sach/mat` already fixed; this is the same command reachable from the
 * *title* a manager is already looking at, for the copy whose row is
 * already in front of them.
 *
 * The page renders this control only for `state === "lost"`.
 */
export async function markCopyFoundOnBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const outcome = complete(form, ["ban"])
    ? await attempt(shelfSlug, markCopyFound, { copyId: field(form, "ban") })
    : INCOMPLETE;

  backToBook(shelfSlug, bookSlug, outcome);
}

/**
 * OPS §4.1's `UpdateBook` — "Sửa sách", `sach/[id]/sua`, replacing the link
 * that pointed at the book *list* rather than at any edit form.
 *
 * **Every metadata field is always sent, never `optional()`.** `sach/[id]
 * /sua/page.tsx` pre-fills every field from `getBookForEdit`, so an empty
 * box on submit is a manager who cleared it — a refusal or a real `null`,
 * never a silent no-op — the same choice `updateTaxonomyAction` and
 * `updateReaderProfileAction` already make for the identical reason, stated
 * in both of their own docstrings. `title`/`author`/`categorySlug` are
 * required by the form's own `required` attribute and, behind that, by
 * `updateBook` itself (`ValidationFailed` for a blank title or author,
 * `category_not_found` for an empty slug) — no duplicate check belongs here.
 *
 * **`sach-id` (the book's uuid, for `updateBook`'s own input) and `sach`
 * (the book's slug, for the redirect) are two different hidden fields, on
 * purpose.** `updateBook`'s own docstring is explicit that the slug is never
 * rewritten, so the redirect target has to be the slug the page loaded with
 * — not derived from whatever title the manager just typed — and that is a
 * different fact from the row `updateBook` needs to find.
 */
export async function updateBookAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const bookSlug = field(form, "sach");
  const outcome = complete(form, ["sach-id"])
    ? await attemptTyped(shelfSlug, updateBook, {
        bookId: field(form, "sach-id"),
        title: field(form, "ten-sach"),
        author: field(form, "tac-gia"),
        categorySlug: field(form, "the-loai"),
        publisher: optional(form, "nxb"),
        publishedYear: wholeNumber(form, "nam-xb"),
        pageCount: wholeNumber(form, "so-trang"),
        isbn: optional(form, "isbn"),
        description: optional(form, "mo-ta"),
        // An unchecked checkbox posts nothing at all — `createBookAction`'s
        // own "hien-thi" read, above.
        published: form.get("hien-thi") !== null,
      })
    : INCOMPLETE;

  // Success lands on `backToBook`'s own target; the failure target does not
  // (it goes back to *this* form, `/sua`, not to the book itself), so this
  // cannot fully delegate to that helper — but it encodes the slug the same
  // way that helper does, on both branches, for the same reason: a slug is
  // a URL segment a manager did not type, and it need not be URL-safe by
  // construction.
  const base = `${managerBase(shelfSlug)}/sach/${encodeURIComponent(bookSlug)}`;
  if (!outcome.ok) {
    redirect(`${base}/sua?${ACTION_ERROR_PARAM}=${outcome.code}`);
  }
  redirect(base);
}
