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
 * **Only the two password fields never come back.** Every other field the
 * blocks below post — `ten-dang-nhap`, `ten-thanh`, `ho-ten`, `ngay-sinh`,
 * `ten-cha`, `ten-me`, `dien-thoai`, and the two parish-unit selects — rides
 * back in the query string on a refusal, the same trick `dang-nhap/actions.ts`
 * already uses for `ten` on a failed sign-in.
 *
 * This reverses what this function used to do, on purpose and by name (Task 13,
 * 2026-08-10 QA remediation), and the reversal is worth recording rather than
 * quietly overwriting: the earlier version carried nothing back at all, on the
 * reasoning that a child's date of birth, both parents' names and a family
 * telephone number are sensitive enough that a query string — written into
 * browser history, into a proxy's access log, into the address bar of a shared
 * parish phone — is a real cost. That cost has not gone away and is still why
 * the two password fields stay out of it unconditionally; a password is
 * different in *kind*, not degree, from the rest of the form. What changed is
 * the other side of the scale: measured on 2026-08-10, submitting a 3-character
 * password came back with all nine fields empty, one of them the actual cause
 * and eight of them collateral, and a parent or a child retyping a date of
 * birth, two parents' names and a phone number over a mistyped password is the
 * kind of friction that ends a registration rather than completing it. Between
 * the two costs, this task chose the query string for everything but the
 * secret.
 */
export async function registerMembershipAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  if (shelfSlug === "") redirect("/tu-sach");

  // Read once, used both as `registerMembership`'s input and — on a refusal —
  // as what rides back in the query string. Keeping one set of variables
  // rather than reading the form twice is what keeps the two from silently
  // drifting apart the day a field is renamed.
  const username = optional(form, "ten-dang-nhap");
  const saintName = optional(form, "ten-thanh");
  const fullName = field(form, "ho-ten");
  const dateOfBirth = field(form, "ngay-sinh");
  const fatherName = field(form, "ten-cha");
  const motherName = field(form, "ten-me");
  const phone = field(form, "dien-thoai");
  const email = optional(form, "email");
  const parishUnitL1Id = optional(form, "parishUnitL1Id");
  const parishUnitL2Id = optional(form, "parishUnitL2Id");

  try {
    await submitCommand(shelfSlug, registerMembership, {
      // Credentials are optional: OPS §4.3 and the form both say so, because
      // most children never supply one and a manager can set them later.
      // `credentialsFrom` refuses one without the other by name.
      username,
      // Not trimmed — a password is bytes a person chose, and trimming one
      // silently changes the secret.
      password: raw(form, "mat-khau"),
      passwordConfirm: raw(form, "nhap-lai-mat-khau"),
      saintName,
      fullName,
      dateOfBirth,
      fatherName,
      motherName,
      phone,
      email,
      parishUnitL1Id,
      parishUnitL2Id,
    });
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      // `URLSearchParams`, not a hand-built template — `ho-ten`/`ten-cha`/
      // `ten-me` are Vietnamese text a person typed, free to contain `&`, `=`
      // or `%` as well as diacritics, and only `URLSearchParams` encodes all
      // of that correctly. `dang-nhap/actions.ts` made the same call for `ten`.
      const params = new URLSearchParams({
        "tu-sach": shelfSlug,
        [ACTION_ERROR_PARAM]: err.code,
      });
      for (const [name, value] of Object.entries({
        "ten-dang-nhap": username,
        "ten-thanh": saintName,
        "ho-ten": fullName,
        "ngay-sinh": dateOfBirth,
        "ten-cha": fatherName,
        "ten-me": motherName,
        "dien-thoai": phone,
        parishUnitL1Id,
        parishUnitL2Id,
      })) {
        if (value) params.set(name, value);
      }
      redirect(`/dang-ky?${params.toString()}`);
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
