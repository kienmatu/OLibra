import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { type CopyState, copyStateTransition, requireManager } from "../policy";

/**
 * A lost copy turns up again (BR §7.1: `lost → available`).
 *
 * BR §3 lists "a book reported lost is found months later" as a case the
 * system must handle, and BR §16.3 added the shelf-wide **Sách đã mất** view
 * precisely because finding one lost copy from inside each book's own page
 * was not realistic.
 *
 * **The loan is not reopened.** BR §7.3 draws no arrow out of `lost` for a
 * loan, and INV-11 forbids deleting one. The copy comes back; what happened
 * to it stays on the record.
 */
export const markCopyFound: Command<
  { copyId: string; note?: string | null },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [copy] = await tx<{ id: string; state: CopyState }[]>`
    select id, state from book_copies where id = ${input.copyId} and deleted_at is null
  `;
  if (!copy) throw new NotFound("copy_not_found");

  const move = copyStateTransition(copy.state, "available");
  if (!move.allowed || copy.state !== "lost") {
    throw new RuleViolated(copy.state === "lost" ? move.reason! : "not_lost");
  }

  await tx`
    update book_copies set state = 'available', lost_reported_at = null
    where id = ${copy.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "copy.found",
      entityType: "copy",
      entityId: copy.id,
      before: { state: "lost" },
      after: { state: "available", note: input.note ?? null },
    },
  };
};
