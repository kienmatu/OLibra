"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: the suite imports this module and
// Vitest resolves no alias.
import { cancelProfileChange } from "../../../../../domain/members/commands/cancel-profile-change";
import { changeOwnPassword } from "../../../../../domain/members/commands/change-own-password";
import { proposeProfileChange } from "../../../../../domain/members/commands/propose-profile-change";
import { updateOwnProfile } from "../../../../../domain/members/commands/update-own-profile";
import { DomainError } from "../../../../../domain/kernel/errors";
import {
  decideAndDiscardAvatar,
  proposeAvatar,
  type UploadedFile,
} from "../../../../../lib/avatar";
import { submitCommand } from "../../../../../lib/page-data";
import { ACTION_ERROR_PARAM } from "../../../../../lib/search-params";

/**
 * The reader's profile actions — and the project's **first server action that
 * carries a file**.
 *
 * Everything U1 established for the three circulation actions holds here
 * unchanged: one `submitCommand` per action, no permission check in this file
 * (both commands open with `requireSelfOrManager` and `requireIdentifiedActor`
 * inside the transaction that writes, and a second copy here would be a second
 * definition of who may change a person's photograph), `redirect()` outside
 * every `try` because it signals by throwing, and a refusal comes back to the
 * form as an `ErrorCode` in `?loi=` while a fault keeps throwing.
 *
 * ── The one thing that is new, and where it is not this file's ──────────────
 *
 * A file upload has an ordering problem no other action in this project has:
 * bytes are written to a store that has no transaction, in the same act as a row
 * written to a database that does. Both directions of getting that wrong lose
 * something — an orphaned object, or a live request pointing at a deleted image.
 * None of that reasoning is here. It is in `src/lib/avatar.ts`, which owns the
 * whole sequence, so that the screens this slice deliberately does not build
 * (plan §7) inherit the ordering instead of each re-deriving it. This file is
 * the form-shaped wrapper around two calls.
 *
 * ── Two error classes, not one ─────────────────────────────────────────────
 *
 * The circulation actions catch `RuleViolated` and rethrow everything else,
 * because a `ValidationFailed` there names a condition grade their form cannot
 * submit — a fault dressed as an answer. Here `ValidationFailed` is the *normal*
 * outcome of the two failure modes OPS §4.3 lists for `ProposeAvatarChange`:
 * `file_too_large` ("Ảnh vượt quá 2 MB.") and `invalid_image` ("Tệp này không
 * phải là ảnh hợp lệ.") are things a reader did and can undo by choosing another
 * file, and both are raised by `storeProposedAvatar` before any command runs. So
 * this action catches `DomainError` — the common parent of `RuleViolated`,
 * `ValidationFailed`, `NotFound` and `NotWired` — and matches on the class, not
 * on a code list that would go stale.
 *
 * `NotFound` never reaches the catch: `submitCommand` has already turned it into
 * `notFound()`, except for `write_target_not_found`, which is a fault. `NotWired`
 * would be caught here, and that is the one loss against the narrower catch —
 * accepted because the only setters it names are the password hasher and
 * verifier, neither of which is on this path. Every other exception — a
 * `PostgresError`, an S3 fault, a `TypeError` — propagates, so a store that is
 * down does not tell a reader their photograph was the wrong shape.
 */

/** `/tu-sach/<slug>/toi/ho-so`, from a slug that came in on the form. */
function profilePath(shelfSlug: string): string {
  return `/tu-sach/${encodeURIComponent(shelfSlug)}/toi/ho-so`;
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/**
 * Runs one step and reports whether the domain refused it — `attempt` in
 * `../../quan-ly/actions.ts`, with the wider catch this file's docstring
 * argues for. The `try` wraps the step and nothing else, so the `redirect()`
 * each caller performs afterwards cannot be swallowed by it.
 */
async function attempt(step: () => Promise<void>): Promise<string | null> {
  try {
    await step();
    return null;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
}

function back(shelfSlug: string, code: string | null): never {
  const path = profilePath(shelfSlug);
  redirect(code === null ? path : `${path}?${ACTION_ERROR_PARAM}=${code}`);
}

/**
 * OPS §4.3's `ProposeAvatarChange`.
 *
 * **`thanh-vien` is optional, and the reader's own form does not send it.** OPS
 * §4.3 lists a `membershipId` here — and not a `userId`, `users` having no
 * row-level security at all — because a manager may also set a photograph "when
 * registering on behalf". A reader proposing their own is the case where the
 * answer is already known: `ctx.actor.membershipId`, resolved from the session
 * cookie by `contextFor`. `proposeAvatarChange` defaults to it, so the reader's
 * form posts no identity at all, which is a stronger position than posting one
 * and comparing it — there is nothing in the request to rewrite.
 *
 * An absent or empty file is `validation_failed` rather than a crash on
 * `file.size`: a form posting no file is this application's own doing, exactly
 * as `complete()` in `../../quan-ly/actions.ts` argues for the hidden ids there.
 */
export async function proposeAvatarAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const file = form.get("anh");

  if (shelfSlug === "" || !isUploadedFile(file)) {
    back(shelfSlug, "validation_failed");
  }

  const code = await attempt(() =>
    proposeAvatar(shelfSlug, membershipId === "" ? undefined : membershipId, file),
  );
  back(shelfSlug, code);
}

/**
 * OPS §4.3's `CancelProfileChange` — the reader withdrawing their own proposal,
 * and the half of the avatar's lifecycle that has to *remove* an object.
 *
 * Routed through `decideAndDiscardAvatar` rather than `submitCommand` directly,
 * so the delete happens after the commit and cannot be forgotten. See
 * `src/lib/avatar.ts`.
 */
export async function cancelProfileChangeAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  const profileChangeRequestId = field(form, "yeu-cau");

  if (shelfSlug === "" || membershipId === "" || profileChangeRequestId === "") {
    back(shelfSlug, "validation_failed");
  }

  const code = await attempt(async () => {
    await decideAndDiscardAvatar(shelfSlug, cancelProfileChange, {
      membershipId,
      profileChangeRequestId,
    });
  });
  back(shelfSlug, code);
}

