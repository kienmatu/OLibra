"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "@/domain/kernel/errors";
import {
  markFeedbackRead,
  resolveFeedback,
} from "@/domain/community/commands/feedback";
import { getFeedbackDetail } from "@/domain/admin/queries/get-feedback-inbox";
import { loadAdminPage, submitAdminCommand } from "@/lib/page-data";
import { ACTION_ERROR_PARAM } from "@/lib/search-params";

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
