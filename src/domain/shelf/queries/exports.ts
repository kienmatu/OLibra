import type { CopyCondition, CopyState } from "../../catalogue/policy";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../../members/parish-context";
import { describeSelection } from "../../members/parish-taxonomy";
import type { MembershipRole, MembershipStatus } from "../../members/policy";
import { requireManager } from "../../members/policy";

/**
 * OPS §3.3's three exports — `ExportBooksCSV`, `ExportReadersCSV`,
 * `ExportLoansCSV`, all `manager`, all described as "data-export insurance
 * (§2)".
 *
 * **One module, because they are one operation.** OPS lists them on three
 * adjacent rows with two of the three purposes left as an em-dash, which is
 * that document saying "the same reason as the row above". They share their
 * gate, their scoping argument, their ordering rule and their callers, and a
 * reader checking that all three are `manager`-gated should not have to open
 * three files to find out.
 *
 * **Rows, not CSV.** Each returns typed rows and no formatting at all. The
 * Vietnamese column headers and the words for each enum are `src/lib/exports.ts`'s
 * — where `PROFILE_FIELD_LABELS`, `MEMBERSHIP_STATUS`, `STATUS` and
 * `CONDITION_LABELS` already live — and the quoting, the BOM and the formula
 * neutralisation are `src/lib/csv.ts`'s. A domain module cannot reach any of
 * those label maps: they import `lucide-react`, because in this project a status
 * carries an icon and a colour together and never a word alone
 * (`src/lib/status.ts`, BR §17.1). So the split is not tidiness — it is the one
 * arrangement that reuses the shipped words instead of writing a fourth set.
 *
 * **Scoping is RLS's**, exactly as `get-audit-log.ts` argues at length: `books`,
 * `book_copies`, `loans` and `memberships` all carry a tenant policy
 * (`0010_rls.sql`), so there is no `where bookshelf_id` in any of these and a
 * manager of Đồng Tháp running any of them inside their own transaction cannot
 * reach Vĩnh Long's rows. `users` carries none, which is why every join to it
 * below hangs off a row one of the policied tables already admitted, and why
 * `ExportReadersCSV` walks `memberships → users` rather than selecting `users`
 * and filtering.
 *
 * **Unpaged, and P1 §3.4 asks for the limit to be stated rather than
 * discovered.** Each of these buffers its whole result in memory, serialises it
 * to one string and hands that to one `Response`. At the size these shelves are
 * — the seed's largest catalogue is in the dozens, and a parish library that
 * outgrew a spreadsheet is what this software replaces — that is a few hundred
 * kilobytes. It stops being reasonable somewhere around a hundred thousand
 * rows, which for `loans` is roughly a decade of a very busy shelf; the fix at
 * that point is a cursor and a streamed `Response`, and it is not worth its
 * complexity before then. The audit log is deliberately **not** among the three
 * exports: it is the one table with no ceiling at all (INV-12, append-only,
 * never pruned), and OPS §3.3 does not ask for it.
 *
 * **The order is folded, and it is tie-broken.** Every one of these sorts by a
 * name or a title, and this cluster's collation is `C` — byte order — so `Đ`
 * (`C4 90`) sorts after every ASCII letter and an unfolded sort puts every Đặng,
 * Đỗ and *Đất Rừng Phương Nam* at the end of the file. `olibra_fold` is the same
 * function `getReadersList` and `getCatalogue` order by, so the export and the
 * screens agree about what alphabetical means. The primary key ends each order:
 * these are unpaged, so a tie cannot *lose* a row here, but two children called
 * Nguyễn Văn An swapping places between two exports of the same data is a diff
 * a volunteer cannot explain, and the key costs nothing.
 */

export interface BookExportRow {
  title: string;
  author: string | null;
  category: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  isPublished: boolean;
  copyCode: string;
  state: CopyState;
  condition: CopyCondition;
  acquiredOn: string | null;
  acquiredFrom: string | null;
}

