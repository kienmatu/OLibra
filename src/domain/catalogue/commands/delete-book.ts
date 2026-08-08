import { NotFound, RuleViolated } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { requireManager } from "../policy";

/**
 * Soft-deletes a title and the copies that may follow it.
 *
 * **Q7, decided in this plan: implemented now, unexposed until E designs a
 * confirmation flow.** BR §13.2 grants the permission and BR §11 writes the
 * policy; leaving the command unwritten means the next person to want it
 * re-derives the copy-retention rule with no test to check them against.
 *
 * **`copy_has_history` is a retention rule, not a throw.** OPS §4.1 lists it
 * under Failure modes but describes it as "a copy with loan history is
 * retained rather than deleted", and BR §11's sentence — "A copy with loan
 * history cannot be removed." — is about the copy, not the book. So the book
 * goes, the copies with no history go with it (BR §11: "Only a book's copies
 * follow it when the book itself goes"), and the ones with history stay
 * exactly where they are. The counts are returned and audited so the screen
 * can say what happened rather than implying a clean sweep. No
 * `copy_has_history` error code exists, because nothing would ever throw it.
 *
 * Nothing here is a hard delete, and could not be: `olibra_app` holds no
 * `DELETE` privilege on `books` or `book_copies` (verified against
 * `information_schema.role_table_grants`).
 */
export const deleteBook: Command<
  { bookId: string },
  { copiesDeleted: number; copiesRetained: number }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  const [book] = await tx<{ id: string; title: string }[]>`
    select id, title from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  const busy = await tx`
    select 1 from book_copies
    where book_id = ${book.id}
      and deleted_at is null
      and state in ('on_loan', 'held')
  `;
  if (busy.length > 0) throw new RuleViolated("has_active_loans");

  // A copy is "with history" if any loan row references it — including a
  // returned or voided one. Loans are never deleted (INV-11), so this is the
  // permanent record BR §11 means.
  const deleted = await tx`
    update book_copies set deleted_at = now()
    where book_id = ${book.id}
      and deleted_at is null
      and not exists (select 1 from loans l where l.copy_id = book_copies.id)
  `.allowZero();

  const [{ retained }] = await tx<{ retained: number }[]>`
    select count(*)::int as retained from book_copies
    where book_id = ${book.id} and deleted_at is null
  `;

  await tx`update books set deleted_at = now() where id = ${book.id}`;

  const copiesDeleted = deleted.count ?? 0;

  return {
    result: { copiesDeleted, copiesRetained: retained },
    audit: {
      action: "book.deleted",
      entityType: "book",
      entityId: book.id,
      before: { title: book.title, deletedAt: null },
      after: {
        deletedAt: ctx.clock.now().toISOString(),
        copiesDeleted,
        copiesRetained: retained,
      },
    },
  };
};
