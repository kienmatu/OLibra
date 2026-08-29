<?php

// The Vietnamese a reader's bell shows — rendered at READ time from the
// stored payload by NotificationSentences, never stored pre-glued (a
// stored sentence would freeze every typo forever). Kind keys mirror
// NotificationKind cases exactly; NotificationSentencesTest holds the two
// sets equal. Helper lines are _-prefixed and excluded from that census.
return [
    '_unknown' => 'Bạn có một thông báo mới.',
    '_which' => 'cuốn sách',       // when a payload carries no title
    '_because' => ' vì :reason',   // absent reason → absent clause, never "null"

    'membership_approved' => 'Đơn đăng ký của bạn đã được duyệt. Chúc bạn đọc sách vui!',
    'membership_rejected' => 'Đơn đăng ký của bạn chưa được duyệt:because.',

    'request_approved' => ':book đã sẵn sàng, bạn đến nhận trước ngày :until nhé.',
    'request_rejected' => 'Yêu cầu mượn :book chưa được duyệt:because.',
    // Underscore-prefixed because it is a HELPER line, not a kind: a
    // payload with no hold_until still needs a sentence, and
    // NotificationSentencesTest's census holds the non-underscored keys
    // set-equal to NotificationKind::cases(). A bare
    // 'request_approved_no_date' would fail that census on this commit.
    '_request_approved_no_date' => ':book đã sẵn sàng, bạn đến nhận sớm nhé.',

    // The sweep's pair (OPS §7). Two things to say about one book, so two
    // kinds: a warning while the loan still stands, a reminder once it has
    // lapsed. The bare line is the same helper shape as the one above — a
    // payload with no readable due_on still needs a sentence.
    'loan_due_soon' => ':book sắp đến hạn trả, ngày :due.',
    '_loan_due_soon_bare' => ':book sắp đến hạn trả, ngày sắp tới.',
    'loan_overdue' => ':book đã quá hạn trả. Bạn mang sách đến trả giúp nhé.',
];
