import { NotFound } from "../kernel/errors";
import type { TenantContext } from "../kernel/tenant";
import type { Tx } from "../kernel/unit-of-work";
import { copyCodePrefix, escapeLikePattern, formatCopyCode } from "./policy";

/**
 * Reserves the next `count` copy codes on this shelf, in order.
 *
 * **What makes this safe when two managers catalogue at the same second.**
 * `book_copies_code_unique` — `unique (bookshelf_id, code) where deleted_at
 * is null` — is the guarantee, and it works: probed live with two
 * connections racing a read-max-then-insert, one got `DT-0001` and the other
 * got `23505`. But a volunteer seeing "duplicate key value violates unique
 * constraint" for a race they did not cause is BR §2's "must fail cleanly
 * and see a plain message" being missed, and a retry loop around a failed
 * transaction is a lot of machinery for a shelf with two managers.
 *
 * `pg_advisory_xact_lock` is the cheaper answer: the second transaction
 * waits at this line, then reads a max that already includes the first one's
 * codes. The same probe with this line present produced `DT-0001` and
 * `DT-0002`, both committing. The lock is *transaction*-scoped, so the
 * kernel's commit or rollback releases it with nothing to remember, and it
 * is keyed on the shelf, so two parishes never queue behind each other.
 * `olibra_app` may call both `pg_advisory_xact_lock` and `hashtext` — checked
 * as that role, not assumed.
 *
 * The unique index stays the guarantee. This lock only stops the guarantee
 * from being experienced as an error message.
 *
 * **The scan deliberately does not filter `deleted_at is null`,** even
 * though the index does. A soft-deleted `DT-0215` is a code already printed
 * on a label and stuck to a physical book (BR §5.4: "intended to become a QR
 * label"); handing it out again is worse than leaving a gap in the sequence.
 */
export async function allocateCopyCodes(
  tx: Tx,
  ctx: TenantContext,
  count: number,
): Promise<string[]> {
  await tx`
    select pg_advisory_xact_lock(
      hashtext('olibra.copy_code'),
      hashtext(${ctx.bookshelfId})
    )
  `;

  const [shelf] = await tx<
    { slug: string; settings: Record<string, unknown> | null }[]
  >`select slug, settings from bookshelves where id = ${ctx.bookshelfId}`;
  if (!shelf) throw new NotFound("shelf_not_found");

  const prefix = copyCodePrefix(shelf);

  // `substring(code from '([0-9]+)$')` returns the capture group, or null for
  // a code that does not end in digits — `max` ignores those, so a shelf that
  // was imported with hand-written codes does not break the sequence.
  //
  // M7 (fix-report, 2026-08-08-b1-catalogue): `prefix` is free text from a
  // shelf's `copy_code_prefix` override (`settings`, not folded or
  // restricted to `[a-z0-9]`), so it can legitimately contain `_` —
  // Postgres's LIKE single-character wildcard. Unescaped, that would widen
  // this scan to any hand-imported code with a different letter in that
  // position, on this same shelf, inflating `max` past this prefix's own
  // sequence. `escapeLikePattern` escapes only `prefix`; the trailing `-%`
  // is the allocator's own, intentional wildcard and stays as-is.
  const [{ last }] = await tx<{ last: number }[]>`
    select coalesce(max(substring(code from '([0-9]+)$')::int), 0) as last
    from book_copies
    where bookshelf_id = ${ctx.bookshelfId}
      and code like ${escapeLikePattern(prefix) + "-%"} escape ${"\\"}
  `;

  // Padded here, not with SQL's `lpad`, which truncates on the right — see
  // formatCopyCode's docstring.
  return Array.from({ length: count }, (_, i) =>
    formatCopyCode(prefix, last + 1 + i),
  );
}
