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

/**
 * The moderation screen's other three tabs — every comment already decided,
 * most recent first. Was `getRecentlyApprovedComments`, one status baked in;
 * Task 14 (2026-08-10 QA remediation) gave `/quan-ly/binh-luan`'s "Đã từ chối"
 * and "Đã ẩn" chips something to read from, and a second and third
 * near-identical copy of this statement — the same columns, the same joins,
 * the same order by, one literal different — is exactly the shape this
 * codebase's own architecture tests elsewhere exist to catch (`isUuid`,
 * `pageNumber`, `statusFromParam` were each pulled to one copy for the same
 * reason). `status` is a parameter instead.
 *
 * `hideComment` reaches an `approved` row this returns; `rejected` and
 * `hidden` rows are read-only here — neither has a command that moves it
 * anywhere else, so the two tabs that show them render no action at all.
 *
 * Capped rather than paged, for all three statuses alike. This is a
 * "recently" list beside a queue, not a browsable archive — a shelf of a few
 * hundred books does not accumulate enough comments for a second page to be
 * the missing feature, and a manager looking for one specific old comment is
 * looking at the book's own page. The cap is a parameter so the caller states
 * it rather than inheriting a number from here.
 *
 * `getPendingComments` above stays its own function rather than folding in as
 * a fourth `status`: it is unbounded and ascending (oldest first, because a
 * queue is worked rather than browsed), where this is capped and descending —
 * a different shape, not the same one with a different literal.
 */
export async function getRecentComments(
  tx: Tx,
  ctx: TenantContext,
  input: { status: "approved" | "rejected" | "hidden"; limit?: number },
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
     where c.status = ${input.status}::comment_status
       and c.deleted_at is null
     -- id beside created_at for the reason getPendingComments above records:
     -- created_at carries no unique constraint, and an ordering without a
     -- unique tiebreak repeats and drops rows across pages. (No backticks in
     -- SQL comments: inside a tagged template they end the literal.)
     order by c.created_at desc, c.id desc
     limit ${input.limit ?? 10}
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

/**
 * How many comments are in each state — the four numbers on the moderation
 * screen's chips.
 *
 * **One statement over the enum, not four `count(*)` queries.** `comment_status`
 * has exactly four values (`0006_community.sql:7`), and a `group by` returns
 * only the ones with rows — so the zeroes have to be filled in here, from the
 * same literal list the type is built from. A `Record<CommentStatus, number>`
 * whose keys came from the database would silently lose a chip the day a status
 * had no rows, which is the state a well-moderated shelf is *usually* in.
 */
export type CommentStatus = "pending" | "approved" | "rejected" | "hidden";

export async function countCommentsByStatus(
  tx: Tx,
  ctx: TenantContext,
): Promise<Record<CommentStatus, number>> {
  requireManager(ctx);

  const rows = await tx<{ status: CommentStatus; n: string }[]>`
    select status, count(*) as n
      from comments
     where deleted_at is null
     group by status
  `;

  const counts: Record<CommentStatus, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    hidden: 0,
  };
  for (const row of rows) counts[row.status] = Number(row.n);
  return counts;
}
