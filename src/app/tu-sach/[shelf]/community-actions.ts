"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias: `tests/lib/comment-action.test.ts`
// imports this module directly, and Vitest resolves no alias — the same reason
// `src/lib/page-data.ts`, `src/app/quan-tri/admin-actions.ts` and
// `src/app/lien-he/actions.ts` each give for the identical choice. That last
// file's own note used to end "…this file's sibling for the shelf-scoped form
// stayed on `@/` because no test has ever needed to reach it directly"; U6 §1
// is the test that needed to.
import { RuleViolated, ValidationFailed } from "../../../domain/kernel/errors";
import { submitFeedback } from "../../../domain/community/commands/feedback";
import { offerDonation } from "../../../domain/community/commands/donations";
import { createComment } from "../../../domain/community/commands/comment-moderation";
import { submitCommand } from "../../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../../lib/search-params";

/**
 * The three community writes a reader makes from a shelf page.
 *
 * Same contract as every action here (U1 §3.3): a `RuleViolated` or a
 * `ValidationFailed` comes back as a **code** the page renders through
 * `messageFor`; anything else keeps throwing, because a `PostgresError` dressed
 * up as a friendly sentence tells somebody their input was wrong when the
 * database was down.
 *
 * `ValidationFailed` is caught here where `renewLoanAction` does not need to:
 * both of these commands validate free text a person typed, so a refusal is the
 * ordinary outcome of an empty field rather than a sign the surface sent
 * something impossible.
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

/**
 * Góp ý. OPS §4.4's caller is `guest, reader` — the one write in this system
 * open to somebody with no session at all, which is why `submitCommand` is
 * reached without any membership check on the way.
 *
 * The rate limit (OPS §8, three per phone per day) lives in the command and
 * comes back as `rate_limited`. The form deliberately does **not** repopulate
 * on refusal: a phone number and a message go into browser history and proxy
 * logs if they travel in a query string, which is the same reasoning U3
 * recorded for the on-behalf registration form.
 */
export async function submitFeedbackAction(form: FormData): Promise<void> {
  const shelf = String(form.get("tu-sach") ?? "");
  const base = `/tu-sach/${shelf}/gop-y`;

  const code = await attempt(() =>
    // No `bookshelfId`: omitted means *this shelf*, which is what a shelf's own
    // form means. `/lien-he` passes an explicit `null` for site-wide. See the
    // field's own note for why the default is that way round.
    submitCommand(shelf, submitFeedback, {
      senderName: String(form.get("ten") ?? ""),
      phone: String(form.get("dien-thoai") ?? ""),
      subject: String(form.get("chu-de") ?? ""),
      body: String(form.get("noi-dung") ?? ""),
    }),
  );

  redirect(code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : `${base}?da-gui=1`);
}

/**
 * Bình luận. BR:513 puts comments on a book's page; `createComment` has been
 * implemented, tested against INV-9 and **called from nowhere** since B3 —
 * `tests/architecture/every-domain-command-has-a-caller.test.ts` carried a
 * named exemption saying so, and this action is what deletes it.
 *
 * The visible consequence was not only that nobody could comment: it made
 * `/quan-ly/binh-luan` a moderation queue over a table nothing wrote to, with
 * four status chips, an approve action, a reject-with-reason form and a hide
 * action that could only ever operate on rows inserted by hand.
 *
 * **A manager posts through this same action**, which is worth stating because
 * the reported symptom was a manager unable to comment. `createComment` calls
 * `requireReader`, which is a floor rather than an equality — `atLeast(
 * "manager", "reader")` is true — and a manager holds an active membership of
 * the shelf like anybody else, so `membershipId === ctx.actor.membershipId`
 * is satisfiable for them. One form, everybody who can see the page.
 *
 * **`?da-gui=binh-luan` on success, rather than the comment itself appearing.**
 * `getBookComments` returns approved rows only, and that predicate *is* INV-9
 * living in the access path (its own docstring). A comment awaiting approval is
 * therefore invisible to its own author, so the page says what happened in a
 * sentence instead of leaving a reader wondering whether the button worked.
 *
 * The marker **names this form** rather than being a bare `1`: "Xin mượn" lands
 * on the same URL now, and a marker that cannot say which of the two was sent
 * confirms the wrong thing. `/quan-tri/cai-dat` distinguishes its two saves for
 * the same reason. `submitFeedbackAction` above keeps its `1` — `/gop-y` is a
 * page with one form on it, where there is nothing to tell apart.
 *
 * The book slug travels separately from the book id because the redirect needs
 * a URL and the command needs a key: the marker has to land back on the page
 * the reader was reading.
 */
export async function postCommentAction(form: FormData): Promise<void> {
  const shelf = String(form.get("tu-sach") ?? "");
  const bookSlug = String(form.get("sach") ?? "");
  // Escaped, as `profile-actions.ts` escapes its own slug. Not exploitable
  // here — both values are always prefixed by `/tu-sach/` — but a redirect
  // target assembled from form input is not the place to rely on that.
  const base = `/tu-sach/${encodeURIComponent(shelf)}/sach/${encodeURIComponent(bookSlug)}`;

  const code = await attempt(() =>
    submitCommand(shelf, createComment, {
      bookId: String(form.get("sach-id") ?? ""),
      membershipId: String(form.get("thanh-vien") ?? ""),
      body: String(form.get("noi-dung") ?? ""),
    }),
  );

  redirect(
    code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : `${base}?da-gui=binh-luan`,
  );
}

/** Tặng sách. A reader offers books; a manager decides later (OPS §4.4). */
export async function offerDonationAction(form: FormData): Promise<void> {
  const shelf = String(form.get("tu-sach") ?? "");
  const membershipId = String(form.get("thanh-vien") ?? "");
  const base = `/tu-sach/${shelf}/ho-so/tang-sach`;

  const raw = String(form.get("so-luong") ?? "").trim();
  const estimated = raw === "" ? null : Number(raw);

  const code = await attempt(() =>
    submitCommand(shelf, offerDonation, {
      membershipId,
      description: String(form.get("mo-ta") ?? ""),
      // A count nobody typed is null, and a count that is not a number is also
      // null rather than `NaN` — the column is an integer and OPS §4.4 calls
      // this "a rough count", so refusing a stray character would be a rule
      // nobody asked for about a field that is optional anyway.
      estimatedCount:
        estimated !== null && Number.isFinite(estimated) ? estimated : null,
    }),
  );

  redirect(code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : base);
}
