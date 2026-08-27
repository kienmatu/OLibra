import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import type { CopyState } from "../policy";

export interface ScannedCopy {
  id: string;
  code: string;
  state: CopyState;
  bookId: string;
  bookSlug: string;
  title: string;
  author: string | null;
}

/**
 * A scanned copy, or nothing.
 *
 * **Takes a UUID, not a QR payload.** Decoding lives in `src/lib/qr.ts`; the
 * domain layer never learns that the identifier arrived base64-encoded behind
 * an `OLB1:` prefix. That is what lets the printed format change — a future
 * `OLB2:` — without touching a single query.
 *
 * **No `requireManager`, and that is the point of this query rather than an
 * omission.** A reader scans a book on the shelf to ask for it (BR §16.1), so
 * this read is available to any viewer the shelf's own context already admits.
 * RLS is what makes that safe: another parish's sticker resolves to `null`
 * here, and the screen says so in words instead of raising.
 *
 * A soft-deleted copy answers `null` for the same reason a missing one does —
 * the sticker is on a book this shelf no longer circulates, and the volunteer
 * needs the same "we do not know this one" either way. Telling those two apart
 * would be telling a stranger which copies this shelf used to hold.
 */
export async function resolveCopyById(
  tx: Tx,
  ctx: TenantContext,
  copyId: string,
): Promise<ScannedCopy | null> {
  // Scoping is RLS's, through `tx`; `ctx` is part of the query signature every
  // other read in this folder shares, and taking it keeps the seam uniform.
  void ctx;

  const [row] = await tx<
    {
      id: string;
      code: string;
      state: CopyState;
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
    }[]
  >`
    select c.id, c.code, c.state, c.book_id, b.slug, b.title, b.author
    from book_copies c
    join books b on b.id = c.book_id and b.deleted_at is null
    where c.id = ${copyId} and c.deleted_at is null
  `;

  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    state: row.state,
    bookId: row.book_id,
    bookSlug: row.slug,
    title: row.title,
    author: row.author,
  };
}
