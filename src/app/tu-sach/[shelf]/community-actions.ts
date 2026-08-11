"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "@/domain/kernel/errors";
import { submitFeedback } from "@/domain/community/commands/feedback";
import { offerDonation } from "@/domain/community/commands/donations";
import { submitCommand } from "@/lib/page-data";
import { ACTION_ERROR_PARAM } from "@/lib/search-params";

/**
 * The two community writes a reader makes from a shelf page.
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