/**
 * One row per **copy**, not per title.
 *
 * The file is insurance: what a volunteer rebuilding this shelf from a
 * spreadsheet needs is every physical book with its code, its state and its
 * condition, and a per-title export would throw exactly that away. A title with
 * four copies is four rows sharing a title, which is also what makes the file
 * usable as a stocktaking sheet — the use §2's "data-export insurance" is
 * actually for.
 *
 * `left join categories` because `books.category_id` is nullable and a book
 * with no category must still appear. `deleted_at is null` on both: a soft
 * deleted book is not on the shelf, and this file describes the shelf.
 */
export async function exportBooks(
  tx: Tx,
  ctx: TenantContext,
): Promise<BookExportRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      title: string;
      author: string | null;
      category: string | null;
      publisher: string | null;
      published_year: number | null;
      isbn: string | null;
      page_count: number | null;
      is_published: boolean;
      code: string;
      state: CopyState;
      condition: CopyCondition;
      acquired_on: string | null;
      acquired_from: string | null;
    }[]
  >`
    select b.title, b.author, cat.name as category, b.publisher,
           b.published_year, b.isbn, b.page_count, b.is_published,
           c.code, c.state, c.condition,
           c.acquired_on::text as acquired_on, c.acquired_from
    from book_copies c
    join books b on b.id = c.book_id and b.deleted_at is null
    left join categories cat on cat.id = b.category_id and cat.deleted_at is null
    where c.deleted_at is null
    order by olibra_fold(b.title), b.id, c.code, c.id
  `;

  return rows.map((r) => ({
    title: r.title,
    author: r.author,
    category: r.category,
    publisher: r.publisher,
    publishedYear: r.published_year,
    isbn: r.isbn,
    pageCount: r.page_count,
    isPublished: r.is_published,
    copyCode: r.code,
    state: r.state,
    condition: r.condition,
    acquiredOn: r.acquired_on,
    acquiredFrom: r.acquired_from,
  }));
}

export interface ReaderExportRow {
  saintName: string | null;
  fullName: string;
  dateOfBirth: string | null;
  fatherName: string | null;
  motherName: string | null;
  phone: string | null;
  email: string | null;
  parishLine: string;
  status: MembershipStatus;
  role: MembershipRole;
  hasCredentials: boolean;
  managerNotes: string | null;
  joinedOn: string | null;
}

/**
 * P1 §3.5: "A CSV of children is a disclosure surface."
 *
 * The column set is bounded by §3.5(b) — "nothing in it that BR §16.1 does not
 * already show a manager on screen" — and every column below is on
 * `quan-ly/nguoi-doc/[id]` today, from `getReaderDetail`'s own select. That is
 * the bound, and it is a real one: `username` and `password_hash` are **not**
 * here. `hasCredentials` is the boolean `getReaderDetail` substitutes for them
 * (INV-14: the two are paired or both null, and neither is ever read out), so
 * the file can answer "does this child have a way in from home" without being a
 * list of accounts to try.
 *
 * `parishLine` is `describeSelection`'s, so the file says "Tổ 3 · Giáo họ Thánh
 * Tâm" in the shelf's own words rather than two uuids — the same function every
 * screen writes a parish line with (BR §5.6).
 *
 * §3.5(a) asks for the gate to be provable by test rather than asserted;
 * `tests/domain/shelf/exports.test.ts` runs it as a reader and as a manager of
 * the wrong shelf.
 */
