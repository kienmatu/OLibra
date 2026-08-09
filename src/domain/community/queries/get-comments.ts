import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager, requireReader } from "../../catalogue/policy";

export interface CommentRow {
  id: string;
  body: string;
  authorName: string;
  createdAt: Date;
}

export interface PendingCommentRow extends CommentRow {
  bookId: string;
  title: string;
}

/**
 * The comments a member sees on a book's page — **approved only**, and that is
 * INV-9 living in the access path rather than in a caller's filter.
 *
 * `0006_community.sql:24` puts a partial index behind exactly this predicate
 * ("the partial index encodes that in the access path itself"), and master §7.3
 * asks the named test to assert the exclusion *through this query* rather than
 * by reading every row and filtering in TypeScript — because a test that
 * filtered would pass against a query with no `status` predicate at all, which
 * is precisely the defect INV-9 exists to prevent.
 *
 * A `pending`, `rejected` or `hidden` comment is absent for everyone here,
 * including its own author. That is the requirement as written; if a reader
 * should see their own comment awaiting moderation, that is a product decision
 * and a different query, not a loosened predicate on this one.
 *
 * **The body is returned raw.** BR §5.4: comments are plain text, rendered
 * escaped. Escaping is the renderer's job and React does it by default; a query
 * that "helpfully" stripped tags would silently rewrite what a child wrote,
 * which is the failure `inv-09-comment-visibility.test.ts` pins with a `<script>`
 * body.
 */
export async function getBookComments(
  tx: Tx,
  ctx: TenantContext,
  input: { bookId: string },
): Promise<CommentRow[]> {
  requireReader(ctx);

  const rows = await tx<
    { id: string; body: string; author_name: string; created_at: Date }[]
  >`
    select c.id, c.body, u.full_name as author_name, c.created_at
      from comments c
      join users u on u.id = c.author_id
     where c.book_id = ${input.bookId}
       and c.status = 'approved'
       and c.deleted_at is null
     order by c.created_at desc, c.id desc
  `;

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
  }));
}

/**
 * The moderation queue — **pending only**, oldest first, so a manager works a
 * queue rather than a pile.
 *
 * `id asc` beside `created_at asc` for the reason this codebase has now measured
 * twice: `created_at` carries no unique constraint, and an ordering without a
 * unique tiebreak repeats and drops rows across pages (304 distinct titles
 * collapsing to 229 in U2's measurement).
 */
export async function getPendingComments(
  tx: Tx,
  ctx: TenantContext,
): Promise<PendingCommentRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      id: string;
      body: string;
      author_name: string;
      created_at: Date;
      book_id: string;
      title: string;
    }[]
  >`
    select c.id, c.body, u.full_name as author_name, c.created_at,
           c.book_id, b.title
      from comments c
      join users u on u.id = c.author_id
      join books b on b.id = c.book_id
     where c.status = 'pending'
       and c.deleted_at is null
     order by c.created_at asc, c.id asc
  `;

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    authorName: r.author_name,
    createdAt: r.created_at,
    bookId: r.book_id,
    title: r.title,
  }));
}
