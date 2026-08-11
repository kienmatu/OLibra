import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import type { CopyCondition } from "../policy";
import { requireManager } from "../policy";

export interface LostCopyRow {
  copyId: string;
  /** `DT-0142` — the code printed on the copy (`0004_catalogue.sql:60`). */
  code: string;
  bookId: string;
  /** `books.slug`, so a row can link to the book's own management page. */
  bookSlug: string;
  title: string;
  /** `books.cover_url` — Task 12 (2026-08-10 QA remediation); see
   *  `search-loans-for-return.ts`'s `LoanForReturnRow` for why this now
   *  travels with the row rather than being matched from the title. */
  coverUrl: string | null;
  author: string;
  condition: CopyCondition;
  /**
   * `book_copies.lost_reported_at`, a `timestamptz` — rendered through
   * `formatInstant`, not `formatDate`.
   *
   * Nullable, because the column is: BR §5.4 gives BookCopy a "time reported
   * lost" and nothing makes it mandatory, and a shelf whose data arrived by
   * import rather than through `ReportCopyLost` can hold a `lost` copy with no
   * time on it. A row with no date is still a copy this screen exists to give
   * a way back, so it is listed rather than filtered out.
   */
  reportedAt: string | null;
  /**
   * Who was holding it when it was reported lost, or `null`.
   *
   * `ReportCopyLost` closes the copy's active loan as `lost` in the same
   * transaction (OPS §4.1: "not left dangling as `active`"), so that loan is
   * where this name comes from. `null` covers the two honest cases: a copy that
   * reached `lost` without a loan behind it, and a loan row that has since been
   * voided. Never a guess — a name printed beside a lost book is a family a
   * volunteer is about to telephone.
   *
   * **A name and no phone number.** BR:559 specifies this screen and asks for
   * neither; BR:573 asks for the phone on the *overdue* screen and gives the
   * reason ("that phone number is the actual mechanism by which books come
   * back"). A lost copy's way back is `MarkCopyFound`, not a call, so the most
   * identifying field on the shelf is not carried here.
   */
  lastBorrowerName: string | null;
}

/**
 * BR §16.3's **Sách đã mất** — "the same set filtered to state *lost*,
 * reachable from the Sách list as a status filter, with **Đánh dấu tìm thấy**
 * and **Ngừng dùng** per copy — the same two exits §7.1 draws out of `lost`."
 *
 * That paragraph is unusually explicit about why the screen exists, and it is
 * worth quoting rather than summarising: **"'Báo mất' appears in three places
 * in the built interface, and marking a copy found appears in none of them"** —
 * a copy reported lost has been a one-way door in practice, even though BR §7.1
 * draws `lost → available` and BR §3 lists "a book reported lost is found
 * months later" as a case the system must handle. Finding one lost copy from
 * inside each book's own copy list, across a few hundred books, is not
 * realistic.
 *
 * **OPS §3.3 defines no `GetLostCopies`, and this is still a domain query.**
 * The operations catalogue's query table omits it; OPS §4.1 does not — under
 * `MarkCopyFound` it names this exact view as the command's UI trigger ("the
 * lost-copies view on the manager's Sách list … added specifically to close
 * this gap"), and resolves what it had previously listed as an open question by
 * doing so. So the read is implied by the catalogue even though the catalogue
 * forgot to tabulate it. It goes in `src/domain/` rather than in `src/lib/`
 * beside `readCatalogueCategories` because it is not chrome: it is the page's
 * whole content, it is manager-gated, and its rows are the input to two
 * commands.
 *
 * **The scoping is RLS, not a `where` clause.** `book_copies`, `books`, `loans`
 * and `memberships` all carry `<table>_tenant` policies keyed on
 * `olibra.bookshelf_id` (`0010_rls.sql`), which `runQuery` sets. `users` carries
 * none at all, so the join to it can only narrow what `loans` already admitted.
 * `tests/domain/catalogue/lost-copies.test.ts` runs this function unchanged
 * under `olibra_admin`, which holds `bypassrls`, and asserts the other shelf's
 * copies appear — which is only possible if nothing here names a shelf.
 *
 * **Ordered newest-first, and the order is total.** The copy reported lost most
 * recently is the one a volunteer is most likely to be looking for, and
 * `lost_reported_at` is not unique (a manager reporting three copies of a set
 * lost in one sitting writes the same `ctx.clock.now()` on all three — the clock
 * is fixed for the transaction, so this is the ordinary case rather than a
 * coincidence). `c.code` ends the order: it is `unique (bookshelf_id, code)`, so
 * it cannot tie. `nulls last` is explicit because a copy with no report time is
 * the least recent thing on the screen, not the most — Postgres sorts nulls
 * first under `desc` by default, which would have put the least informative rows
 * at the top.
 *
 * **Not paged — and the parity that used to justify that does not hold.** This
 * claimed `getPendingRegistrations`' and `getPendingProfileChanges`' reason:
 * "bounded by its own state rather than by the size of the shelf". The words are
 * true of all three and the property they are standing in for is not. Those two
 * queues *drain* — a manager works them down within days, and a shelf where they
 * do not has a problem no pagination control addresses. A `lost` copy leaves this
 * set only via an explicit `MarkCopyFound` or `RetireCopy`, and nobody is under
 * any pressure to run either: a copy nobody expects back can sit here for years.
 * So this set is **monotonically increasing until somebody acts**, which is the
 * one query in this slice that grows without bound over the life of a shelf.
 * `getOverdueLoans` is not in the same position either — a loan leaves it when
 * the book comes back, which is the thing the screen exists to cause.
 *
 * Nothing breaks at a few hundred rows, which is why paging it is optional
 * rather than owed. What gives first is not this query — it is `sach/mat`'s
 * HTML: one `Card` and one `BookCover` per row, all of them rendered, on a
 * volunteer's phone. If that screen ever needs a `limit`/`offset`, the order
 * below is already total and adding one is two lines. The false parity is the
 * part that had to go, because it is the kind of reasoning that gets copied into
 * the next query without being re-checked.
 */
