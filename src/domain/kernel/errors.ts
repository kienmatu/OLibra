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
  // — catalogue: added by B1 —
  // OPS §4.1 gives `validation_failed` three different sentences across
  // CreateBook, UpdateBook and AddCopies. One code maps to one sentence, so
  // the two that are not the shipped wording get their own codes.
  required_fields_missing: "Vui lòng điền đầy đủ các trường bắt buộc.",
  copy_count_invalid: "Số bản phải lớn hơn 0.",
  category_not_found: "Không tìm thấy thể loại này.",
  // Q3, decided in the B1 plan: BR §7.1 draws only on_loan → lost. The
  // sentence names what is allowed instead, per BR §17.7.
  copy_not_on_loan: "Chỉ có thể báo mất bản sách đang được mượn.",
  // Distinct from `reason_required`, whose shipped sentence says "lý do
  // huỷ" — a cancellation. Withdrawing a copy from the shelf is not that.
  retire_reason_required: "Vui lòng ghi lý do ngừng dùng bản sách này.",

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

  // — members: B2a —
  // OPS §4.3's own sentences where OPS gives one; a distinct code wherever
  // OPS reuses a code for a different sentence (see the plan's collision
  // table). `membership_not_active` above is C1's, about borrowing — do not
  // reuse it for SuspendMembership's refusal, which says something else.
  username_taken: "Tên đăng nhập đã được dùng, hãy chọn tên khác.",
  username_in_use: "Tên đăng nhập này đã có người dùng.",
  password_too_short: "Mật khẩu cần ít nhất 8 ký tự.",
  new_password_too_short: "Mật khẩu mới cần ít nhất 8 ký tự.",
  passwords_dont_match: "Mật khẩu nhập lại không khớp.",
  current_password_incorrect: "Mật khẩu hiện tại không đúng.",
  already_registered_here: "Bạn đã đăng ký ở tủ sách này rồi.",
  registration_not_pending: "Đơn đăng ký này đã được xử lý.",
  not_active_cannot_suspend: "Chỉ có thể tạm khoá tài khoản đang hoạt động.",
  not_suspended_cannot_reactivate:
    "Chỉ có thể kích hoạt lại tài khoản đang tạm khoá.",
  member_has_active_loans: "Bạn đọc này còn sách chưa trả, hãy nhận trả trước.",
  reject_reason_required: "Vui lòng ghi lý do từ chối.",

  // — access —
  not_authenticated: "Bạn cần đăng nhập để tiếp tục.",
  not_permitted: "Bạn không có quyền thực hiện việc này.",
  // IMPORTANT 3: a distinct code from not_authenticated above, which is the
  // catalogue entry for "you are not signed in" — shown when a stranger
  // reaches a page that requires a session. A failed sign-in is a different
  // situation and needs its own sentence: one code covering a wrong
  // password, an unknown username, and an account with no credentials at
  // all (INV-14) alike, deliberately not distinguishing which — telling a
  // caller which one happened is what the earlier, more specific wording
  // this replaced was leaking.
  sign_in_failed: "Tên đăng nhập hoặc mật khẩu chưa đúng, em thử lại nhé.",

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

/**
 * A dependency the boot sequence forgot to wire, not a rule the caller broke.
 *
 * M7 (fix-report, 2026-08-08-b2-members): `registration.ts`'s default
 * `PasswordHasher` used to throw `RuleViolated("not_permitted")` when nothing
 * had called `setPasswordHasher` — a plausible-looking "Bạn không có quyền
 * thực hiện việc này." that a real reader could read as an ordinary refusal,
 * hiding a wiring bug behind a sentence that describes a different problem.
 * The default `PasswordVerifier` was worse: it silently returned `false`,
 * which reads from the outside as a correct "wrong password" — every
 * username-reuse attempt (BR §5.3) failing closed to `username_taken` with no
 * signal anything was ever missing.
 *
 * Deliberately **not** a `DomainError` / `ErrorCode`: those are a promise of
 * a Vietnamese sentence a real user might plausibly read as a legitimate
 * outcome, and adding a code here would mean this joins `ERROR_MESSAGES` and
 * every exhaustive `switch` over `ErrorCode` has to account for a failure
 * mode that should never reach a screen at all. This is meant to be loud in
 * the operational sense instead: an uncaught exception whose message names
 * exactly which setter was never called, surfacing as a server fault (see
 * `src/app/dang-nhap/actions.ts`, which only ever catches specific
 * `RuleViolated` codes by name and lets everything else — this included —
 * propagate) rather than as a business-shaped refusal a support ticket gets
 * filed against for the wrong reason.
 */
export class NotWired extends Error {
  constructor(what: string) {
    super(
      `${what} was never wired — call its setter during boot before this code path runs.`,
    );
    this.name = "NotWired";
  }
}
