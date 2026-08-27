"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "@/domain/kernel/errors";
import { renewLoan } from "@/domain/circulation/commands/renew-loan";
import { createBorrowRequest } from "@/domain/circulation/commands/create-borrow-request";
import { cancelOwnRequest } from "@/domain/circulation/commands/cancel-own-request";
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
    // `ValidationFailed` joins `RuleViolated` here for `createBorrowRequest`'s
    // sake: a `NotFound` for a book or a membership is a fault, but a refusal a
    // reader can actually cause — already in the queue, membership suspended —
    // is the ordinary outcome of pressing a button, not a 500.
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return err.code;
    }
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
  const base = `/tu-sach/${shelf}/ho-so/tong-quan`;

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
  const base = `/tu-sach/${shelf}/ho-so/thong-bao`;

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
  redirect(`/tu-sach/${shelf}/ho-so/thong-bao`);
}

/**
 * **"Xin mượn" — the button that has been dead since the page was drawn.**
 *
 * `createBorrowRequest` shipped in C2 fully implemented and tested, and was
 * called from nowhere; `every-domain-command-has-a-caller.test.ts` carried a
 * named exemption saying so. The visible cost was not only a disabled button:
 * `/quan-ly/yeu-cau-muon` is a queue with approve, reject and handover all
 * wired and tested, and no reader could put a single row in it, so the
 * **Yêu cầu mượn** badge in the manager's sidebar could only ever read zero.
 * The book page apologised for the button instead — "Nút này chưa dùng được.
 * Bạn nhắn cho quản lý tủ sách ở trên để mượn sách." — which is what a note
 * written in place of wiring looks like.
 *
 * **It does not matter whether a copy is free, and that is deliberate.**
 * `createBorrowRequest`'s own docstring is emphatic: OPS §4.2 covers both a
 * title with nothing on the shelf *and* a reader who "wants to queue even when
 * copies exist", and nothing in the command reads `book_copies`. So this action
 * is the same call in both states; only the button's wording differs, because
 * "go and collect it" and "join the queue" are different things to a child even
 * when they are one command.
 *
 * The redirect carries `?da-gui=xin-muon` rather than a bare `1`: the book page
 * has two forms landing on one URL now — this and the comment box — and a
 * marker that cannot say which one was sent would confirm the wrong thing. The
 * same reason `/quan-tri/cai-dat` distinguishes its two saves.
 */
export async function requestBorrowAction(formData: FormData): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  const slug = String(formData.get("sach") ?? "");
  const base = `/tu-sach/${encodeURIComponent(shelf)}/sach/${encodeURIComponent(slug)}`;

  const code = await attempt(() =>
    submitCommand(shelf, createBorrowRequest, {
      bookId: String(formData.get("sach-id") ?? ""),
      // Checked against `ctx.actor.membershipId` inside the command — its
      // docstring spells out why a caller-supplied id is not a scope.
      membershipId: String(formData.get("thanh-vien") ?? ""),
    }),
  );

  redirect(
    code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : `${base}?da-gui=xin-muon`,
  );
}

/**
 * **"Huỷ yêu cầu"** — `cancelOwnRequest`, which had no caller either.
 *
 * BR §7.2's `cancelled`, reachable from both states that lead to it: still
 * queueing, and holding a copy the manager has already set aside. The command
 * releases that hold in the same transaction — see its docstring for why a
 * request left `approved` would otherwise keep a book off the shelf for the
 * rest of `hold_days` with nobody left to hand it to.
 *
 * **`sach` is an optional slug, never a path.** Cancelling from the book page
 * comes back to the book page; cancelling from "Sách bạn đang chờ" on the
 * reader's own dashboard comes back there. A `"use server"` action that
 * redirected to a *path* a form supplied would be an open redirect, which is
 * the same rule `afterCommentDecision` (`quan-ly/actions.ts`) is written to.
 */
export async function cancelRequestAction(formData: FormData): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  const requestId = String(formData.get("yeu-cau") ?? "");
  const slug = String(formData.get("sach") ?? "");
  const base = slug
    ? `/tu-sach/${encodeURIComponent(shelf)}/sach/${encodeURIComponent(slug)}`
    : `/tu-sach/${encodeURIComponent(shelf)}/ho-so/tong-quan`;

  // Shape-checked before it reaches Postgres, exactly as `renewLoanAction`
  // above checks its own: a non-uuid is a `22P02` from inside the transaction,
  // which is the unstructured fault OPS §2 forbids.
  if (!isUuid(requestId)) {
    redirect(`${base}?${ACTION_ERROR_PARAM}=validation_failed`);
  }

  const code = await attempt(() =>
    submitCommand(shelf, cancelOwnRequest, { requestId }),
  );

  redirect(code ? `${base}?${ACTION_ERROR_PARAM}=${code}` : `${base}?da-huy=1`);
}