export async function getLostCopies(
  tx: Tx,
  ctx: TenantContext,
): Promise<LostCopyRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      copy_id: string;
      code: string;
      book_id: string;
      book_slug: string;
      title: string;
      cover_url: string | null;
      author: string;
      condition: string;
      reported_at: string | null;
      last_borrower_name: string | null;
    }[]
  >`
    select
      c.id as copy_id, c.code, c.condition,
      c.lost_reported_at::text as reported_at,
      b.id as book_id, b.slug as book_slug, b.title, b.cover_url, b.author,
      holder.full_name as last_borrower_name
    from book_copies c
    join books b on b.id = c.book_id
    -- The loan ReportCopyLost closed in the same transaction as the copy's
    -- state change. An order by rather than a bare limit 1: a copy can have
    -- been lost, found, lent and lost again, and the interesting one is the
    -- most recent. users directly, not through memberships -- a borrower who
    -- has since left the shelf is exactly the person a lost copy is most likely
    -- to be with, and joining memberships would silently blank their name.
    left join lateral (
      select u.full_name
      from loans l
      join users u on u.id = l.borrower_id
      where l.copy_id = c.id and l.status = 'lost'
      order by l.lost_reported_at desc nulls last
      limit 1
    ) holder on true
    where c.state = 'lost' and c.deleted_at is null and b.deleted_at is null
    order by c.lost_reported_at desc nulls last, c.code
  `;

  return rows.map((r) => ({
    copyId: r.copy_id,
    code: r.code,
    bookId: r.book_id,
    bookSlug: r.book_slug,
    title: r.title,
    coverUrl: r.cover_url,
    author: r.author,
    condition: r.condition as CopyCondition,
    reportedAt: r.reported_at,
    lastBorrowerName: r.last_borrower_name,
  }));
}

/**
 * How many copies this shelf has lost — the number BR:559 makes the reason the
 * **Đã mất (n)** filter chip exists at all.
 *
 * A separate statement rather than `getLostCopies(...).length`, for the reason
 * `getManagerBadgeCounts` is separate from the two queues it counts: this runs
 * on `quan-ly/sach`, where the list itself is a different set of rows entirely,
 * and reading every lost copy's borrower name to render a digit would be doing
 * the identifying join for a number.
 *
 * **It is the same predicate, and a test says so.** `where state = 'lost' and
 * deleted_at is null`, joined to `books` for its own `deleted_at` exactly as
 * above — a chip whose count disagrees with the screen it opens is the defect
 * wave 1 spent a paragraph on ("the volunteer taps 'Đăng ký chờ duyệt 5', counts
 * four cards, and now has to decide which of the two the software means"), and
 * `tests/domain/catalogue/lost-copies.test.ts` asserts the two agree rather than
 * trusting that they look alike.
 */
export async function getLostCopyCount(
  tx: Tx,
  ctx: TenantContext,
): Promise<number> {
  requireManager(ctx);

  const [row] = await tx<{ count: number }[]>`
    select count(*)::int as count
    from book_copies c
    join books b on b.id = c.book_id
    where c.state = 'lost' and c.deleted_at is null and b.deleted_at is null
  `;
  return row?.count ?? 0;
}
