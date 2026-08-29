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
