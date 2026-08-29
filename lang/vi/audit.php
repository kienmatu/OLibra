<?php

/**
 * BR §14's audit sentences — server copy, the rules.php side of the copy
 * line. Wording is the reference's audit-actions.ts verbatim for every
 * action a shipped command writes; nothing here renders a raw action name
 * (the 'unknown' phrase is the fallback, and the stored name appears only
 * in the expansion). The condition words duplicate copy.ts's six on
 * purpose — server sentences cannot reach client copy — and
 * AuditSentencesTest pins the two lists against each other so they cannot
 * drift silently.
 */
return [
    'frame' => ':actor đã :phrase',
    'system_actor' => 'Hệ thống',
    'unknown' => 'thực hiện một thao tác hệ thống chưa được mô tả',
    'someone' => 'một bạn đọc',
    'some_book' => 'một cuốn sách',
    'because' => ' vì :reason',

    // — sách —
    'book_created' => 'thêm sách :title',
    'book_updated' => 'sửa thông tin sách :title',
    'book_deleted' => 'xoá sách :title',
    'copy_added' => 'thêm bản sách :code',
    'copy_added_bare' => 'thêm một bản sách',
    'copy_condition_assessed' => 'ghi nhận tình trạng một bản sách: :condition',
    'copy_condition_assessed_bare' => 'ghi nhận tình trạng một bản sách',
    'copy_retired' => 'ngừng dùng một bản sách:because',
    'copy_lost_reported' => 'báo mất một bản sách',
    'copy_found' => 'tìm lại được một bản sách đã mất',

    // — mượn và trả —
    'loan_created' => 'cho :subject mượn :title',
    'loan_created_bare' => 'cho mượn :title',
    'loan_returned' => 'nhận trả :title:from:state',
    'loan_returned_from' => ' từ :subject',
    'loan_returned_state' => ', tình trạng :condition',
    'loan_renewed' => 'gia hạn một lượt mượn',
    'loan_voided' => 'huỷ một lượt mượn:because',
    'loan_lost' => 'kết thúc một lượt mượn vì sách bị mất',
    'request_created' => 'gửi yêu cầu mượn :title',
    'request_approved' => 'giữ chỗ một cuốn sách cho bạn đọc đang chờ',
    'request_rejected' => 'từ chối yêu cầu mượn :title của :subject:because',
    'request_cancelled' => 'rút lại yêu cầu mượn :title',
    'request_fulfilled' => 'giao cuốn sách đã giữ chỗ cho bạn đọc',

    // — bạn đọc —
    'membership_registered' => 'nhận đăng ký của :name',
    'membership_registered_bare' => 'nhận một đăng ký mới',
    'membership_approved' => 'duyệt tài khoản của :subject',
    'membership_rejected' => 'từ chối đăng ký của :subject:because',
    'membership_suspended' => 'tạm khoá tài khoản của :subject',
    'membership_reactivated' => 'mở lại tài khoản của :subject',
    'membership_left' => 'đánh dấu :subject đã rời tủ sách',
    'credentials_set' => 'đặt hoặc đổi tài khoản đăng nhập cho :subject',
    'profile_corrected' => 'sửa hồ sơ của :subject',

    // BR §9's six words — copy.ts book.condition, duplicated by necessity
    // (see the file docblock) and pinned by parity test.
    'conditions' => [
        'perfect' => 'Nguyên vẹn',
        'slightly_worn' => 'Hơi cũ',
        'worn' => 'Cũ',
        'torn' => 'Rách',
        'missing_pages' => 'Mất trang',
        'written_on' => 'Bị vẽ vào',
    ],
];
