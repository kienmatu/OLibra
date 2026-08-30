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
    'request_expired' => 'kết thúc giữ chỗ quá hạn của :subject và trả bản sách về kệ',

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

    // — cộng đồng —
    // The reference's phrase verbatim (audit-actions.ts's comment.created).
    // It names neither the title nor the author, deliberately: the payload
    // holds book_id and no title, and widening the payload to make a
    // sentence prettier is the trade this refuses.
    'comment_created' => 'viết một bình luận',
    // The reference's phrase verbatim (audit-actions.ts's
    // comment.approved). Deliberately not "duyệt bình luận của :subject":
    // the payload carries the two statuses and no author, and the audit
    // row's subject join has no key to work from.
    'comment_approved' => 'duyệt một bình luận',
    // The reference's phrase verbatim (audit-actions.ts's
    // comment.rejected), reusing the existing :because line — RejectComment
    // always has a reason (it is required), so the "because" clause is
    // present in practice; the helper line itself is shared rather than
    // spelled a second time.
    'comment_rejected' => 'từ chối một bình luận:because',
    // The reference's phrase verbatim (audit-actions.ts's comment.hidden).
    // HideComment's reason is optional, so :because renders empty when the
    // payload carries none — the same helper copy_retired and loan_voided
    // already use.
    'comment_hidden' => 'ẩn một bình luận:because',
    // The reference's phrase verbatim (audit-actions.ts's
    // announcement.created): `soạn thông báo ${which(str(f.after,
    // "title"))}`. Its `which` fallback is a BOOK fallback here — the
    // some_book line above reads 'một cuốn sách' — so the no-title arm
    // gets its own line rather than borrowing it.
    'announcement_created' => 'soạn thông báo :title',
    'announcement_created_bare' => 'soạn một thông báo',

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
