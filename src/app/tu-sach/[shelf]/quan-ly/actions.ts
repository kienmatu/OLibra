"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: `tests/lib/lending-actions.test.ts`
// imports this module and Vitest resolves no alias. The distinction these three
// functions are built around — a refusal is a sentence, a fault still throws —
// is only worth writing down if it is the *shipped* function a test can reach.
import { RuleViolated } from "../../../../domain/kernel/errors";
import { reportCopyLost } from "../../../../domain/catalogue/commands/report-copy-lost";
import { lendCopy } from "../../../../domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../../../domain/circulation/commands/receive-return";
import type { CopyCondition } from "../../../../domain/catalogue/policy";
import type { Command } from "../../../../domain/kernel/unit-of-work";
import { ACTION_ERROR_PARAM, submitCommand } from "../../../../lib/page-data";

/**
 * The three confirm buttons of the circulation flows, as server actions.
 *
 * **The one distinction worth the whole file: a `RuleViolated` is an answer, a
 * fault is a fault.**
 *
 * Every command in `domain/circulation/` refuses by throwing
 * `RuleViolated(code)`, where `code` is an `ErrorCode` whose Vietnamese
 * sentence lives in `errors.ts` and whose failure mode is listed under OPS
 * §4.2. Those are the sentences BR §16.3 wants beside the confirm button —
 * "Bạn đọc đã mượn tối đa số sách cho phép." tells a volunteer what to do
 * next. So each action catches `RuleViolated`, and *only* `RuleViolated`, and
 * redirects back to the form with the code in `?loi=`.
 *
 * Everything else is rethrown. The tempting implementation is
 * `catch (e) { return { error: messageFor(...) } }`, and it is wrong in a way
 * nobody notices until it matters: a `PostgresError` from a database that is
 * down, a `NotFound` for an id the surface should never have been holding, a
 * `NotWired` from a boot sequence that skipped a setter — every one of them
 * would be rendered to a volunteer as "your input was wrong". U1 §3.3 calls
 * this "the one worth a test", and `tests/lib/lending-actions.test.ts` is it.
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

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

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
  const outcome = await attempt(shelfSlug, lendCopy, {
    copyId: field(form, "ban"),
    membershipId: field(form, "nguoi-doc"),
  });

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
  const outcome = await attempt(shelfSlug, receiveReturn, {
    loanId: field(form, "muon"),
    condition: field(form, "tinh-trang") as CopyCondition,
    // An empty textarea is no note, not a note that says nothing —
    // `condition_assessments.note` is nullable and a blank string would
    // read, a year later, as a manager who wrote something illegible.
    note: note === "" ? null : note,
  });

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
  const outcome = await attempt(shelfSlug, reportCopyLost, {
    copyId: field(form, "ban"),
    // BR §5.4 gives BookCopy no lost-note column, so this reaches the audit
    // entry and nowhere else — see `reportCopyLost`'s own docstring.
    note: note === "" ? null : note,
  });

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
