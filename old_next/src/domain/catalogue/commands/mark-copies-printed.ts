import type { AuditEntry } from "../../kernel/audit";
import { ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

export interface MarkCopiesPrintedInput {
  copyIds: string[];
}

/**
 * Records that a label sheet was produced for these copies.
 *
 * **One audit entry for the batch, not one per copy** — deliberately unlike
 * `addCopies`, which OPS §4.1 requires to write one row per copy because each
 * copy genuinely came into existence separately. A print run is a single act by
 * a single volunteer at a single printer; four hundred rows saying so would
 * bury the log BR §14 exists to keep readable.
 *
 * **`printed` is the number of rows the update actually touched, which is not
 * necessarily `copyIds.length`.** RLS silently drops ids belonging to another
 * shelf, and a copy soft-deleted between the page rendering and the button
 * being pressed is gone too. The audit entry reports what happened rather than
 * what was asked for, so a log entry saying "in nhãn QR cho 3 bản sách" means
 * three rows moved.
 *
 * **The count is incremented, never set.** A reprint after a sticker falls off
 * has to stay distinguishable from a first print — that is the whole reason
 * `qr_print_count` exists beside `qr_printed_at` rather than a single boolean.
 */
export const markCopiesPrinted: Command<
  MarkCopiesPrintedInput,
  { printed: number }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (input.copyIds.length === 0) {
    throw new ValidationFailed("copy_selection_empty", "copyIds");
  }

  // `.allowZero()`, deliberately, and this is the one interesting line here.
  //
  // The kernel rejects an `UPDATE` that touches no rows (`guardPendingQuery`),
  // which is right for a write aimed at one named row: "mark DT-0142 lost" and
  // nothing happening is a lost target, not a result. This write is not that
  // shape. It is set-valued bookkeeping about a document that **already
  // exists** — the route has built the PDF bytes before calling this — so an
  // empty result is a fact to record, not a failure to raise. Failing here
  // would hand a volunteer a 500 for a sheet that printed perfectly.
  const rows = await tx<{ id: string }[]>`
    update book_copies
       set qr_printed_at  = now(),
           qr_print_count = qr_print_count + 1
     where id = any(${input.copyIds}::uuid[])
       and deleted_at is null
    returning id
  `.allowZero();

  const audit: AuditEntry[] = [
    {
      action: "copy.qr_printed",
      entityType: "copy",
      // A batch has no single subject. The first id is a stable, honest anchor
      // for a row whose sentence is about a count; `entityId` is nullable
      // precisely so an entry that names no one row does not have to invent a
      // sentinel that joins to nothing.
      entityId: rows[0]?.id ?? null,
      after: { count: rows.length },
    },
  ];

  return { result: { printed: rows.length }, audit };
};
