import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";
import {
  register,
  registrationAudit,
  type RegistrationInput,
  type RegistrationResult,
} from "../registration";

/**
 * A manager fills in the registration form for a child standing in front of
 * them — BR §16.1: "A manager can also complete this form on behalf of a child
 * standing in front of them, which is the common case for the youngest
 * readers."
 *
 * **Creates a `pending` application, unlike `managerRegisterReader`.** BR §16.1
 * is explicit and this is not an inference: registering on behalf "still
 * creates a pending application rather than an active member, so the approval
 * step and its audit record are never skipped." A manager filling in a form is
 * not the same act as a manager approving it, and collapsing the two would mean
 * a minor's data is held without the separate consent step BR §4's assumption 3
 * describes.
 *
 * The two commands therefore disagree about `pending` on purpose. They serve
 * different moments: one is mid-lend with a book in hand, the other is filling
 * in a form.
 */
export const registerMemberOnBehalf: Command<
  RegistrationInput,
  RegistrationResult
> = async (tx, ctx, input) => {
  requireManager(ctx);
  const result = await register(tx, ctx, input, "pending");
  return { result, audit: registrationAudit(input, result, "pending") };
};
