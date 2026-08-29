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
];
