<?php

/**
 * Business-rule refusal sentences, keyed by RuleViolated code — OPS §2's
 * "stable, machine-readable code paired with the plain Vietnamese sentence
 * the UI shows". Sentences are OPS §4.1's verbatim where it names one, and
 * the reference's ERROR_MESSAGES (old_next/src/domain/kernel/errors.ts)
 * verbatim for the codes OPS does not tabulate.
 */
return [
    'duplicate_isbn' => 'Mã ISBN này đã tồn tại trong tủ sách.',
    'has_active_loans' => 'Không thể xoá sách đang có bản được mượn.',
    'already_lost' => 'Bản sách này đã được báo mất.',
    'already_retired' => 'Bản sách đã ngừng dùng, không thể báo mất.',
    'not_lost' => 'Bản sách này hiện không ở trạng thái đã mất.',
    'copy_on_loan' => 'Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước.',
    'copy_not_available' => 'Bản sách này đang được mượn hoặc đang giữ chỗ.',
    'copy_not_on_loan' => 'Chỉ có thể báo mất bản sách đang được mượn.',
    'retire_reason_required' => 'Vui lòng ghi lý do ngừng dùng bản sách này.',
    'donor_ambiguous' => 'Chọn bạn đọc hoặc gõ tên người tặng, không chọn cả hai.',
    'donor_membership_invalid' => 'Không tìm thấy bạn đọc này trên tủ sách hiện tại.',
    'copy_count_invalid' => 'Số bản phải lớn hơn 0.',

    // ── Members (Phase 1b) ────────────────────────────────────────────
    'membership_not_found' => 'Không tìm thấy bạn đọc này.',
    'username_taken' => 'Tên đăng nhập đã được dùng, hãy chọn tên khác.',
    'username_in_use' => 'Tên đăng nhập này đã có người dùng.',
    'password_too_short' => 'Mật khẩu cần ít nhất 8 ký tự.',
    'passwords_dont_match' => 'Mật khẩu nhập lại không khớp.',
    'required_fields_missing' => 'Vui lòng điền đầy đủ các trường bắt buộc.',
    'validation_failed' => 'Vui lòng kiểm tra lại thông tin.',
    'already_registered_here' => 'Bạn đã đăng ký ở tủ sách này rồi.',
    'registration_not_pending' => 'Đơn đăng ký này đã được xử lý.',
    'reject_reason_required' => 'Vui lòng ghi lý do từ chối.',
    'not_active_cannot_suspend' => 'Chỉ có thể tạm khoá tài khoản đang hoạt động.',
    'not_suspended_cannot_reactivate' => 'Chỉ có thể kích hoạt lại tài khoản đang tạm khoá.',
    'member_has_active_loans' => 'Bạn đọc này còn sách chưa trả, hãy nhận trả trước.',
    'phone_invalid' => 'Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.',
    'empty_proposal' => 'Vui lòng thay đổi ít nhất một trường.',
    'not_permitted' => 'Bạn không có quyền thực hiện việc này.',
    'thieu-so-dien-thoai' => 'Bạn chưa nhập số điện thoại. Hãy nhập số, hoặc cho biết lý do chưa có.',
    'parish_unit_l1_not_found' => 'Đơn vị bậc 1 đã chọn không tồn tại.',
    'parish_unit_l2_not_found' => 'Đơn vị bậc 2 đã chọn không tồn tại.',
    'parish_unit_l2_not_in_l1' => 'Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.',
    'suspension_reason_required' => 'Vui lòng ghi lý do tạm khoá.',
    'shelf_not_found' => 'Không tìm thấy tủ sách này.',

    // ── Circulation (Phase 1c) ────────────────────────────────────────
    'copy_lost_or_retired' => 'Bản sách này đã mất hoặc ngừng dùng.',
    'membership_not_active' => 'Tài khoản đang tạm khoá, không thể mượn thêm.',
    'loan_limit_reached' => 'Bạn đọc đã mượn tối đa số sách cho phép.',
    'loan_not_active' => 'Lượt mượn này đã được xử lý.',
    'loan_not_active_cannot_void' => 'Chỉ có thể huỷ lượt mượn đang diễn ra.',
    'no_renewals_remaining' => 'Bạn đã dùng hết số lần gia hạn cho lượt mượn này.',
    'title_has_queue' => 'Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.',
    'title_has_no_copies' => 'Cuốn này chưa có bản sách nào trong tủ.',
    'reason_required' => 'Vui lòng ghi lý do huỷ.',

    // ── Oversight (Phase 1d) ──────────────────────────────────────────
    // Authored by this plan, not OPS (the member_has_active_loans
    // precedent): the code guards a programming error, so the sentence
    // tells the volunteer the one thing they can do about it.
    'audit_forbidden_field' => 'Không thể ghi nhật ký cho thao tác này. Vui lòng báo quản trị viên.',
    'audit_nesting_too_deep' => 'Dữ liệu ghi nhật ký lồng quá sâu, không thể lưu. Vui lòng báo quản trị viên.',

    // A UI sentence, not a refusal — kept beside them so server copy stays
    // in lang/vi/. The census test only walks `new RuleViolated(...)`
    // literals, so this key is inert to it.
    'lend_success_flash' => 'Đã cho :name mượn ":title" — hạn trả :due.',
    'return_success_flash' => 'Đã nhận trả bản :code — sách đã về kệ.',
    'renew_success_flash' => 'Đã gia hạn — hạn trả mới là :due.',
];
