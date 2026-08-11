import type { AuditEntry } from "../../kernel/audit";
import { NotFound, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { allocateCopyCodes } from "../copy-codes";
import { assertSingleDonor, requireManager } from "../policy";
import type { DonorInput } from "./create-book";

export interface AddCopiesInput extends DonorInput {
  bookId: string;
  count: number;
}

/**
 * Adds physical copies to an already-catalogued title.
 *
 * Separate from `CreateBook` for the reason OPS §4.1 gives and BR §16.3
 * repeats: "a second donated copy of a popular book arrives months after the
 * first, and editing the title is not where a volunteer would look for that."
 * Its donor fields are its own, not the title's — the second copy's giver is
 * frequently not the first copy's.
 *
 * One audit entry per copy, per OPS §4.1: "the record affected is singular
 * per entry, so a batch of five new copies is five audit rows".
 */
export const addCopies: Command<
  AddCopiesInput,
  { copyIds: string[]; codes: string[] }
> = async (tx, ctx, input) => {
  requireManager(ctx);

  if (!Number.isInteger(input.count) || input.count < 1) {
    throw new ValidationFailed("copy_count_invalid", "count");
  }
  // QA remediation Task 19: see `assertSingleDonor`'s own docstring
  // (`../policy.ts`). Shared with `CreateBook` — `DonorInput` is the same
  // type both this command and that one take.
  assertSingleDonor(input.donorMembershipId, input.donorName);

  // Scoped by RLS to this shelf, so a book on another shelf is simply not
  // here — which is the right answer to give (OPS §2), not a different one.
  const [book] = await tx<{ id: string }[]>`
    select id from books where id = ${input.bookId} and deleted_at is null
  `;
  if (!book) throw new NotFound("book_not_found");

  const codes = await allocateCopyCodes(tx, ctx, input.count);
  const acquiredOn = input.acquiredOn ?? ctx.clock.today();

  const copies = await tx<{ id: string; code: string }[]>`
    insert into book_copies (
      bookshelf_id, book_id, code, state, condition,
      acquired_on, acquired_from, acquired_from_membership_id
    )
    select
      ${ctx.bookshelfId}, ${book.id}, c, 'available', 'perfect',
      ${acquiredOn}::date, ${input.donorName ?? null},
      ${input.donorMembershipId ?? null}
    from unnest(${codes}::text[]) as c
    returning id, code
  `;

  const audit: AuditEntry[] = copies.map((copy) => ({
    action: "copy.added",
    entityType: "copy",
    entityId: copy.id,
    after: {
      code: copy.code,
      bookId: book.id,
      state: "available",
      acquiredOn,
      acquiredFrom: input.donorName ?? null,
      acquiredFromMembershipId: input.donorMembershipId ?? null,
    },
  }));

  return { result: { copyIds: copies.map((c) => c.id), codes }, audit };
};