/**
 * Whether the multipart field is a file with bytes in it.
 *
 * A form submitted with the file input untouched posts an entry that is a `File`
 * of size zero with an empty name, not an absent one — so `instanceof File`
 * alone answers yes to "no photograph chosen", which is why the size is checked
 * here and not only in `storeProposedAvatar`.
 *
 * Structural rather than `instanceof File`, and that is a decision. The three
 * members `UploadedFile` names are the whole of what this path consumes, so a
 * suite can drive the size refusal with a plain object declaring
 * `size: 2 * 1024 * 1024 + 1` instead of materialising two megabytes of real
 * bytes to prove a comparison. Nothing is given up: a value reaching a server
 * action's `FormData` is either a string or a `File`, and a string fails the
 * `arrayBuffer` check.
 */
function isUploadedFile(value: unknown): value is UploadedFile {
  if (value === null || typeof value !== "object") return false;
  const file = value as { size?: unknown; type?: unknown; arrayBuffer?: unknown };
  return (
    typeof file.size === "number" &&
    file.size > 0 &&
    typeof file.type === "string" &&
    typeof file.arrayBuffer === "function"
  );
}

/**
 * OPS §4.3's `ProposeProfileChange` — **Gửi đề nghị thay đổi**, the button the
 * shipped form has had since U1 with no action behind it.
 *
 * **Every proposable field is sent, always, and the command decides what
 * changed.** The alternative — comparing against what the page rendered and
 * sending only the differences — puts the definition of "changed" in a React
 * component, where `normaliseProfilePatch`'s trimming and `empty_proposal`'s
 * comparison against the person *as stored* cannot be applied. The command
 * already filters a field proposed at its current value ("a field proposed at
 * its current value is not a proposal"), so sending all seven and changing none
 * comes back as `empty_proposal`, which is the sentence the reader should read.
 *
 * `null` for an emptied box, not `""`: `ProfilePatch` is `string | null`, and
 * `null` is how the domain spells "clear this". An empty string would be stored
 * as an empty string and a manager would approve a person into having a
 * zero-length name.
 */
export async function proposeProfileChangeAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  if (shelfSlug === "" || membershipId === "") {
    back(shelfSlug, "validation_failed");
  }

  const value = (name: string): string | null => {
    const v = field(form, name);
    return v === "" ? null : v;
  };

  const code = await attempt(async () => {
    await submitCommand(shelfSlug, proposeProfileChange, {
      membershipId,
      fields: {
        saint_name: value("ten-thanh"),
        full_name: value("ho-ten"),
        date_of_birth: value("ngay-sinh"),
        father_name: value("ten-cha"),
        mother_name: value("ten-me"),
        phone: value("dien-thoai"),
        email: value("email"),
      },
    });
  });
  back(shelfSlug, code);
}

/**
 * OPS §4.3's `UpdateOwnProfile` — BR §16.2's leaderboard toggle, the one thing
 * on this page that takes effect without a manager.
 *
 * A checkbox posts its name only when checked, so the absent case *is* the
 * value `false` rather than a missing field — `form.has` is what distinguishes
 * "unchecked" from "this form does not have the control", and the two produce
 * the same `FormData` entry (none). The submit is the whole form, so unchecked
 * genuinely means off.
 */
export async function updateOwnProfileAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  if (shelfSlug === "" || membershipId === "") {
    back(shelfSlug, "validation_failed");
  }

  const code = await attempt(async () => {
    await submitCommand(shelfSlug, updateOwnProfile, {
      membershipId,
      leaderboardOptIn: form.has("bang-xep-hang"),
    });
  });
  back(shelfSlug, code);
}

/**
 * OPS §4.3's `ChangeOwnPassword`.
 *
 * **Nothing about it goes into the query string on the way back** — not the
 * password, and not a "which box was wrong" hint beyond the command's own code.
 * `back` puts only an `ErrorCode` in `?loi=`, and `wrong_password` /
 * `new_password_too_short` are both already-shipped sentences. This page's own
 * docstring makes the same argument the registration form does about a shared
 * parish phone's address bar.
 */
export async function changeOwnPasswordAction(form: FormData): Promise<void> {
  const shelfSlug = field(form, "tu-sach");
  const membershipId = field(form, "thanh-vien");
  if (shelfSlug === "" || membershipId === "") {
    back(shelfSlug, "validation_failed");
  }

  const code = await attempt(async () => {
    await submitCommand(shelfSlug, changeOwnPassword, {
      membershipId,
      // Not trimmed. A password is bytes a person chose, and trimming one
      // silently changes the secret — `field()` above trims, so these read the
      // form directly.
      currentPassword: String(form.get("mat-khau-cu") ?? ""),
      newPassword: String(form.get("mat-khau-moi") ?? ""),
    });
  });
  back(shelfSlug, code);
}
