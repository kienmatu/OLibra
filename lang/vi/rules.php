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
    'copy_count_invalid' => 'Số bản phải lớn hơn 0.',
];
