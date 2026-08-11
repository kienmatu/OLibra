"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: the suite imports these modules
// directly and Vitest resolves no alias.
import { RuleViolated, ValidationFailed } from "../../domain/kernel/errors";
import { registerMembership } from "../../domain/members/commands/register-membership";
import { submitCommand } from "../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../lib/search-params";

/**
 * OPS §4.3's `RegisterMembership` — the form a stranger fills in, and the one
 * write in this application reached by somebody with no session and no
 * membership anywhere.
 *
 * **The shelf comes from the form, and it has to.** `submitCommand` derives the
 * tenant from a slug, and every other caller takes that slug from the URL it was
 * posted from. `/dang-ky` has no shelf in its path — a person arrives at it from
 * the portal, having just chosen their parish — so the slug travels in a hidden
 * field. That is not a weakening: `contextFor` resolves it against
 * `bookshelves_public_read`, so an unknown or archived slug is
 * `shelf_not_found` and a 404, and the resulting membership is `pending`
 * regardless. A stranger naming a different parish's slug registers for that
 * parish and waits for *its* manager, which is what choosing a parish means.
 *
 * **`ValidationFailed` is caught, not only `RuleViolated`.** This whole form is
 * a person typing, so a malformed date, a mismatched password confirmation and
 * a missing required field are the ordinary outcomes rather than signs the
 * surface sent something impossible. Same widening `attemptTyped` makes in
 * `../tu-sach/[shelf]/quan-ly/actions.ts`, for the same reason.
 *
 * **Nothing typed comes back on a refusal.** These are a child's date of birth,
 * both parents' names, a family telephone number and possibly a password — and
 * a query string is written into browser history, into a proxy's access log and
 * into the address bar of a shared parish phone. The form is re-typed instead.
 * The same call U3 recorded for the on-behalf form, and the cost is the same
 * and real.
 *
 * **Proposed and withdrawn once already (Task 13, 2026-08-10 QA remediation).**
 * A same-session task carried every field but the password back through this
 * same query string, reasoning from the QA sweep's observation that a rejected
 * registration cleared all nine fields — without re-reading this paragraph
 * first. It shipped, was caught in the same task's own self-review, and was
 * reverted before merge on exactly the ground stated above: the next child to
 * pick up a shared parish phone would see the previous child's mother's name
 * and telephone number in the address bar, and browser history and a proxy's
 * access log make that permanent rather than momentary. If this is proposed
 * again, the fix that gets the UX without the leak is a short-lived
 * same-origin cookie or `useActionState` — neither touches the URL — and it is
 * a design decision for its own task with the product owner's input, not a
 * quick change here.
 */
export async function registerMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  if (shelfSlug === "") redirect("/tu-sach");

  try {
    await submitCommand(shelfSlug, registerMembership, {
      // Credentials are optional: OPS §4.3 and the form both say so, because
      // most children never supply one and a manager can set them later.
      // `credentialsFrom` refuses one without the other by name.
      username: optional(form, "ten-dang-nhap"),
      // Not trimmed — a password is bytes a person chose, and trimming one
      // silently changes the secret.
      password: raw(form, "mat-khau"),
      passwordConfirm: raw(form, "nhap-lai-mat-khau"),
      saintName: optional(form, "ten-thanh"),
      fullName: field(form, "ho-ten"),
      dateOfBirth: field(form, "ngay-sinh"),
      fatherName: field(form, "ten-cha"),
      motherName: field(form, "ten-me"),
      phone: field(form, "dien-thoai"),
      email: optional(form, "email"),
      // `ParishUnitFields` posts these names, and posts "" for "— Không chọn —".
      parishUnitL1Id: optional(form, "parishUnitL1Id"),
      parishUnitL2Id: optional(form, "parishUnitL2Id"),
    });
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      redirect(
        `/dang-ky?tu-sach=${encodeURIComponent(shelfSlug)}&${ACTION_ERROR_PARAM}=${err.code}`,
      );
    }
    throw err;
  }

  // Not to the shelf, and not signed in. The membership is `pending`, so every
  // shelf page would refuse it and `loadPage` would send them back to sign in —
  // a loop, on the one journey this form exists to start. `?da-gui=1` is the
  // same acknowledgement the feedback form uses.
  redirect(`/dang-ky?tu-sach=${encodeURIComponent(shelfSlug)}&da-gui=1`);
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function optional(form: FormData, name: string): string | null {
  const value = field(form, name);
  return value === "" ? null : value;
}

/** Untrimmed, for the two fields where whitespace is part of the value. */
function raw(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "");
  return value === "" ? null : value;
}
