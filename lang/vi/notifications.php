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

    // 2b's one kind, written by ApproveComment. No placeholders, because
    // the reference sends no payload (divergence 10) — a reader with two
    // approved comments reads the same sentence twice, by design.
    //
    // TRANSCRIBED FROM THE REFERENCE, and it differs from the plan's own
    // draft of this line, which reads 'Bình luận của bạn đã được duyệt.'
    // kinds.ts's comment_approved sentence is "Bình luận của bạn đã được
    // duyệt và hiện đã hiển thị." — the second clause is the half that
    // tells a child their words are now on the page, and dropping it
    // would be a product change nothing in the plan names as a
    // divergence. Every other line in this file is the reference word for
    // word — placeholder spelling and the named date-rendering divergence
    // aside (NotificationSentences::date's docblock) — so this one is
    // too.
    'comment_approved' => 'Bình luận của bạn đã được duyệt và hiện đã hiển thị.',
];
