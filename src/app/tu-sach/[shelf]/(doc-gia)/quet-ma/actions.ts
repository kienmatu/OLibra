"use server";

import { redirect } from "next/navigation";
import { createBorrowRequest } from "../../../../../domain/circulation/commands/create-borrow-request";
import {
  RuleViolated,
  ValidationFailed,
} from "../../../../../domain/kernel/errors";
import { ACTION_ERROR_PARAM } from "../../../../../lib/search-params";
import { submitCommand } from "../../../../../lib/page-data";

/**
 * The same contract every action in this app follows (U1 §3.3): a refusal a
 * reader can actually cause comes back as a **code** the page renders through
 * `messageFor`, and anything else keeps throwing.
 *
 * A local copy of `ho-so/reader-actions.ts`'s helper rather than an import of
 * it: that module is `"use server"`, where every *export* must be an async
 * server action, so a shared helper cannot be exported from it without becoming
 * one. Six lines duplicated is the cheaper of the two mistakes available here.
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
 * How long a scan stays good for.
 *
 * **The timestamp is deliberately unsigned, and that is a decision rather than
 * an omission.** Forging it buys a stale scan and nothing else:
 * `createBorrowRequest` re-reads the copy, the title, the membership's standing
 * and the reader's existing requests when it runs, so an old `luc` cannot
 * produce a request the command would otherwise have refused. Signing it would
 * be ceremony protecting nothing.
 *
 * The window exists for an ordinary reason, not a security one: a tab left open
 * on a phone after Sunday mass must not produce a request on Monday for a book
 * that went back on the shelf in between.
 */
const WINDOW_MS = 5 * 60 * 1000;

/**
 * **"Xác nhận xin mượn bản này"** — the reader's end of BR §19's QR labels.
 *
 * The same command the title page's "Xin mượn" calls, with `copyId` set. It is
 * not a different request: OPS §4.2's `CreateBorrowRequest` covers both, and
 * the copy is recorded so a manager can see which physical book is in the
 * child's hands rather than only which title was wanted.
 *
 * A second step by design. A request created by the *act of scanning* would
 * make every mis-scan — a neighbouring sticker, a shelf brushed past — a row a
 * manager has to reject.
 */
export async function confirmScanBorrowAction(formData: FormData): Promise<void> {
  const shelf = String(formData.get("tu-sach") ?? "");
  const copyId = String(formData.get("ban") ?? "");
  const base = `/tu-sach/${encodeURIComponent(shelf)}/quet-ma`;
  const back = `${base}?ban=${encodeURIComponent(copyId)}`;

  const scannedAt = Number(formData.get("luc"));
  if (!Number.isFinite(scannedAt) || Date.now() - scannedAt > WINDOW_MS) {
    redirect(`${base}?qua-han=1`);
  }

  const code = await attempt(() =>
    submitCommand(shelf, createBorrowRequest, {
      bookId: String(formData.get("sach-id") ?? ""),
      // Checked against `ctx.actor.membershipId` inside the command — a
      // caller-supplied id is not a scope.
      membershipId: String(formData.get("thanh-vien") ?? ""),
      copyId,
    }),
  );

  redirect(
    code
      ? `${back}&${ACTION_ERROR_PARAM}=${code}`
      : `/tu-sach/${encodeURIComponent(shelf)}/ho-so/tong-quan?da-gui=xin-muon`,
  );
}
