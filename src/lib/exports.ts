// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`
// records at the top of its own imports: the suite imports this module directly
// and Vitest resolves no alias. It matters more here than there — these are
// *value* imports, which an erased `import type` would have hidden the problem
// for.
import type { MembershipRole } from "../domain/members/policy";
import type {
  BookExportRow,
  LoanExportRow,
  ReaderExportRow,
} from "../domain/shelf/queries/exports";
import { MEMBERSHIP_STATUS } from "./membership-status";
import { PROFILE_FIELD_LABELS } from "./profile-labels";
import { roleLabel } from "./roles";
import { CONDITION_LABELS, COPY_STATE_STATUS, STATUS } from "./status";

/**
 * The three exports, as a header row and a grid of strings.
 *
 * This is where the domain's rows (`domain/shelf/queries/exports.ts`) meet the
 * words. It lives in `src/lib/` and not in the domain for one reason and it is
 * the same reason `src/lib/roles.ts`, `membership-status.ts`, `profile-labels.ts`
 * and `status.ts` do: those four *are* the words, they carry an icon beside
 * every one of them (BR §17.1 — status is never colour or word alone), and they
 * therefore import `lucide-react`, which the domain must not. Building the table
 * here is what lets every enum in these files be translated by the map that
 * already owns it rather than by a fifth set of words written for a CSV.
 *
 * **What is reused, and what is new.** Nine of the column headers are
 * `PROFILE_FIELD_LABELS` verbatim — that map exists precisely because BR §5.3's
 * facts about a person needed names, and a spreadsheet column is a name for the
 * same fact. Every enum word comes from `MEMBERSHIP_STATUS`, `STATUS` or
 * `CONDITION_LABELS`. The remaining headers are new, and they are nouns naming a
 * column, listed in this slice's report.
 *
 * **Dates are ISO, and that is a deliberate departure from SDD §6.6.** Every
 * date below is the database's own `::text` of a `date` — `2015-04-02` — not
 * `formatDate`'s `02/04/2015`. §6.6's rule is about dates rendered *to a
 * person*, and this file is not read by a person: it is parsed by a spreadsheet,
 * which then renders it to a person in whatever locale that machine is set to.
 * `02/04/2015` is the second of April in Vietnam and the fourth of February in a
 * US-locale Excel, silently, with no error — an insurance file that changes what
 * it says depending on who opens it. ISO 8601 is the one form every spreadsheet
 * parses identically, and once parsed the volunteer's own locale renders it,
 * which is what §6.6 actually wants.
 *
 * **Numbers are bare digits** for the same reason and it matters more than it
 * looks: `formatYear` exists because `Intl.NumberFormat("vi-VN")` renders 2016
 * as "2.016", and a spreadsheet handed "2.016" reads two-point-oh-one-six.
 *
 * A `null` is an empty cell, never the word "null" and never a dash. An empty
 * cell is what a spreadsheet means by "not recorded"; a dash is a value, and it
 * sorts and filters like one.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** `null`/`undefined` → an empty cell. Nothing else is coerced. */
function cell(value: string | null | undefined): string {
  return value ?? "";
}

/** A number, in digits, or an empty cell. Never grouped — see the header. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A yes/no column.
 *
 * "Có" and "Không" are the words this application already answers such a
 * question with — `nhan-tra`'s condition step and the registration form both use
 * them — and a CSV wants a word rather than `true`, which a Vietnamese-locale
 * spreadsheet displays as `TRUE` in English.
 */
function yesNo(value: boolean): string {
  return value ? "Có" : "Không";
}

/**
 * The word for a `membership_role`.
 *
 * `roleLabel` (`src/lib/roles.ts`) deliberately returns `null` for `reader`, and
 * its docstring is explicit about why: no *screen* renders a word for a role
 * nobody with that role can reach. A spreadsheet column is not that screen — it
 * lists every member of the shelf, most of them readers, and a blank cell in a
 * column headed "Vai trò" reads as missing data rather than as "ordinary
 * member".
 *
 * So one word is supplied here rather than added to `ROLE_LABELS`, which would
 * be changing that file's stated rule in order to serve a caller it was not
 * written for. "Bạn đọc" is not new copy — it is what `quan-ly/nguoi-doc`
 * already counts in ("108 bạn đọc") and what its empty state already says.
 */
