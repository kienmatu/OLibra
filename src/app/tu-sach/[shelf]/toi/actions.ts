"use server";

import { redirect } from "next/navigation";
import { RuleViolated } from "@/domain/kernel/errors";
import { renewLoan } from "@/domain/circulation/commands/renew-loan";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/domain/notifications/commands/mark-notification-read";
import { submitCommand } from "@/lib/page-data";
import { ACTION_ERROR_PARAM, isUuid } from "@/lib/search-params";

/**
 * The reader's own writes. Same contract every action in this app follows
 * (U1 §3.3): a `RuleViolated` comes back as a **code** the page renders through
 * `messageFor`, and anything else keeps throwing — swallowing a `PostgresError`
 * into a friendly Vietnamese sentence tells a child their input was wrong when
 * the database was down.
 */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof RuleViolated) return err.code;
    throw err;
  }
}

/**
 * "Xin gia hạn" — C3's command, reachable at last.
 *
 * The dashboard already disables the button when `renewBlockedBy` is set, and
 * this re-checks anyway: the queue can gain somebody in the seconds between the
 * page rendering and the tap, and a command is a contract with every future
 * caller rather than with the one screen that exists today. When it refuses,
 * the code is the same one `getMyDashboard` would have reported, because both
 * come from `loanRenewable`.
 */
export async function renewLoanAction(formData: FormData): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  const loanId = String(formData.get("muon") ?? "");
  const base = `/tu-sach/${shelf}/toi`;

  // Shape-checked before it reaches Postgres: a non-uuid would arrive as a raw
  // `22P02` from inside the transaction, the unstructured exception OPS §2
  // forbids.
  if (!isUuid(loanId)) {
    redirect(`${base}?${ACTION_ERROR_PARAM}=validation_failed`);
  }

  const code = await attempt(() => submitCommand(shelf, renewLoan, { loanId }));
  redirect(code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : base);
}

/** The bell. Marking read is a no-op on somebody else's notification, by design. */
export async function markNotificationReadAction(
  formData: FormData,
): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  const notificationId = String(formData.get("thong-bao") ?? "");
  const base = `/tu-sach/${shelf}/toi/thong-bao`;

  if (!isUuid(notificationId)) redirect(base);

  await attempt(() =>
    submitCommand(shelf, markNotificationRead, { notificationId }),
  );
  redirect(base);
}

export async function markAllNotificationsReadAction(
  formData: FormData,
): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  await attempt(() => submitCommand(shelf, markAllNotificationsRead, undefined));
  redirect(`/tu-sach/${shelf}/toi/thong-bao`);
}
