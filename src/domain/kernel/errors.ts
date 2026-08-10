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
  // QA remediation Task 2: `categories` had a table (`0004_catalogue.sql`) and
  // a seed script (`src/db/seed.ts:103`) but no command and no screen, so a
  // fresh install — one that never ran the seed — could never satisfy the
  // required "Thể loại" field on "Thêm sách mới" and could never catalogue a
  // single book. `src/domain/catalogue/commands/create-category.ts` and its
  // siblings are the fix; these two codes are the refusals that family adds.
  duplicate_category: "Thể loại này đã có rồi.",
  category_in_use:
    "Còn sách thuộc thể loại này, không xoá được. Đổi thể loại cho những cuốn đó trước.",
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
  // C1. OPS §4.2 gives `loan_not_active` one sentence under ReceiveReturn —
  // "Lượt mượn này đã được xử lý.", the shipped wording above
  // (`docs/OPERATIONS.md:256`) — and a different one under VoidLoan
  // (`:282`). The two refusals are not the same refusal: returning a returned
  // loan is a double-submit and nothing is wrong, while voiding a closed loan
  // is a manager reaching for an undo that no longer applies. One code maps to
  // one sentence, or `messageFor` is a lie. The sentence names what is allowed
  // instead, per BR §17.7.
  //
  // The third time this collision has turned up in the catalogue: B1 split OPS
  // §4.1's `validation_failed` into `required_fields_missing` and
  // `copy_count_invalid`, B2a split §4.3's into `reject_reason_required`,
  // `not_active_cannot_suspend` and `not_suspended_cannot_reactivate`.
  //
  // Checked for a fourth while adding this one, and there is not one *in C1*.
  // `reason_required` above looks like a candidate — OPS uses it at five sites
  // — but its shipped sentence, "Vui lòng ghi lý do huỷ.", is VoidLoan's own
  // (`:283`), and the four sites saying "lý do từ chối" were already split off
  // into `reject_reason_required` by B2a. Two collisions were still open when
  // this paragraph was written, and both belonged to C2 rather than to C1:
  // `membership_not_active` reads "không thể mượn thêm" here and "không thể gửi
  // yêu cầu mượn" under CreateBorrowRequest (`:293`), and `copy_lost_or_retired`
  // gains "Bản sách đã chọn…" under ApproveBorrowRequest (`:305`). C2 made both
  // splits — see `membership_not_active_cannot_request` and
  // `chosen_copy_lost_or_retired` in its own block below.
  loan_not_active_cannot_void: "Chỉ có thể huỷ lượt mượn đang diễn ra.",
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

  // — circulation: C2 —
  // The two collisions C1's note above named as this slice's, split rather than
  // reused. Checked for a third before adding them, the way B1, B2a, B2b and C1
  // each had to: every `code — "sentence"` pair in OPERATIONS.md was read off
  // and grouped, nine codes collide across the whole catalogue, and exactly
  // these two fall inside C2's five commands. `request_not_pending` above is
  // used twice by this slice (`:306` under ApproveBorrowRequest, `:316` under
  // RejectBorrowRequest) with the identical sentence, which is a reuse and not
  // a collision — one code still names one thing.
  //
  // `membership_not_active` above says "không thể mượn thêm", which is
  // LendCopy's and HandoverRequest's (`:233`, `:245`) — both of them are about
  // a book going into a child's hands right now. Joining a queue is not that:
  // OPS `:293` says "không thể gửi yêu cầu mượn", and a suspended reader told
  // they cannot borrow *more* would reasonably conclude the queue is open to
  // them.
  membership_not_active_cannot_request:
    "Tài khoản đang tạm khoá, không thể gửi yêu cầu mượn.",
  // `copy_lost_or_retired` above is LendCopy's (`:232`), about the copy a
  // manager is holding. ApproveBorrowRequest's (`:305`) is about a copy the
  // manager *picked from a list* a moment ago, which is why OPS words it "Bản
  // sách đã chọn" — the extra word is the whole difference between "this book
  // is gone" and "the one you just chose is gone, choose another".
  chosen_copy_lost_or_retired: "Bản sách đã chọn đã mất hoặc ngừng dùng.",
  // **New Vietnamese, and the only sentence this slice authors.** OPS §4.2
  // gives HandoverRequest three failure modes (`:244-246`) and none of them
  // describes a `requestId` naming a row with no live hold to hand over — a
  // `pending` request nobody has approved, or one already `rejected`,
  // `cancelled` or `fulfilled`. A stale queue page posts exactly that, so the
  // command has to answer something.
  //
  // Nothing in the catalogue fits. `request_not_pending` ("Yêu cầu này đã được
  // xử lý.") is a false statement about a *pending* request, which is the
  // commonest of the four; `hold_expired` is a false statement about a request
  // that never had a hold; `request_not_queued` is ReceiveReturn's and is about
  // a different title.
  //
  // Factual rather than instructive, unlike most of this map. BR §17.7 asks a
  // refusal to name what to do instead, and what to do instead differs across
  // the four states this covers — approve it; nothing, it was refused; nothing,
  // it was withdrawn; nothing, the book already went out. The queue screen
  // shows which, on the row the button sits in.
  request_not_held: "Yêu cầu này không có bản sách nào đang được giữ chỗ.",

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

  // — members: B2b —
  // OPS §4.3's own sentence, under ProposeProfileChange (`:484`), reused
  // unchanged by UpdateReaderProfile: "nothing differs from the current
  // values" is the same fact whichever of the two write paths BR §6's restated
  // INV-13 sanctions is being asked to do nothing. A no-op that wrote an audit
  // entry would be an entry claiming a change nobody made, which is worse than
  // a refusal — BR §14's audit browser is read as a record of what happened.
  //
  // Checked for a collision before adding, the way B1, B2a and C1 each had to:
  // there is no other sentence in this catalogue about an empty change, and
  // `validation_failed` ("Vui lòng kiểm tra lại thông tin.") is the wrong one —
  // nothing about the input is wrong.
  empty_proposal: "Vui lòng thay đổi ít nhất một trường.",
  // OPS §4.3 gives `not_pending` to ApproveProfileChange (`:500`),
  // RejectProfileChange (`:514`) and CancelProfileChange (`:525`), all three
  // reading "Yêu cầu này đã được xử lý." — and `request_not_pending` above
  // (`:91`) already holds that sentence, character for character. It is a
  // *borrow* request's code (OPS §4.2:306, `:316`), so this is a distinct code
  // and not a reuse: two codes may share a sentence, but one code may not name
  // two different things a later slice will want to tell apart. That is the
  // rule B1 established for `validation_failed`, B2a for `registration_not
  // _pending` ("Đơn đăng ký này đã được xử lý.", the same word `not_pending`
  // under ApproveMembership at `:391`), and C1 for `loan_not_active_cannot
  // _void`. This is the fourth, and B2a named it as B2b's before it was
  // reached.
  profile_change_not_pending: "Yêu cầu này đã được xử lý.",

  // — members: Task 4 (QA remediation) —
  // `suspendMembership`'s own `reason` is optional (a manager may suspend with
  // none, per OPS §4.3) — this is not that command refusing anything. It is
  // the reader-detail screen's own decision, the same shape `NO_REJECT_REASON`
  // already gives `RejectMembership`/`RejectProfileChange`/`RejectComment`/
  // `DeclineDonation`: those four commands each require a reason at the
  // database or the domain; this one does not, but a suspension a volunteer
  // typed with no explanation is a decision nobody, including that volunteer
  // a month later, can act on — so the screen asks before the command ever
  // sees the request. Checked for a collision first: `reject_reason_required`
  // ("Vui lòng ghi lý do từ chối.") is a rejection's word, not a suspension's,
  // and every other `_reason_required` code in this file is similarly one
  // command's own noun.
  suspension_reason_required: "Vui lòng ghi lý do tạm khoá.",

  // — community: B3 —
  // OPS §4.4's own sentences. `comment_not_pending` is the **fifth** slice in a
  // row to split a `not_pending` code: OPS gives it "Bình luận này đã được xử
  // lý." here, which is a different sentence from `registration_not_pending`,
  // `profile_change_not_pending` and `request_not_pending` alike — the noun
  // changes, and a volunteer moderating comments should read about a comment.
  // One code, one sentence, per the rule `messageFor` depends on.
  comments_disabled: "Tủ sách hiện không nhận bình luận.",
  empty_body: "Vui lòng nhập nội dung bình luận.",
  comment_not_pending: "Bình luận này đã được xử lý.",
  comment_not_approved: "Chỉ có thể ẩn bình luận đang hiển thị.",
  // Announcements. `announcement_fields_required` rather than reusing
  // `validation_failed`: OPS §4.4 gives it its own sentence ("Vui lòng điền
  // tiêu đề và nội dung."), which is the third distinct sentence that code
  // carries across the catalogue — B1 split the first two.
  announcement_fields_required: "Vui lòng điền tiêu đề và nội dung.",
  already_published: "Thông báo này đã được đăng.",
  // — administration: added by B4 —
  //
  // Three codes, each for a refusal OPS §4.5 names. `slug_taken` is the one
  // OPS does not list: `bookshelves.slug` is `unique` with no partial
  // predicate, so a soft-deleted shelf still holds its address, and the
  // alternative to a sentence here is the raw `23505` §2 forbids.
  slug_taken: "Địa chỉ này đã có tủ sách khác dùng.",
  already_archived: "Tủ sách này đã được lưu trữ.",
  already_super_admin: "Người này đã là quản trị viên hệ thống.",
  // Feedback. The rate limit is OPS §8's, stated verbatim in the shipped form.
  rate_limited: "Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày, để tránh tin rác.",
  feedback_fields_required: "Vui lòng điền đầy đủ các trường bắt buộc.",
  // Donations. `donation_not_pending` is the **sixth** split of a `not_pending`
  // code and OPS §4.4 again gives it its own noun — "Đề nghị tặng sách này đã
  // được xử lý."
  empty_description: "Vui lòng mô tả sách bạn muốn tặng.",
  donation_not_pending: "Đề nghị tặng sách này đã được xử lý.",
  // OPS §4.3's two failure modes for ProposeAvatarChange (`:567`, `:568`),
  // quoted. Neither is raised by a command: both are facts about *bytes*, and
  // `tests/architecture/boundaries.test.ts` forbids `src/domain/` from touching
  // any. They are raised by `src/lib/avatar.ts` before the command runs, with
  // these codes, so the sentence a reader sees is the catalogue's rather than
  // one the surface invented for itself — which is the whole reason
  // `ERROR_MESSAGES` lives in the domain and not beside a screen.
  //
  // `file_too_large`'s sentence names the number, which is what makes the limit
  // implementable: OPS attributes both "≤2 MB" and "square" to "the profile
  // screen's own copy", and that copy does not exist — `2 MB`, `MB`, `vuông`
  // and `square` appear nowhere under `src/app/` or `src/components/`. So the
  // size is enforced from this sentence and **no aspect-ratio check exists
  // anywhere**: "square" has no sentence, no code and no source, and B2b's plan
  // §8 asks the product owner for it rather than inventing a refusal with
  // Vietnamese nobody wrote.
  file_too_large: "Ảnh vượt quá 2 MB.",
  invalid_image: "Tệp này không phải là ảnh hợp lệ.",

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
  // Reshaped from a bare `Error` on re-review (fix-report, 2026-08-08-b2
  // -members): a boot-time wiring gap belongs in the same catalogue as
  // `audit_forbidden_field` and `audit_nesting_too_deep` above — an internal
  // fault no volunteer can act on, but OPS §2 still asks for a named code and
  // a sentence rather than an unstructured exception. Two codes, not one,
  // so which setter was skipped survives on the error itself rather than
  // only in a message string.
  password_hasher_not_wired:
    "Hệ thống chưa sẵn sàng để tạo mật khẩu, vui lòng thử lại sau.",
  password_verifier_not_wired:
    "Hệ thống chưa sẵn sàng để kiểm tra mật khẩu, vui lòng thử lại sau.",
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
 * Reshaped into a coded `DomainError` on re-review (fix-report,
 * 2026-08-08-b2-members). The bare-`Error` shape above argued that a code
 * here would burden "every exhaustive `switch` over `ErrorCode`" — checked
 * directly: `ErrorCode` has exactly two consumers in `src/`, `messageFor` and
 * this class's own constructor (inherited from `DomainError`); every other
 * import only propagates the *type*, and no `switch` over the union exists
 * anywhere in the codebase. There was nothing to burden. Meanwhile this is
 * exactly the class of internal fault `audit_forbidden_field`,
 * `audit_nesting_too_deep`, `invalid_bookshelf_id` and
 * `write_target_not_found` already cover — something no volunteer can act
 * on, carrying a code and a Vietnamese sentence anyway because OPS §2 asks
 * for a named failure everywhere, not only where a real user might plausibly
 * read the result as a legitimate outcome. This is the third time a bare
 * exception in this shape has been replaced with one of these (the audit
 * guard's own `Error` and `RangeError`, `src/domain/kernel/audit.ts`, were
 * the first two).
 *
 * Loudness survives the reshape unchanged: `src/app/dang-nhap/actions.ts`
 * catches only `RuleViolated` with `code === "sign_in_failed"` and rethrows
 * everything else, `DomainError` included, so this still surfaces as an
 * uncaught exception and a server fault rather than a caught, swallowed
 * refusal. `NotWired` is its own marker — a sibling of `NotFound`,
 * `ValidationFailed` and `RuleViolated` under `DomainError`, not a
 * `RuleViolated` itself — because what it names is not a business rule the
 * input failed; it is the boot sequence's own omission. Two codes, one per
 * setter, so which dependency was never wired is still readable off the
 * error itself (`.code`), not only reconstructable from a message string.
 */
export class NotWired extends DomainError {}
