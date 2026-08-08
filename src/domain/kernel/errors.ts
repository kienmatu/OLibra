/**
 * Named failures, not generic ones.
 *
 * OPS §2: "A command never fails with a bare 500 or an unstructured
 * exception." Every failure mode in the operations catalogue is a stable code
 * paired with the exact Vietnamese sentence the UI shows, matching BR §17.7's
 * requirement that a business-rule violation "surface as a friendly message
 * naming what to do instead."
 *
 * A closed union rather than a plain `string`, so a typo in a reason code is
 * a type error at the call site instead of a silent mismatch discovered when
 * a screen fails to translate it. Every code carries its Vietnamese sentence
 * here, in the domain, so the two can never drift apart the way a UI-owned
 * copy of the same mapping eventually would — a screen calls
 * `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it
 * did not define.
 *
 * Extended by each domain module that needs a reason code of its own; there
 * is deliberately no separate per-module error file; one closed union keeps
 * `switch`-over-`ErrorCode` exhaustive everywhere it is used.
 */

/**
 * The closed set of failure codes. Adding a command means adding its codes
 * here, which is deliberate: the compiler then finds every place that must
 * handle it.
 */
export const ERROR_MESSAGES = {
  // — catalogue —
  shelf_not_found: "Không tìm thấy tủ sách này.",
  book_not_found: "Không tìm thấy sách này.",
  copy_not_found: "Không tìm thấy bản sách này.",
  validation_failed: "Vui lòng kiểm tra lại thông tin.",
  duplicate_isbn: "Mã ISBN này đã tồn tại trong tủ sách.",
  has_active_loans: "Không thể xoá sách đang có bản được mượn.",
  already_lost: "Bản sách này đã được báo mất.",
  already_retired: "Bản sách đã ngừng dùng, không thể báo mất.",
  not_lost: "Bản sách này hiện không ở trạng thái đã mất.",
  copy_on_loan:
    "Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước.",

  // — circulation —
  copy_not_available: "Bản sách này đang được mượn hoặc đang giữ chỗ.",
  copy_lost_or_retired: "Bản sách này đã mất hoặc ngừng dùng.",
  membership_not_active: "Tài khoản đang tạm khoá, không thể mượn thêm.",
  loan_limit_reached: "Bạn đọc đã mượn tối đa số sách cho phép.",
  loan_not_active: "Lượt mượn này đã được xử lý.",
  no_renewals_remaining: "Bạn đã dùng hết số lần gia hạn cho lượt mượn này.",
  title_has_queue: "Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.",
  reason_required: "Vui lòng ghi lý do huỷ.",
  hold_expired: "Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại.",
  no_copy_available: "Không còn bản nào để giữ chỗ.",
  request_not_pending: "Yêu cầu này đã được xử lý.",
  request_not_queued: "Yêu cầu này không còn trong hàng chờ của sách này.",
  duplicate_request: "Bạn đã có một yêu cầu đang chờ cho cuốn này.",
  not_own_request: "Bạn không thể huỷ yêu cầu của người khác.",
  request_already_fulfilled: "Yêu cầu này đã được trao sách, không thể huỷ.",

  // — members —
  membership_not_found: "Không tìm thấy bạn đọc này.",
  change_already_pending: "Bạn đang có một yêu cầu thay đổi chờ duyệt.",
  reason_required_on_reject: "Từ chối cần ghi lý do.",

  // — members: parish taxonomy (already present — do not remove or reword) —
  parish_unit_l1_not_found: "Đơn vị bậc 1 đã chọn không tồn tại.",
  parish_unit_l2_not_found: "Đơn vị bậc 2 đã chọn không tồn tại.",
  parish_unit_l2_not_in_l1:
    "Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.",

  // — access —
  not_authenticated: "Bạn cần đăng nhập để tiếp tục.",
  not_permitted: "Bạn không có quyền thực hiện việc này.",

  // — kernel —
  invalid_bookshelf_id: "Mã tủ sách không hợp lệ.",
  audit_forbidden_field: "Không thể ghi nhật ký chứa thông tin bí mật.",
  write_target_not_found: "Không tìm thấy dữ liệu cần thay đổi.",
  audit_nesting_too_deep: "Dữ liệu nhật ký lồng quá sâu để kiểm tra.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}

export abstract class DomainError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messageFor(code));
    this.name = new.target.name;
  }
}

/** The thing asked for does not exist, or is not visible to this caller. */
export class NotFound extends DomainError {}

/** The input is malformed. Renders inline, beneath the field. */
export class ValidationFailed extends DomainError {
  constructor(
    code: ErrorCode,
    readonly field?: string,
  ) {
    super(code);
  }
}

/** The input is well-formed but a business rule forbids the result. */
export class RuleViolated extends DomainError {}

/**
 * PostgreSQL 23505. INV-1's loser arrives here, and translating it into
 * `copy_not_available` is what turns a race into a plain Vietnamese sentence
 * rather than a 500 (BR §2).
 */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "23505";
}