export async function exportReaders(
  tx: Tx,
  ctx: TenantContext,
): Promise<ReaderExportRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      saint_name: string | null;
      full_name: string;
      date_of_birth: string | null;
      father_name: string | null;
      mother_name: string | null;
      phone: string | null;
      email: string | null;
      parish_unit_l1_id: string | null;
      parish_unit_l2_id: string | null;
      status: MembershipStatus;
      role: MembershipRole;
      has_credentials: boolean;
      manager_notes: string | null;
      joined_on: string | null;
    }[]
  >`
    select u.saint_name, u.full_name, u.date_of_birth::text as date_of_birth,
           u.father_name, u.mother_name, u.phone, u.email,
           m.parish_unit_l1_id, m.parish_unit_l2_id,
           m.status, m.role, m.manager_notes,
           m.approved_at::date::text as joined_on,
           (u.username is not null) as has_credentials
    from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.deleted_at is null
    order by olibra_fold(u.full_name), m.id
  `;

  const { taxonomy, units } = await loadParishContext(tx, ctx);

  return rows.map((r) => ({
    saintName: r.saint_name,
    fullName: r.full_name,
    dateOfBirth: r.date_of_birth,
    fatherName: r.father_name,
    motherName: r.mother_name,
    phone: r.phone,
    email: r.email,
    parishLine: describeSelection(taxonomy, units, {
      l1: r.parish_unit_l1_id,
      l2: r.parish_unit_l2_id,
    }),
    status: r.status,
    role: r.role,
    hasCredentials: r.has_credentials,
    managerNotes: r.manager_notes,
    joinedOn: r.joined_on,
  }));
}

export interface LoanExportRow {
  title: string;
  copyCode: string;
  borrowerName: string;
  lentOn: string;
  dueOn: string;
  returnedOn: string | null;
  status: string;
  returnCondition: CopyCondition | null;
  lentBy: string | null;
  receivedBy: string | null;
  note: string | null;
}

/**
 * "CSV of loan history" — every loan the shelf has ever recorded, not the open
 * ones.
 *
 * INV-11 is why the word *history* is load bearing: loans are never deleted, so
 * this file is the complete circulation record and a filter to `active` would
 * quietly make it something else. `voided` rows are included with their reason
 * in the note column, for BR §11's argument that "why is there no loan here" has
 * to have an answer six months later.
 *
 * `lent_by` and `received_by` are resolved to names for the reason
 * `get-audit-log.ts` gives: an id is not readable. Unlike an audit sentence,
 * these are not history being restated — `loans` is an ordinary mutable table
 * and this file describes it as it is now.
 *
 * The order is newest first, which is not the alphabetical rule the other two
 * follow, and deliberately: a loan's identity is *when*, and a volunteer opening
 * this file is looking for last week. `lent_at` is not unique — two books handed
 * over in one visit share an instant to the second — so `l.id` ends the order
 * for the reason it does everywhere else.
 */
export async function exportLoans(
  tx: Tx,
  ctx: TenantContext,
): Promise<LoanExportRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      title: string;
      code: string;
      borrower_name: string;
      lent_on: string;
      due_on: string;
      returned_on: string | null;
      status: string;
      return_condition: CopyCondition | null;
      lent_by: string | null;
      received_by: string | null;
      note: string | null;
    }[]
  >`
    select b.title, c.code,
           borrower.full_name as borrower_name,
           l.lent_at::text as lent_on,
           l.due_on::text as due_on,
           l.returned_at::text as returned_on,
           l.status::text as status,
           l.return_condition,
           lender.full_name as lent_by,
           receiver.full_name as received_by,
           -- One note column rather than three near-empty ones. A loan carries
           -- at most one of these: it was returned with a remark, or it was
           -- voided with a reason, and BR §11 makes the second the whole point
           -- of voiding rather than deleting.
           coalesce(l.return_note, l.void_reason) as note
    from loans l
    join books b on b.id = l.book_id
    join book_copies c on c.id = l.copy_id
    -- Every join to users hangs off a loans row RLS has already admitted;
    -- users itself carries no policy (0010_rls.sql leaves it out of the loop).
    join users borrower on borrower.id = l.borrower_id
    left join users lender on lender.id = l.lent_by
    left join users receiver on receiver.id = l.received_by
    order by l.lent_at desc, l.id desc
  `;

  return rows.map((r) => ({
    title: r.title,
    copyCode: r.code,
    borrowerName: r.borrower_name,
    lentOn: r.lent_on,
    dueOn: r.due_on,
    returnedOn: r.returned_on,
    status: r.status,
    returnCondition: r.return_condition,
    lentBy: r.lent_by,
    receivedBy: r.received_by,
    note: r.note,
  }));
}