function roleWord(role: MembershipRole): string {
  return roleLabel(role) ?? "Bạn đọc";
}

/**
 * The word for a `loan_status`.
 *
 * Three of the four are shipped: "Đang mượn" is `STATUS.onloan.label`, "Đã mất"
 * is `STATUS.lost.label`, and "Đã trả" is what `nhan-tra/bao-mat` contrasts a
 * loss against in its own warning. **"Đã huỷ" is new** — nothing in this
 * application had a word for a voided loan, because nothing had a screen that
 * lists one; BR §11's argument for voiding rather than deleting is exactly that
 * such a loan stays visible, so a file describing loan history has to name it.
 *
 * A `Record` over the enum rather than a `switch`, so a fifth `loan_status`
 * would be a compile error here rather than an empty cell.
 */
const LOAN_STATUS: Record<string, string> = {
  active: STATUS.onloan.label,
  returned: "Đã trả",
  lost: STATUS.lost.label,
  voided: "Đã huỷ",
};

function loanStatusWord(status: string): string {
  // `Object.hasOwn`, never `in`: the value is a `loan_status` today, and the
  // same reasoning `src/lib/roles.ts` records applies — the type says it cannot
  // be `constructor`, and that is the reasoning that shipped an HTTP 500.
  return Object.hasOwn(LOAN_STATUS, status) ? LOAN_STATUS[status] : status;
}

export function booksTable(rows: BookExportRow[]): CsvTable {
  return {
    headers: [
      "Tên sách",
      "Tác giả",
      "Thể loại",
      "Nhà xuất bản",
      "Năm xuất bản",
      "ISBN",
      "Số trang",
      "Đang hiển thị",
      "Mã bản sách",
      "Tình trạng bản sách",
      "Chất lượng",
      "Ngày nhập",
      "Nguồn",
    ],
    rows: rows.map((r) => [
      r.title,
      cell(r.author),
      cell(r.category),
      cell(r.publisher),
      num(r.publishedYear),
      cell(r.isbn),
      num(r.pageCount),
      yesNo(r.isPublished),
      r.copyCode,
      STATUS[COPY_STATE_STATUS[r.state]].label,
      CONDITION_LABELS[r.condition],
      cell(r.acquiredOn),
      cell(r.acquiredFrom),
    ]),
  };
}

export function readersTable(rows: ReaderExportRow[]): CsvTable {
  return {
    headers: [
      PROFILE_FIELD_LABELS.saint_name,
      PROFILE_FIELD_LABELS.full_name,
      PROFILE_FIELD_LABELS.date_of_birth,
      PROFILE_FIELD_LABELS.father_name,
      PROFILE_FIELD_LABELS.mother_name,
      PROFILE_FIELD_LABELS.phone,
      PROFILE_FIELD_LABELS.email,
      "Đơn vị",
      "Trạng thái",
      "Vai trò",
      "Có tài khoản đăng nhập",
      "Ngày tham gia",
      "Ghi chú của quản lý",
    ],
    rows: rows.map((r) => [
      cell(r.saintName),
      r.fullName,
      cell(r.dateOfBirth),
      cell(r.fatherName),
      cell(r.motherName),
      cell(r.phone),
      cell(r.email),
      r.parishLine,
      MEMBERSHIP_STATUS[r.status].label,
      roleWord(r.role),
      yesNo(r.hasCredentials),
      cell(r.joinedOn),
      cell(r.managerNotes),
    ]),
  };
}

export function loansTable(rows: LoanExportRow[]): CsvTable {
  return {
    headers: [
      "Tên sách",
      "Mã bản sách",
      "Người mượn",
      "Ngày mượn",
      "Hạn trả",
      "Ngày trả",
      "Trạng thái",
      "Chất lượng khi trả",
      "Người cho mượn",
      "Người nhận trả",
      "Ghi chú",
    ],
    rows: rows.map((r) => [
      r.title,
      r.copyCode,
      r.borrowerName,
      r.lentOn,
      r.dueOn,
      cell(r.returnedOn),
      loanStatusWord(r.status),
      r.returnCondition ? CONDITION_LABELS[r.returnCondition] : "",
      cell(r.lentBy),
      cell(r.receivedBy),
      cell(r.note),
    ]),
  };
}
