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
    'copy_qr_printed' => 'in nhãn QR cho :count bản sách',

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
    // The reference's phrase verbatim (audit-actions.ts's
    // announcement.updated): `sửa thông báo ${which(str(f.after,
    // "title"))}`. Its `which` fallback is a BOOK fallback here, the same
    // way the created pair's is, so the no-title arm gets its own line.
    'announcement_updated' => 'sửa thông báo :title',
    'announcement_updated_bare' => 'sửa một thông báo',
    // Slice B's four state changes, each the reference's phrase verbatim
    // (audit-actions.ts's announcement.published / .pinned / .unpinned /
    // .hidden): `đăng thông báo ${which(...)}`, `ghim thông báo …`,
    // `bỏ ghim thông báo …`, `ẩn thông báo …`. Every one of them runs the
    // title through its own `which`, whose fallback here is a BOOK
    // fallback — the some_book line above reads 'một cuốn sách' — so each
    // gets its own bare arm rather than borrowing it, the same way the
    // created and updated pairs do.
    //
    // announcement_hidden is spelled out beside comment_hidden rather
    // than sharing it: the comment sentence carries a :because clause
    // (HideComment takes an optional reason) and HideAnnouncement takes
    // none, so one key for both would offer a slot nothing can fill.
    'announcement_published' => 'đăng thông báo :title',
    'announcement_published_bare' => 'đăng một thông báo',
    'announcement_pinned' => 'ghim thông báo :title',
    'announcement_pinned_bare' => 'ghim một thông báo',
    'announcement_unpinned' => 'bỏ ghim thông báo :title',
    'announcement_unpinned_bare' => 'bỏ ghim một thông báo',
    'announcement_hidden' => 'ẩn thông báo :title',
    'announcement_hidden_bare' => 'ẩn một thông báo',
    // Slice C's offer, the reference's phrase verbatim
    // (audit-actions.ts's donation.offered, whose phrase is `() => "đề
    // nghị tặng sách"`). It takes no facts there and takes none here, so
    // its arm needs no strtr and no bare twin: there is no :title to lose
    // and therefore no fallback to write. The description is deliberately
    // NOT interpolated — INV-8's payload does not carry it, for the
    // reason App\Actions\Community\OfferDonation's docblock gives.
    'donation_offered' => 'đề nghị tặng sách',
    // Slice C's two decisions, both the reference's phrases verbatim
    // (audit-actions.ts, opened for this: donation.received is `() =>
    // "nhận một đề nghị tặng sách"` and donation.declined is `(f) =>
    // `từ chối một đề nghị tặng sách${because(str(f.after, "reason"))}``).
    //
    // donation_received takes no facts there and takes none here, so its
    // arm needs no strtr and no bare twin.
    //
    // donation_declined carries the :because slot this file already
    // defines, filled from the payload's `reason` — comment_rejected's
    // shape, spelled with no space before the token because the
    // 'because' line above supplies its own leading space.
    'donation_received' => 'nhận một đề nghị tặng sách',
    'donation_declined' => 'từ chối một đề nghị tặng sách:because',

    // — quản trị hệ thống —
    // Phase 3b-i's administration group. Note the key shape: this file
    // spells an action's key with an underscore where the action name has a
    // dot ('bookshelf.created' -> 'bookshelf_created'), the same convention
    // every line above follows.
    //
    // bookshelf_created is the reference's phrase verbatim
    // (audit-actions.ts:592-598, whose phrase is `name ? `mở tủ sách
    // ${name}` : "mở một tủ sách mới"`), bare twin included — its `str`
    // returns null for a missing or blank name, exactly as this file's
    // helper does.
    'bookshelf_created' => 'mở tủ sách :name',
    'bookshelf_created_bare' => 'mở một tủ sách mới',
    // NOT the reference's wording, and the divergence is the action's
    // scope rather than a translation preference. Its entry is named
    // bookshelf.settings_updated and reads 'sửa cài đặt tủ sách' —
    // *settings*. Ours is bookshelf.updated and covers both halves of the
    // editor: the profile (name, địa điểm, địa chỉ, giới thiệu, ngày thành
    // lập) as well as the lending policy. 'cài đặt' would describe a
    // corrected address as a settings change, so this says 'thông tin'.
    'bookshelf_updated' => 'sửa thông tin tủ sách :name',
    'bookshelf_updated_bare' => 'sửa thông tin một tủ sách',
    // Task 6's pair. bookshelf_archived is the reference's phrase verbatim
    // (audit-actions.ts:606-614, whose phrase is `name ? `ngưng hoạt động
    // tủ sách ${name}` : "ngưng hoạt động một tủ sách"`), bare twin
    // included — and 'ngưng hoạt động' rather than 'lưu trữ' because that
    // is what a volunteer reading the log needs to know happened: the tủ
    // sách stopped serving, nothing was thrown away.
    'bookshelf_archived' => 'ngưng hoạt động tủ sách :name',
    'bookshelf_archived_bare' => 'ngưng hoạt động một tủ sách',
    // Ours, since the reference has no un-archive command to phrase (spec
    // D4). 'mở lại' is the plain opposite of the sentence above and echoes
    // 'mở tủ sách' from bookshelf_created, so a shelf's log reads as one
    // story: mở → sửa → ngưng hoạt động → mở lại.
    'bookshelf_unarchived' => 'mở lại tủ sách :name',
    'bookshelf_unarchived_bare' => 'mở lại một tủ sách',
    // Task 7's three, all three the reference's phrases verbatim
    // (audit-actions.ts:619-630). NO _bare TWINS, unlike the four lines
    // above: those substitute a name read out of the payload, which can be
    // missing, while these substitute a SUBJECT, and who() already falls
    // back to 'một người' on its own — the same shape every membership.*
    // line above uses.
    //
    // 'quyền quản lý' covers both roles the assign form offers, manager and
    // shelf admin, and that is deliberate rather than lossy: which of the
    // two was given is on the payload row one tap away (INV-8's own
    // placement), and a log sentence that had to say 'quản trị tủ sách' in
    // one case and 'quản lý' in the other would read as two different acts
    // when the revoke that undoes either is one.
    'membership_role_assigned' => 'giao quyền quản lý cho :subject',
    'membership_role_revoked' => 'thu hồi quyền quản lý của :subject',
    // 'hệ thống', not 'tủ sách' — the whole point of this row is that it
    // belongs to no shelf.
    'user_promoted_super_admin' => 'giao quyền quản trị hệ thống cho :subject',

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
