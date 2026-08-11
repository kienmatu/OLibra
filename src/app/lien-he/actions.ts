"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias: `tests/lib/site-feedback-action
// .test.ts` imports this module directly, and Vitest resolves no alias — the
// same reason `src/lib/page-data.ts` and `src/app/quan-tri/admin-actions.ts`
// give for the identical choice. `src/app/tu-sach/[shelf]/community-actions
// .ts` (this file's sibling for the *shelf-scoped* form) stayed on `@/`
// because no test has ever needed to reach it directly; this one does, so it
// does not.
import { RuleViolated, ValidationFailed } from "../../domain/kernel/errors";
import { submitFeedback } from "../../domain/community/commands/feedback";
import { submitPublicCommand } from "../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../lib/search-params";

/**
 * `/lien-he`'s site-wide góp ý form — Task 17 (2026-08-10 QA remediation),
 * the task that closes the onboarding loop a fresh install otherwise leaves
 * open: `/tu-sach` with no shelves points here ("liên hệ với ban quản trị để
 * mở một tủ mới"), and until this task the page it points to had no form at
 * all when the administrator had not filled in a contact block yet.
 *
 * **A sibling of `submitFeedbackAction`
 * (`src/app/tu-sach/[shelf]/community-actions.ts`), not a call to it, and not
 * a widening of it.** That action derives its shelf from a `"tu-sach"` hidden
 * field and reaches `submitCommand`, whose whole sequence is slug →
 * `contextForRequest` → `runCommand` — there is no slug here, and no
 * parameter on that seam means "there is no shelf, and that is fine" rather
 * than "the shelf named does not exist" (see `submitCommand`'s own
 * docstring). `submitPublicCommand` (`src/lib/page-data.ts`) is the seam
 * built for exactly this caller — see its docstring, and
 * `runPublicCommand`'s (`src/domain/kernel/unit-of-work.ts`) beneath it, for
 * why a third seam rather than an optional parameter on the other two.
 *
 * **`bookshelfId: null`, always and explicitly — never omitted.** Omitting it
 * means "the shelf in scope" (`submitFeedback`'s own docstring on the
 * field), and there is none to default to here; this form exists only to
 * reach the administrator directly, which is what `null` says out loud.
 *
 * **The one write in the system genuinely open to a stranger with no shelf
 * and no session.** `submitFeedback` checks no floor at all (OPS §4.4 lists
 * its caller as `guest, reader`), and `submitPublicCommand` resolves a
 * session only to attribute a message to a signed-in sender if there is one
 * — it never requires one.
 *
 * **The rate limit is OPS §8's, unchanged**, and Task 17's review round
 * confirmed rather than assumed it: `submitFeedback`'s own docstring on its
 * `recent` query records what was found — the count is scoped by the calling
 * session's row visibility under RLS, so a phone number that has already
 * spent its three at some shelf's own `gop-y` form is not, today, visible to
 * this site-wide path. Left open rather than silently declared safe; see
 * that docstring for the full argument and the test that pins the current
 * behaviour.
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

export async function submitSiteFeedbackAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitPublicCommand(submitFeedback, {
      bookshelfId: null,
      senderName: String(form.get("ten") ?? ""),
      phone: String(form.get("dien-thoai") ?? ""),
      subject: String(form.get("chu-de") ?? ""),
      body: String(form.get("noi-dung") ?? ""),
    }),
  );

  // No repopulation on refusal — the same choice `/tu-sach/[shelf]/gop-y`
  // already made (see that page's own docstring) and the one this branch
  // reverted for two other forms in `2fb0ee8`: a name and a phone number are
  // not something to carry back through a query string, onto a shared parish
  // phone's browser history and a proxy's access log.
  redirect(code ? `/lien-he?${ACTION_ERROR_PARAM}=${code}` : "/lien-he?da-gui=1");
}
