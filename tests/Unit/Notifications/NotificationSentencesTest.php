<?php

use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\NotificationSentences;

it('membership_approved renders its fixed sentence', function () {
    expect(NotificationSentences::sentence('membership_approved', []))
        ->toBe('Đơn đăng ký của bạn đã được duyệt. Chúc bạn đọc sách vui!');
});

it('membership_rejected carries the reason when there is one, and degrades when not', function () {
    expect(NotificationSentences::sentence('membership_rejected', ['reason' => 'thiếu thông tin']))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt vì thiếu thông tin.')
        ->and(NotificationSentences::sentence('membership_rejected', []))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt.')
        // A blank or whitespace reason is NO reason — never " vì ".
        ->and(NotificationSentences::sentence('membership_rejected', ['reason' => '  ']))
        ->toBe('Đơn đăng ký của bạn chưa được duyệt.');
});

it('request_approved renders the title and the deadline as a Vietnamese date', function () {
    expect(NotificationSentences::sentence('request_approved', ['title' => 'Hoàng Tử Bé', 'hold_until' => '2026-09-01']))
        ->toBe('Hoàng Tử Bé đã sẵn sàng, bạn đến nhận trước ngày 01/09/2026 nhé.')
        ->and(NotificationSentences::sentence('request_approved', []))
        ->toBe('cuốn sách đã sẵn sàng, bạn đến nhận sớm nhé.')
        // A stored value that is not a date is no date — never half of one
        // glued into the sentence.
        ->and(NotificationSentences::sentence('request_approved', ['title' => 'Hoàng Tử Bé', 'hold_until' => 'sắp tới']))
        ->toBe('Hoàng Tử Bé đã sẵn sàng, bạn đến nhận sớm nhé.');
});

it('request_rejected carries the title and, when given, the reason', function () {
    expect(NotificationSentences::sentence('request_rejected', ['title' => 'Totto-chan Bên Cửa Sổ', 'reason' => 'thiếu thẻ']))
        ->toBe('Yêu cầu mượn Totto-chan Bên Cửa Sổ chưa được duyệt vì thiếu thẻ.')
        ->and(NotificationSentences::sentence('request_rejected', []))
        ->toBe('Yêu cầu mượn cuốn sách chưa được duyệt.');
});

it('loan_due_soon names the book and reads its due date as a date', function () {
    expect(NotificationSentences::sentence('loan_due_soon', ['title' => 'Đất Rừng Phương Nam', 'due_on' => '2026-09-01']))
        ->toBe('Đất Rừng Phương Nam sắp đến hạn trả, ngày 01/09/2026.')
        ->and(NotificationSentences::sentence('loan_due_soon', []))
        ->toBe('cuốn sách sắp đến hạn trả, ngày sắp tới.');
});

it('loan_due_soon degrades to its dateless line when the stored due date is not one', function () {
    // A separate it() on purpose: a failed expect() aborts the whole test
    // METHOD, so the two halves of "renders" and "degrades" cannot both be
    // shown failing from one block.
    expect(NotificationSentences::sentence('loan_due_soon', ['title' => 'Đất Rừng Phương Nam', 'due_on' => 'sắp tới']))
        ->toBe('Đất Rừng Phương Nam sắp đến hạn trả, ngày sắp tới.');
});

it('loan_overdue names the book and asks for it back', function () {
    expect(NotificationSentences::sentence('loan_overdue', ['title' => 'Totto-chan Bên Cửa Sổ', 'due_on' => '2026-08-20']))
        ->toBe('Totto-chan Bên Cửa Sổ đã quá hạn trả. Bạn mang sách đến trả giúp nhé.')
        ->and(NotificationSentences::sentence('loan_overdue', []))
        ->toBe('cuốn sách đã quá hạn trả. Bạn mang sách đến trả giúp nhé.');
});

it('comment_approved renders its fixed sentence from an empty payload', function () {
    // 2b's one kind, and the only one whose payload is empty by design
    // (divergence 10) — so the sentence has to be complete with nothing
    // in hand, the MembershipApproved shape. The Vietnamese is
    // kinds.ts's comment_approved verbatim, second clause included: it
    // is what tells a child their words are on the page now.
    expect(NotificationSentences::sentence('comment_approved', []))
        ->toBe('Bình luận của bạn đã được duyệt và hiện đã hiển thị.')
        // A stray payload key changes nothing — there is no strtr to
        // reach it.
        ->and(NotificationSentences::sentence('comment_approved', ['title' => 'Dế Mèn Phiêu Lưu Ký']))
        ->toBe('Bình luận của bạn đã được duyệt và hiện đã hiển thị.');
});

it('profile_change_approved renders its fixed sentence from an empty payload', function () {
    // 3c-i's first kind, and the MembershipApproved shape: the values are
    // on the reader's own profile page, so the bell says only that they
    // moved. A stray payload key changes nothing — there is no strtr.
    expect(NotificationSentences::sentence('profile_change_approved', []))
        ->toBe('Thông tin cá nhân của bạn đã được cập nhật.')
        ->and(NotificationSentences::sentence('profile_change_approved', ['phone' => '0922222222']))
        ->toBe('Thông tin cá nhân của bạn đã được cập nhật.');
});

it('profile_change_rejected carries the manager\'s reason, and degrades when there is none', function () {
    // BR:490 names this one "carrying the manager's reason", so the reason
    // is the point of the sentence. RejectProfileChange refuses a blank
    // one before any write, so the degraded halves below describe a row
    // written by hand or by an older build — never one this system wrote.
    expect(NotificationSentences::sentence('profile_change_rejected', ['reason' => 'số này là của hàng xóm']))
        ->toBe('Yêu cầu cập nhật thông tin của bạn chưa được duyệt vì số này là của hàng xóm.')
        ->and(NotificationSentences::sentence('profile_change_rejected', []))
        ->toBe('Yêu cầu cập nhật thông tin của bạn chưa được duyệt.')
        ->and(NotificationSentences::sentence('profile_change_rejected', ['reason' => '  ']))
        ->toBe('Yêu cầu cập nhật thông tin của bạn chưa được duyệt.');
});

it('an unknown stored kind renders the neutral line, never the raw token', function () {
    // Rows written by an older or newer build survive a deploy; a kind
    // this build does not know is a real state, not a programming error
    // (the reference's kinds.ts rule).
    expect(NotificationSentences::sentence('request_teleported', ['title' => 'X']))
        ->toBe('Bạn có một thông báo mới.');
});

it('every enum case has a lang line, and no lang line is orphaned', function () {
    $lines = require __DIR__.'/../../../lang/vi/notifications.php';
    $kinds = array_map(
        fn (NotificationKind $k) => $k->value,
        NotificationKind::cases(),
    );
    // Kind keys only — helper lines are prefixed with underscore.
    $langKinds = array_values(array_filter(array_keys($lines), fn (string $k) => ! str_starts_with($k, '_')));

    expect($langKinds)->toEqualCanonicalizing($kinds);
});
