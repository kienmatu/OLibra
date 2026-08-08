import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import {
  register,
  registrationAudit,
  type RegistrationInput,
  type RegistrationResult,
} from "../registration";

/**
 * A manager registers a reader in person, from the quick-lend flow's "Đăng ký
 * người đọc mới" escape hatch (BR §16.3) or the readers list.
 *
 * **Creates an `active` membership, not a `pending` one.** OPS §4.3: this
 * exists "specifically so a manager standing at the shelf can lend to a
 * brand-new reader in the same visit — the entire point of the three-tap
 * quick-lend flow (§1.3)", and a `pending` member cannot be lent to (INV-4),
 * so a pending result would defeat the affordance's own purpose.
 *
 * **OPS flags this as an inference, and so does this file.** BR §4's
 * assumption 3 — "a manager approving a registration constitutes the consent
 * needed to hold a minor's data" — is worded around *approving*, which implies
 * a two-step flow even here; nothing in BR §7.5 or §16.3 says the escape hatch
 * skips `pending`. OPS infers immediate-active status from BR §1.3's UX intent
 * and says so. Implemented as OPS specifies. If the product owner says
 * otherwise, the change is `"active"` → `"pending"` below and one assertion.
 *
 * `approved_by` and `approved_at` are set to this manager and this clock by
 * `register`, so an active membership never looks as though it approved itself.
 */
export const managerRegisterReader: Command<
  RegistrationInput,
  RegistrationResult
> = async (tx, ctx, input) => {
  requireManager(ctx);
  const result = await register(tx, ctx, input, "active");
  return { result, audit: registrationAudit(input, result, "active") };
};
