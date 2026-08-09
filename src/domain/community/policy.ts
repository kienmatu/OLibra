import { NotFound } from "../kernel/errors";
import type { Tx } from "../kernel/unit-of-work";

/**
 * `comment_status` as the schema spells it (`0006_community.sql:7`).
 *
 * The order matters to nothing, but the set does: INV-9 is "a comment is
 * publicly visible only when *approved*", so `approved` is the one value the
 * member-facing query may return and the other three are all, in their own way,
 * "not shown".
 */
export const COMMENT_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "hidden",
] as const;

export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/**
 * BR §5.5's `comments_require_approval`, defaulting to **true**.
 *
 * The default is the safe direction and the requirements chose it that way: a
 * shelf that has never opened its settings screen moderates. Turning it off is
 * a deliberate act by somebody who has decided their parish does not need it,
 * and OPS §4.4 makes that the only way a comment starts life `approved`.
 *
 * Read from the shelf row rather than passed in, the same shape
 * `../circulation/settings.ts` uses and for the same reason — one place knows
 * where policy configuration lives.
 */
export async function commentsRequireApproval(
  tx: Tx,
  bookshelfId: string,
): Promise<boolean> {
  const [row] = await tx<{ requires: boolean }[]>`
    select coalesce((settings->>'comments_require_approval')::boolean, true)
             as requires
      from bookshelves where id = ${bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return row.requires;
}

/**
 * BR §5.5's `comments_enabled`, defaulting to **true**.
 *
 * Distinct from the setting above, and the distinction is the point: a shelf can
 * moderate comments, or it can decline to take them at all. OPS §4.4 gives the
 * second case its own refusal — `comments_disabled`, "Tủ sách hiện không nhận
 * bình luận." — which is a sentence about the shelf's choice rather than about
 * anything the reader did wrong.
 */
export async function commentsEnabled(
  tx: Tx,
  bookshelfId: string,
): Promise<boolean> {
  const [row] = await tx<{ enabled: boolean }[]>`
    select coalesce((settings->>'comments_enabled')::boolean, true) as enabled
      from bookshelves where id = ${bookshelfId}
  `;
  if (!row) throw new NotFound("shelf_not_found");
  return row.enabled;
}
