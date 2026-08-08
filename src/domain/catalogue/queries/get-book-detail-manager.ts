import { NotFound } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { type CopyCondition, type CopyState, requireManager } from "../policy";
import type { Availability } from "./get-catalogue";
import type { BooksListRow } from "./get-books-list";

export interface ManagerCopyRow {
  copyId: string;
  code: string;
  state: CopyState;
  condition: CopyCondition;
  conditionNote: string | null;
  acquiredOn: string | null;
  acquiredFrom: string | null;
  acquiredFromMembershipId: string | null;
  /** "Đang ở đâu" — the holder and due date when out, null when on the shelf. */
  holderName: string | null;
  dueOn: string | null;
  isOverdue: boolean;
  lostReportedAt: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
}

export interface ManagerBookDetail {
  book: BooksListRow;
  copies: ManagerCopyRow[];
  conditionHistory: {
    assessedAt: string;
    copyCode: string;
    assessorName: string | null;
    condition: CopyCondition;
    note: string | null;
  }[];
  loanHistory: {
    loanId: string;
    copyCode: string;
    borrowerName: string;
    lentAt: string;
    returnedAt: string | null;
    status: string;
    returnCondition: CopyCondition | null;
  }[];
}

/**
 * A title's full management page: `getBooksList`'s row shape for one book,
 * every copy (including retired ones, with their reason — a reader's page
 * hides those, a manager's shows them), the condition-assessment history
 * (BR §11: never deleted) and the loan history (kept by `loans.book_id`
 * rather than by joining through the copy, precisely so it survives the copy
 * being retired — DB §4.5).
 */
export async function getBookDetailManager(
  tx: Tx,
  ctx: TenantContext,
  input: { bookId: string },
): Promise<ManagerBookDetail> {
  requireManager(ctx);

  const [book] = await tx<
    {
      book_id: string;
      slug: string;
      title: string;
      author: string | null;
      cover_url: string | null;
      category: string | null;
      copies_total: number;
      copies_available: number;
      availability: string;
      is_published: boolean;
      codes: string;
    }[]
  >`
    with counted as (
      select
        b.id as book_id, b.slug, b.title, b.author, b.cover_url,
        b.is_published,
        c.name as category,
        count(cp.id)                                     as copies_total,
        count(av.id)                                      as copies_available,
        count(cp.id) filter (where cp.state = 'on_loan')  as on_loan,
        count(cp.id) filter (where cp.state = 'held')     as held,
        count(cp.id) filter (where cp.state = 'lost')     as lost,
        case
          when count(cp.id) = 0 then ''
          when min(cp.code) = max(cp.code) then min(cp.code)
          else min(cp.code) || ' – ' || max(cp.code)
        end as codes
      from books b
      left join categories c on c.id = b.category_id
      left join book_copies cp
             on cp.bookshelf_id = b.bookshelf_id
            and cp.book_id = b.id
            and cp.deleted_at is null
            and cp.state <> 'retired'
      left join copies_borrowable av on av.id = cp.id
      where b.id = ${input.bookId} and b.deleted_at is null
      group by b.id, c.name
    )
    select *,
      case
        when copies_available > 0 then 'available'
        when on_loan > 0          then 'on_loan'
        when held > 0             then 'held'
        when lost > 0             then 'lost'
        else 'retired'
      end as availability
    from counted
  `;
  if (!book) throw new NotFound("book_not_found");

  // The copy rows. `state <> 'retired'` is deliberately absent — a manager's
  // page shows retired copies with their reason, unlike a reader's.
  const copies = await tx<
    {
      id: string;
      code: string;
      state: string;
      condition: string;
      condition_note: string | null;
      acquired_on: string | null;
      acquired_from: string | null;
      acquired_from_membership_id: string | null;
      lost_reported_at: string | null;
      retired_at: string | null;
      retired_reason: string | null;
      holder_name: string | null;
      due_on: string | null;
      is_overdue: boolean;
    }[]
  >`
    select
      cp.id, cp.code, cp.state, cp.condition, cp.condition_note,
      cp.acquired_on::text as acquired_on, cp.acquired_from,
      cp.acquired_from_membership_id,
      cp.lost_reported_at, cp.retired_at, cp.retired_reason,
      u.full_name as holder_name,
      l.due_on::text as due_on,
      coalesce(l.is_overdue, false) as is_overdue
    from book_copies cp
    left join loans_current l on l.copy_id = cp.id and l.status = 'active'
    left join users u on u.id = l.borrower_id
    where cp.book_id = ${input.bookId} and cp.deleted_at is null
    order by cp.code
  `;

  // BR §11: condition assessments are never deleted, so this is the whole
  // history, oldest last.
  const conditionHistory = await tx<
    {
      assessed_at: string;
      condition: string;
      note: string | null;
      copy_code: string;
      assessor_name: string | null;
    }[]
  >`
    select ca.assessed_at, ca.condition, ca.note, cp.code as copy_code,
           u.full_name as assessor_name
    from condition_assessments ca
    join book_copies cp on cp.id = ca.copy_id
    left join users u on u.id = ca.assessed_by
    where cp.book_id = ${input.bookId}
    order by ca.assessed_at desc
  `;

  // `loans.book_id` rather than a join through the copy — DB §4.5 stores it on
  // the loan precisely so history survives the copy being retired.
  const loanHistory = await tx<
    {
      id: string;
      copy_code: string;
      borrower_name: string;
      lent_at: string;
      returned_at: string | null;
      status: string;
      return_condition: string | null;
    }[]
  >`
    select l.id, cp.code as copy_code, u.full_name as borrower_name,
           l.lent_at, l.returned_at, l.status, l.return_condition
    from loans l
    join book_copies cp on cp.id = l.copy_id
    join users u on u.id = l.borrower_id
    where l.book_id = ${input.bookId}
    order by l.lent_at desc
  `;

  return {
    book: {
      bookId: book.book_id,
      slug: book.slug,
      title: book.title,
      author: book.author,
      coverUrl: book.cover_url,
      category: book.category,
      copiesTotal: Number(book.copies_total),
      copiesAvailable: Number(book.copies_available),
      availability: book.availability as Availability,
      isPublished: book.is_published,
      codes: book.codes,
    },
    copies: copies.map((c) => ({
      copyId: c.id,
      code: c.code,
      state: c.state as CopyState,
      condition: c.condition as CopyCondition,
      conditionNote: c.condition_note,
      acquiredOn: c.acquired_on,
      acquiredFrom: c.acquired_from,
      acquiredFromMembershipId: c.acquired_from_membership_id,
      holderName: c.holder_name,
      dueOn: c.due_on,
      isOverdue: c.is_overdue,
      lostReportedAt: c.lost_reported_at,
      retiredAt: c.retired_at,
      retiredReason: c.retired_reason,
    })),
    conditionHistory: conditionHistory.map((h) => ({
      assessedAt: h.assessed_at,
      copyCode: h.copy_code,
      assessorName: h.assessor_name,
      condition: h.condition as CopyCondition,
      note: h.note,
    })),
    loanHistory: loanHistory.map((h) => ({
      loanId: h.id,
      copyCode: h.copy_code,
      borrowerName: h.borrower_name,
      lentAt: h.lent_at,
      returnedAt: h.returned_at,
      status: h.status,
      returnCondition: h.return_condition as CopyCondition | null,
    })),
  };
}
