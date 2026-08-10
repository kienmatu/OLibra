import type { Command } from "../../kernel/unit-of-work";
import { assertPhone } from "../../members/policy";
import { checkPolicyBound } from "../policy";

/**
 * OPS §4.5's two writes to `system_settings` — the installation's own row.
 *
 * Both are **global** by nature: there is no shelf to scope them to, and
 * `runAdminCommand` therefore requires the caller to hold no shelf scope before
 * it will write the null-`bookshelf_id` audit entry each of them declares.
 *
 * The row is created by the migration and never by these commands, so both are
 * plain `update`s and the kernel's zero-row guard is a real check rather than a
 * formality: a `count` of zero here means the singleton row is missing, which is
 * a fault and not a business outcome.
 */

export interface SiteContactInput {
  contactName: string | null;
  contactPhone: string | null;
  contactHours: string | null;
}

/**
 * The administration's own contact block — what `/lien-he` shows a stranger,
 * and what a parish with no shelf yet uses to ask for one.
 *
 * Every field is nullable and all three are written together, so clearing one is
 * expressible. That is the same all-or-nothing shape `updateBookshelfSettings`
 * uses for a shelf's profile, and for the identical reason: `null` is a value a
 * person means, and this codebase's `Tx` cannot carry a per-column SQL fragment.
 */
export const updateSiteContact: Command<SiteContactInput, void> = async (
  tx,
  ctx,
  input,
) => {
  const trimmed = {
    name: input.contactName?.trim() || null,
    phone: input.contactPhone?.trim() || null,
    hours: input.contactHours?.trim() || null,
  };

  // QA remediation Task 18. `contactPhone` is nullable and clearing it is a
  // real edit (see `SiteContactInput`'s own docstring on why all three fields
  // move together), so the check applies only once a caller actually supplies
  // a nonempty number — this is `/lien-he`'s own published number, so a bad
  // value here is a public-facing dead phone link, not merely an internal one.
  if (trimmed.phone !== null) {
    assertPhone(trimmed.phone, "contactPhone");
  }

  await tx`
    update system_settings
       set contact_name  = ${trimmed.name},
           contact_phone = ${trimmed.phone},
           contact_hours = ${trimmed.hours},
           changed_by    = ${ctx.actor.userId},
           changed_at    = ${ctx.clock.now()}
     where id
  `;

  return {
    result: undefined,
    audit: {
      action: "site_contact.updated",
      entityType: "system_settings",
      // A singleton whose primary key is the boolean `true`: no uuid to name.
      entityId: null,
      before: null,
      // The telephone number is deliberately not in the payload. It is the one
      // field here a person could be identified by, BR §14 asks the log to
      // record what changed rather than duplicate it, and the current value is
      // one read away on the page this action returns to.
      after: { has_contact: trimmed.name !== null },
      // No shelf, and `runAdminCommand` refuses a non-global entry under an
      // empty scope rather than binding an empty string into a `uuid` column.
      global: true,
    },
  };
};

export interface SystemDefaultsInput {
  loanDays: number;
  maxConcurrentLoans: number;
  holdDays: number;
}

/**
 * The lending policy a **newly created** shelf starts with.
 *
 * **It changes no existing shelf, and that is the whole design.**
 * `createBookshelf` copies these three values into `bookshelves.settings` at
 * creation; every command that reads a policy reads that per-shelf bag with its
 * own `coalesce` default. A shelf that pointed at this row instead would change
 * its lending policy for every parish at once, the day somebody edited a number
 * here, weeks after anyone made a decision about it — and nobody would be told.
 *
 * The page says so, because a screen labelled "Cài đặt mặc định" is otherwise
 * read as "the settings".
 */
export const updateSystemDefaults: Command<SystemDefaultsInput, void> = async (
  tx,
  ctx,
  input,
) => {
  // QA remediation Task 15: this used to accept any non-negative integer —
  // `loanDays: 0` included — under the generic `validation_failed`, the same
  // defect and the same fix `updateBookshelfSettings` gets below. The three
  // explicit calls, not a loop over `Object.entries(input)` as this used to
  // be, are what let each of `loanDays`, `maxConcurrentLoans` and `holdDays`
  // check against its *own* range: `Object.entries` would need a second table
  // mapping this input's camelCase keys to `PolicyField`'s snake_case ones,
  // which `checkPolicyBound` (`../policy.ts`) already owns as the jsonb column
  // names `updateBookshelfSettings` writes verbatim.
  checkPolicyBound("loan_days", input.loanDays);
  checkPolicyBound("max_concurrent_loans", input.maxConcurrentLoans);
  checkPolicyBound("hold_days", input.holdDays);

  await tx`
    update system_settings
       set default_loan_days            = ${input.loanDays},
           default_max_concurrent_loans = ${input.maxConcurrentLoans},
           default_hold_days            = ${input.holdDays},
           changed_by                   = ${ctx.actor.userId},
           changed_at                   = ${ctx.clock.now()}
     where id
  `;

  return {
    result: undefined,
    audit: {
      action: "system_settings.updated",
      entityType: "system_settings",
      // A singleton whose primary key is the boolean `true`: no uuid to name.
      entityId: null,
      before: null,
      after: {
        loan_days: input.loanDays,
        max_concurrent_loans: input.maxConcurrentLoans,
        hold_days: input.holdDays,
      },
      global: true,
    },
  };
};
