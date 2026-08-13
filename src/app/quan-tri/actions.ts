"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "../../domain/kernel/errors";
import {
  markFeedbackRead,
  resolveFeedback,
} from "../../domain/community/commands/feedback";
import { getFeedbackDetail } from "../../domain/admin/queries/get-feedback-inbox";
import { getProfileChangeRequestShelf } from "../../domain/admin/queries/get-pending-manager-changes";
import { approveProfileChange } from "../../domain/members/commands/approve-profile-change";
import { rejectProfileChange } from "../../domain/members/commands/reject-profile-change";
import type { Command } from "../../domain/kernel/unit-of-work";
import { discardAvatarObject } from "../../lib/avatar";
import { loadAdminPage, submitAdminCommand } from "../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../lib/search-params";

/**
 * The administration surface's server actions.
 *
 * Same contract as every action in this codebase (U1 §3.3): a `RuleViolated` or
 * a `ValidationFailed` comes back as a **code** the page renders through
 * `messageFor`, and anything else keeps throwing.
 *
 * **Both actions resolve the message's own shelf first**, and that is not a
 * convenience. `auditScopeFor` (`src/domain/community/commands/feedback.ts`)
 * refuses a mismatch between the shelf on the context and the shelf on the
 * message, because `toRow` can only take the audit row's shelf from the context
 * — so an action that guessed would either mis-file one parish's record into
 * another or simply be refused.
 *
 * A hidden form field carrying the shelf id would be the alternative and is the
 * worse one: it is a value the browser sends, and the point of the check is
 * that the shelf is a fact about the *message*.
 */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return err.code;
    }
    throw err;
  }
}

async function handle(
  form: FormData,
  command: typeof markFeedbackRead | typeof resolveFeedback,
): Promise<void> {
  const feedbackId = String(form.get("gop-y") ?? "");

  const message = await loadAdminPage((tx, ctx) =>
    getFeedbackDetail(tx, ctx, { feedbackId }),
  );
  // An id naming nothing goes back to the inbox rather than to an error: the
  // most likely way to reach it is a second submit of a form whose message
  // somebody else already handled.
  if (!message) redirect("/quan-tri/gop-y");

  // `""` for a site-wide message, which is the scope `runAdminCommand` requires
  // before it will write the global audit row such a message needs.
  const code = await attempt(() =>
    submitAdminCommand(command, { feedbackId }, message.shelfId ?? ""),
  );

  const back = `/quan-tri/gop-y?tin=${feedbackId}`;
  redirect(code ? `${back}&${ACTION_ERROR_PARAM}=${code}` : back);
}

export async function markFeedbackReadAction(form: FormData): Promise<void> {
  await handle(form, markFeedbackRead);
}

export async function resolveFeedbackAction(form: FormData): Promise<void> {
  await handle(form, resolveFeedback);
}

// ── Đổi thông tin quản lý (Task 10) ─────────────────────────────────────────
//
// `/quan-tri/doi-thong-tin`'s two decisions — approving or rejecting a
// manager's or shelf admin's own pending profile change, §9 of the design
// doc's other half. The domain commands are the exact ones
// `/tu-sach/[shelf]/quan-ly/actions.ts` already calls for a *reader's*
// change; nothing here is a second implementation of the decision, only of
// how this surface reaches it.
//
// **Why `submitAdminCommand`, not `submitCommand`.** Every other write under
// `/quan-tri` goes through it (`admin-actions.ts`'s docstring), and the
// reason applies here without alteration: a super admin deciding a
// manager's change is, in the ordinary case, a person acting on a shelf they
// hold no membership of at all — `assignManagerAction`'s "AssignManager
// writes a memberships row for a shelf the caller holds no membership of"
// (`unit-of-work.ts`'s `runAdminCommand` docstring) describes this act
// exactly.
//
// **`bookshelfId` is resolved from the request row, not trusted off the
// form.** Fix round 1: this used to travel as a hidden `tu-sach` field —
// populated correctly by the page, off `getPendingManagerChanges`' own
// resolved row, but nothing stood between a *mismatched* post and a
// `profile_change.approved` audit row filed against the wrong parish, since
// `runAdminCommand` runs as `olibra_admin` with `bypassrls` here and RLS is
// exactly the layer that would otherwise have refused it. `getFeedbackDetail`
// above already resolves *its* shelf this way rather than trusting a form —
// `getProfileChangeRequestShelf` (`get-pending-manager-changes.ts`) is that
// same pattern for this pair of actions.
//
// **The page's own guard is the second line, not the first** (the brief's
// own words): `approveProfileChange`/`rejectProfileChange` both refuse
// `not_permitted` if the subject is not a manager/admin decided by a
// `super_admin`, or if the actor is the subject, regardless of what this
// file does or does not check first. `loadAdminPage` already refuses
// anybody who is not a super admin a render of the page these actions are
// posted from.

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function complete(form: FormData, names: string[]): boolean {
  return names.every((name) => field(form, name) !== "");
}

