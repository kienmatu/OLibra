import type { Command } from "../../kernel/unit-of-work";
import {
  register,
  registrationAudit,
  type RegistrationInput,
  type RegistrationResult,
} from "../registration";

/**
 * Public self-registration (BR §16.1, `src/app/dang-ky/page.tsx`). Creates a
 * `pending` membership a manager must approve — BR §4's assumption 3 makes
 * that approval "the consent needed to hold a minor's data", so it is never
 * skipped.
 *
 * **The caller is a `guest`, and there is no role gate here on purpose.** Every
 * other command in this slice opens with `requireManager` or
 * `requireSelfOrManager`; this one is the single open door OPS §2 leaves in the
 * catalogue, and adding a gate would close the registration form.
 *
 * **Q6 — is this rate-limited? Not in the domain.** Master §5's assumed
 * reading, and OPS §8 records honestly that neither source document confirms
 * it. The defences that do exist are structural rather than a limit:
 * `users_username_key` (case-insensitive, live), `memberships_one_per_shelf`
 * (a repeat is a re-application against the existing row, never a pile of
 * them), and the identity-match rules in `../registration.ts`, which tell a
 * caller nothing about who already exists. What is genuinely missing — an
 * unauthenticated caller can create unlimited *new* people by varying the
 * name — belongs at the edge, and the plan records it as a gap for E rather
 * than as something this command quietly handles.
 */
export const registerMembership: Command<
  RegistrationInput,
  RegistrationResult
> = async (tx, ctx, input) => {
  const result = await register(tx, ctx, input, "pending");
  return { result, audit: registrationAudit(input, result, "pending") };
};