const INCOMPLETE = { ok: false, code: "validation_failed" } as const;
const NO_REJECT_REASON = { ok: false, code: "reject_reason_required" } as const;

/**
 * `attemptDiscardingAvatar` in `/tu-sach/[shelf]/quan-ly/actions.ts`,
 * restated over `submitAdminCommand` rather than `submitCommand` — see this
 * section's own header for why the seam differs and `src/lib/avatar.ts`'s
 * `decideAndDiscardAvatar` for the ordering being restated by hand here: the
 * delete has to run after the transaction commits, never inside it, and that
 * shelf-side helper is hard-wired to `submitCommand`, so it cannot be reused
 * as-is from a surface that writes through `submitAdminCommand` instead.
 *
 * **Widened to `ValidationFailed`, post-review fix wave, item 3 — same fix,
 * same reason, as the shelf-side sibling.** `approveProfileChange` reaches
 * `normaliseProfilePatch` on the way to writing the person record, which
 * throws `ValidationFailed("required_fields_missing", "saint_name")` for any
 * proposal written before saint name became mandatory (§8) and blanked it —
 * legal at the time. Catching `RuleViolated` only sent that straight past
 * this function, out of the server action, and into Next's generic error
 * page, on a request the deciding super admin can otherwise only *reject*.
 * `attempt` above already widens the same way, for the same reason.
 */
async function attemptDiscardingAvatar<I>(
  bookshelfId: string,
  command: Command<I, { avatarObject: string | null }>,
  input: I,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const { avatarObject } = await submitAdminCommand(command, input, bookshelfId);
    await discardAvatarObject(avatarObject);
    return { ok: true };
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return { ok: false, code: err.code };
    }
    throw err;
  }
}

/** Back to the queue, a refusal's code carried along exactly as `backToQueue` does. */
function backToAdminQueue(
  outcome: { ok: true } | { ok: false; code: string },
): never {
  const suffix = outcome.ok ? "" : `?${ACTION_ERROR_PARAM}=${outcome.code}`;
  redirect(`/quan-tri/doi-thong-tin${suffix}`);
}

/**
 * `getFeedbackDetail`'s role for this pair of actions: the one place that
 * turns a posted request id into the shelf `submitAdminCommand` writes the
 * audit row against. `null` for an id naming no request at all — the same
 * "already handled by somebody else" case `handle()` above redirects on —
 * which the two callers below fold into `INCOMPLETE` rather than a second
 * error shape.
 */
async function resolveRequestShelf(
  profileChangeRequestId: string,
): Promise<string | null> {
  return loadAdminPage((tx, ctx) =>
    getProfileChangeRequestShelf(tx, ctx, { profileChangeRequestId }),
  );
}

export async function approveManagerProfileChangeAction(
  form: FormData,
): Promise<void> {
  const requestId = field(form, "yeu-cau");
  const bookshelfId = complete(form, ["yeu-cau"])
    ? await resolveRequestShelf(requestId)
    : null;
  const outcome =
    bookshelfId === null
      ? INCOMPLETE
      : await attemptDiscardingAvatar(bookshelfId, approveProfileChange, {
          profileChangeRequestId: requestId,
        });
  backToAdminQueue(outcome);
}

export async function rejectManagerProfileChangeAction(
  form: FormData,
): Promise<void> {
  const requestId = field(form, "yeu-cau");
  const reason = field(form, "ly-do");
  const bookshelfId = complete(form, ["yeu-cau"])
    ? await resolveRequestShelf(requestId)
    : null;
  const outcome =
    bookshelfId === null
      ? INCOMPLETE
      : reason === ""
        ? NO_REJECT_REASON
        : await attemptDiscardingAvatar(bookshelfId, rejectProfileChange, {
            profileChangeRequestId: requestId,
            reason,
          });
  backToAdminQueue(outcome);
}
