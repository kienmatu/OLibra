<?php

use App\Support\Audit\AuditSentences;

// Grep first: `grep -rn "^function audFacts" tests/` — top-level helpers
// are process-global (AGENTS.md).
function audFacts(?string $actor = null, ?string $subject = null, ?array $before = null, ?array $after = null): array
{
    return ['actor' => $actor, 'subject' => $subject, 'before' => $before, 'after' => $after];
}

it('renders BR §14\'s shape: actor, đã, phrase', function () {
    $s = AuditSentences::sentence('loan.created', audFacts(
        actor: 'Maria Nguyễn Thị Lan',
        subject: 'Giuse Văn Mượn',   // outside UserFactory's pool on purpose
        after: ['title' => 'Dế Mèn Phiêu Lưu Ký', 'borrower_id' => 'x'],
    ));

    expect($s)->toBe('Maria Nguyễn Thị Lan đã cho Giuse Văn Mượn mượn Dế Mèn Phiêu Lưu Ký');
});

it('a null actor renders as Hệ thống, never as an empty subject', function () {
    expect(AuditSentences::sentence('copy.lost_reported', audFacts()))
        ->toBe('Hệ thống đã báo mất một bản sách');
});

it('an unknown action gets the fallback phrase and NEVER the raw name', function () {
    $s = AuditSentences::sentence('bookshelf.created', audFacts(actor: 'Ai Đó'));
    expect($s)->toBe('Ai Đó đã thực hiện một thao tác hệ thống chưa được mô tả')
        ->and($s)->not->toContain('bookshelf.created');
});

it('request.created names the title, and falls back when the payload has none', function () {
    // Required by the plan's Step 6 mutation 3, whose own escape clause
    // this is: deleting lang/vi/audit.php's request_created line reddens
    // NOTHING otherwise — measured, the whole suite stayed green at 1085
    // passed. There is no every-action-renders sweep in this file; its
    // cases are per-action, so a new action needs its own. Without this,
    // request.created's sentence is a string nothing pins.
    expect(AuditSentences::sentence('request.created', audFacts(
        actor: 'Têrêsa Bạn Đọc Nhỏ',
        after: ['status' => 'pending', 'title' => 'Dế Mèn Phiêu Lưu Ký'],
    )))->toBe('Têrêsa Bạn Đọc Nhỏ đã gửi yêu cầu mượn Dế Mèn Phiêu Lưu Ký')
        ->and(AuditSentences::sentence('request.created', audFacts(actor: 'Têrêsa Bạn Đọc Nhỏ')))
        ->toBe('Têrêsa Bạn Đọc Nhỏ đã gửi yêu cầu mượn một cuốn sách');
});

it('a missing subject falls back to "một bạn đọc", a missing title to "một cuốn sách"', function () {
    expect(AuditSentences::sentence('membership.approved', audFacts(actor: 'Maria Q')))
        ->toBe('Maria Q đã duyệt tài khoản của một bạn đọc')
        ->and(AuditSentences::sentence('loan.created', audFacts(actor: 'Maria Q', subject: 'Bé An')))
        ->toBe('Maria Q đã cho Bé An mượn một cuốn sách');
});

it('loan.returned assembles from-clause, condition and title independently', function () {
    expect(AuditSentences::sentence('loan.returned', audFacts(
        actor: 'Maria Q', subject: 'Bé An',
        after: ['title' => 'Hoàng Tử Bé', 'condition' => 'torn'],
    )))->toBe('Maria Q đã nhận trả Hoàng Tử Bé từ Bé An, tình trạng Rách');

    // No subject, unknown condition value: both clauses drop cleanly.
    expect(AuditSentences::sentence('loan.returned', audFacts(
        actor: 'Maria Q', after: ['title' => 'Hoàng Tử Bé', 'condition' => 'shredded'],
    )))->toBe('Maria Q đã nhận trả Hoàng Tử Bé');
});

it('a reason interpolates as " vì …" and is absent when blank or missing', function () {
    expect(AuditSentences::sentence('loan.voided', audFacts(actor: 'Maria Q', after: ['reason' => 'bấm nhầm'])))
        ->toBe('Maria Q đã huỷ một lượt mượn vì bấm nhầm')
        ->and(AuditSentences::sentence('loan.voided', audFacts(actor: 'Maria Q', after: ['reason' => '   '])))
        ->toBe('Maria Q đã huỷ một lượt mượn');
});

it('str() semantics: a non-string payload value is treated as absent, never coerced', function () {
    // The reference's rule: String(false) mid-sentence is worse than a
    // fallback. A boolean title must not render.
    expect(AuditSentences::sentence('book.created', audFacts(actor: 'Maria Q', after: ['title' => false])))
        ->toBe('Maria Q đã thêm sách một cuốn sách');
});

it('request.approved reads as a hold made for a waiting reader, with no title to lose', function () {
    // Same reason request.created has its own case (see it above): this
    // file has no every-action sweep, so an action with no case here has a
    // lang line nothing pins — deleting lang/vi/audit.php's
    // request_approved line would otherwise leave the suite green.
    //
    // Unlike request.created there is no :title to fall back on: the
    // approval's stored payload is copy_id, the expiry and the reader, so
    // the sentence is fixed and the same one however thin the payload is.
    expect(AuditSentences::sentence('request.approved', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['status' => 'approved', 'copy_id' => 'c1'],
    )))->toBe('Maria Quản Lý Kho đã giữ chỗ một cuốn sách cho bạn đọc đang chờ')
        ->and(AuditSentences::sentence('request.approved', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã giữ chỗ một cuốn sách cho bạn đọc đang chờ');
});

it('request.rejected names the title, the reader, and the reason when there is one', function () {
    // Same reason request.created and request.approved have their own
    // case above: this file has no every-action sweep, so an action with
    // no case here has a lang line nothing pins — deleting
    // lang/vi/audit.php's request_rejected line would otherwise leave
    // the suite green.
    expect(AuditSentences::sentence('request.rejected', audFacts(
        actor: 'Maria Quản Lý Kho', subject: 'Têrêsa Bạn Đọc Nhỏ',
        after: ['status' => 'rejected', 'title' => 'Totto-chan Bên Cửa Sổ', 'reason' => 'thiếu thẻ'],
    )))->toBe('Maria Quản Lý Kho đã từ chối yêu cầu mượn Totto-chan Bên Cửa Sổ của Têrêsa Bạn Đọc Nhỏ vì thiếu thẻ')
        // No subject, no reason, no title: every fallback fires at once.
        ->and(AuditSentences::sentence('request.rejected', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã từ chối yêu cầu mượn một cuốn sách của một bạn đọc');
});

it('request.cancelled names the title, and never names the reader twice', function () {
    // Same reason request.created, request.approved and request.rejected
    // have their own case above: this file has no every-action sweep, so
    // an action with no case here has a lang line nothing pins — deleting
    // lang/vi/audit.php's request_cancelled line would otherwise leave
    // the suite green.
    //
    // The actor IS the subject here (a reader withdrawing their own row),
    // so the phrase takes no :subject and a subject in the facts must not
    // reach the sentence — the second expectation is that, not scenery.
    expect(AuditSentences::sentence('request.cancelled', audFacts(
        actor: 'Têrêsa Bạn Đọc Nhỏ',
        after: ['status' => 'cancelled', 'title' => 'Đất Rừng Phương Nam', 'released_copy_id' => 'c1'],
    )))->toBe('Têrêsa Bạn Đọc Nhỏ đã rút lại yêu cầu mượn Đất Rừng Phương Nam')
        ->and(AuditSentences::sentence('request.cancelled', audFacts(
            actor: 'Têrêsa Bạn Đọc Nhỏ', subject: 'Têrêsa Bạn Đọc Nhỏ',
        )))->toBe('Têrêsa Bạn Đọc Nhỏ đã rút lại yêu cầu mượn một cuốn sách');
});

it('request.fulfilled reads as a held book handed over, with no title to lose', function () {
    // Same reason request.created, request.approved, request.rejected and
    // request.cancelled have their own case above: this file has no
    // every-action sweep, so an action with no case here has a lang line
    // nothing pins — deleting lang/vi/audit.php's request_fulfilled line
    // would otherwise leave the suite green.
    //
    // Like request.approved there is no :title to fall back on: LendCopy's
    // collected-hold payload is status, copy_id and fulfilled_loan_id, so
    // the sentence is fixed and the same one however thin the payload is.
    expect(AuditSentences::sentence('request.fulfilled', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['status' => 'fulfilled', 'copy_id' => 'c1', 'fulfilled_loan_id' => 'l1'],
    )))->toBe('Maria Quản Lý Kho đã giao cuốn sách đã giữ chỗ cho bạn đọc')
        ->and(AuditSentences::sentence('request.fulfilled', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã giao cuốn sách đã giữ chỗ cho bạn đọc');
});

it('request.expired names the reader whose hold lapsed, and no book', function () {
    // Same reason request.created, request.approved, request.rejected,
    // request.cancelled and request.fulfilled have their own case above:
    // this file has no every-action sweep, so an action with no case here
    // has a lang line nothing pins — deleting lang/vi/audit.php's
    // request_expired line would otherwise leave the suite green.
    //
    // Ruling 1's own worked example is the first expectation, character
    // for character. The payload DOES carry a title (the expansion's rows
    // need it), and the sentence must not grow one: a manager reading this
    // line is being told whose turn ended, and the copy is one tap away.
    expect(AuditSentences::sentence('request.expired', audFacts(
        actor: 'Maria Quản Lý Kho', subject: 'Têrêsa Lê Ngọc Ánh',
        after: ['status' => 'expired', 'copy_id' => 'c1', 'title' => 'Hoàng Tử Bé', 'userId' => 'u1'],
    )))->toBe('Maria Quản Lý Kho đã kết thúc giữ chỗ quá hạn của Têrêsa Lê Ngọc Ánh và trả bản sách về kệ')
        // No subject in the facts at all — AuditLogQuery resolves one
        // through LEFT joins, so null is a shape this arm has to render:
        // the fallback fires and the sentence still reads.
        ->and(AuditSentences::sentence('request.expired', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã kết thúc giữ chỗ quá hạn của một bạn đọc và trả bản sách về kệ');
});

it('str() semantics: a TRUTHY non-string is also absent, not (string)-cast', function () {
    // false alone cannot distinguish the type guard from a mutant that
    // replaces `is_string($bag[$key])` with a `(string)` cast: (string)
    // false === '' trims to the same "absent" result either way, so that
    // mutation left all prior tests green. (string) true === '1' does not
    // — a mutant renders "Maria Q đã thêm sách 1" here, where the real
    // guard renders the fallback. This is the probe that tells them apart.
    expect(AuditSentences::sentence('book.created', audFacts(actor: 'Maria Q', after: ['title' => true])))
        ->toBe('Maria Q đã thêm sách một cuốn sách');
});

it('groupOf answers the family for a known action and null for a stranger', function () {
    expect(AuditSentences::groupOf('loan.renewed'))->toBe('loans')
        ->and(AuditSentences::groupOf('credentials.set'))->toBe('readers')
        ->and(AuditSentences::groupOf('copy.retired'))->toBe('books')
        ->and(AuditSentences::groupOf('comment.created'))->toBe('community')
        ->and(AuditSentences::groupOf('bookshelf.created'))->toBeNull();
});

it('announcement.created names the title, and falls back to "một thông báo" when the payload has none', function () {
    // Task 9. Its own block for the reason request.created's block
    // states: the sweep below compares each action's sentence against
    // the UNDESCRIBED-ACTION fallback, and line() on a deleted key
    // evaluates to '' rather than to that fallback.
    //
    // MEASURED, and the measurement is narrower than the first draft of
    // this comment claimed. Deleting announcement_created_bare from
    // lang/vi/audit.php: this block FAILED; the sweep below PASSED,
    // reported as `! ... → Undefined array key
    // "announcement_created_bare"` — a PHP warning, not a failure, so it
    // stays a passing test on a build where a volunteer would read an
    // empty phrase. Run: 1 failed, 1 warning, 19 passed. So this block
    // is what refuses the deletion; the sweep only notices it.
    //
    // The bare arm is also the one that must NOT read 'một cuốn sách':
    // this class's which() helper falls back to the some_book line, and
    // an announcement described as a book is the copy bug this arm's
    // separate lang key exists to avoid.
    expect(AuditSentences::sentence('announcement.created', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['title' => 'Tin Vui Tháng Năm', 'slug' => 'tin-vui-thang-nam', 'published' => false],
    )))->toBe('Maria Quản Lý Kho đã soạn thông báo Tin Vui Tháng Năm');

    expect(AuditSentences::sentence('announcement.created', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã soạn một thông báo');
});

it('announcement.updated names the title, and falls back to "một thông báo" when the payload has none', function () {
    // Task 10, its own block for the reason the created block above
    // states: the sweep below compares each action's sentence against the
    // UNDESCRIBED-ACTION fallback, and line() on a deleted key evaluates
    // to '' rather than to that fallback.
    //
    // MEASURED for THIS pair of keys, in this fix-free round, rather than
    // carried down from the created block's measurement: deleting
    // announcement_updated_bare from lang/vi/audit.php failed this block
    // (`Failed asserting that two strings are identical` on the second
    // expect) while the sweep below stayed green, reporting `!  ... →
    // Undefined array key "announcement_updated_bare"` — a PHP warning,
    // not a failure. Run: 1 failed, 1 warning, 20 passed.
    //
    // The title read is the AFTER one: an edit's sentence names what the
    // announcement is called now. The bare arm must not read 'một cuốn
    // sách' — this class's which() helper falls back to the some_book
    // line, which is why announcement_updated_bare is its own key rather
    // than a which() call.
    expect(AuditSentences::sentence('announcement.updated', audFacts(
        actor: 'Maria Quản Lý Kho',
        before: ['title' => 'Tin Vui Tháng Năm'],
        after: ['title' => 'Tin Vui Tháng Sáu'],
    )))->toBe('Maria Quản Lý Kho đã sửa thông báo Tin Vui Tháng Sáu');

    expect(AuditSentences::sentence('announcement.updated', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã sửa một thông báo');
});

it('announcement.published names the title, and falls back to "một thông báo" when the payload has none', function () {
    // Task 11, and the first of this task's four. Each gets its own
    // block for the reason the created and updated blocks above state:
    // the sweep below compares each action's sentence against the
    // UNDESCRIBED-ACTION fallback, and line() on a deleted key evaluates
    // to '' rather than to that fallback.
    //
    // MEASURED for all four of this task's bare keys, one deletion at a
    // time, rather than carried down from the created block's
    // measurement: deleting announcement_published_bare,
    // announcement_pinned_bare, announcement_unpinned_bare or
    // announcement_hidden_bare from lang/vi/audit.php fails that key's
    // own block below while the sweep stays GREEN, reporting `! ... →
    // Undefined array key "<the key>"` — a PHP warning, not a failure.
    // Every one of the four runs is 1 failed, 1 warning, 24 passed. So
    // these four blocks are what refuse the deletion; the sweep only
    // notices it.
    //
    // The bare arm must not read 'một cuốn sách' — this class's which()
    // helper falls back to the some_book line, which is why
    // announcement_published_bare is its own key rather than a which()
    // call, and the same for the three below.
    expect(AuditSentences::sentence('announcement.published', audFacts(
        actor: 'Maria Quản Lý Kho',
        before: ['published_at' => null],
        after: ['title' => 'Tin Vui Tháng Năm', 'published_at' => '2026-08-30T04:00:00+00:00'],
    )))->toBe('Maria Quản Lý Kho đã đăng thông báo Tin Vui Tháng Năm');

    expect(AuditSentences::sentence('announcement.published', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã đăng một thông báo');
});

it('announcement.pinned names the title, and falls back to "một thông báo" when the payload has none', function () {
    expect(AuditSentences::sentence('announcement.pinned', audFacts(
        actor: 'Maria Quản Lý Kho',
        before: ['is_pinned' => false],
        after: ['title' => 'Tin Vui Tháng Năm', 'is_pinned' => true],
    )))->toBe('Maria Quản Lý Kho đã ghim thông báo Tin Vui Tháng Năm');

    expect(AuditSentences::sentence('announcement.pinned', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã ghim một thông báo');
});

it('announcement.unpinned names the title, and falls back to "một thông báo" when the payload has none', function () {
    // The unpin phrase is the pin phrase with a prefix, and that is
    // exactly why this block asserts the whole sentence rather than
    // merely that it is not the undescribed-action fallback: a
    // copy-paste that left this arm pointing at announcement_pinned
    // would render "ghim" for an act that removed a pin, and "ghim thông
    // báo …" is not the fallback either.
    expect(AuditSentences::sentence('announcement.unpinned', audFacts(
        actor: 'Maria Quản Lý Kho',
        before: ['is_pinned' => true],
        after: ['title' => 'Tin Vui Tháng Năm', 'is_pinned' => false],
    )))->toBe('Maria Quản Lý Kho đã bỏ ghim thông báo Tin Vui Tháng Năm');

    expect(AuditSentences::sentence('announcement.unpinned', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã bỏ ghim một thông báo');
});

it('announcement.hidden reads about a thông báo, never about a bình luận', function () {
    // comment.hidden already renders 'ẩn một bình luận:because'. This
    // action takes its own key, and the second expectation is what
    // refuses a shortcut that pointed this arm at comment_hidden: that
    // line would render the wrong noun AND offer a :because slot
    // HideAnnouncement records nothing to fill.
    expect(AuditSentences::sentence('announcement.hidden', audFacts(
        actor: 'Maria Quản Lý Kho',
        before: ['published_at' => '2026-08-01T03:00:00+00:00'],
        after: ['title' => 'Tin Vui Tháng Năm'],
    )))->toBe('Maria Quản Lý Kho đã ẩn thông báo Tin Vui Tháng Năm');

    expect(AuditSentences::sentence('announcement.hidden', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã ẩn một thông báo');
});

it('donation.offered reads as an offer of books, with nothing interpolated', function () {
    // Task 15, and its own block for the reason the announcement blocks
    // above state: the sweep below compares each action's sentence
    // against the UNDESCRIBED-ACTION fallback, and line() on a deleted
    // key evaluates to '' rather than to that fallback.
    //
    // MEASURED for THIS key rather than carried down: deleting
    // donation_offered from lang/vi/audit.php failed this block
    // ("Failed asserting that two strings are identical") while the sweep
    // below stayed green, reporting `!  ... → Undefined array key
    // "donation_offered"` — a PHP warning, not a failure. Run: 1 failed,
    // 1 warning, 25 passed.
    //
    // The second expectation is the arm's SHAPE, not scenery: the phrase
    // interpolates nothing, so a payload full of facts must render the
    // identical string a thin one does, and the arm needs no bare twin to
    // fall back to. An arm that grew a :title (or a :description) would
    // redden here.
    expect(AuditSentences::sentence('donation.offered', audFacts(
        actor: 'Têrêsa Bạn Đọc Nhỏ',
        after: ['status' => 'pending', 'estimated_count' => 8],
    )))->toBe('Têrêsa Bạn Đọc Nhỏ đã đề nghị tặng sách');

    expect(AuditSentences::sentence('donation.offered', audFacts(actor: 'Têrêsa Bạn Đọc Nhỏ')))
        ->toBe('Têrêsa Bạn Đọc Nhỏ đã đề nghị tặng sách');
});

it('donation.received reads as accepting an offer, with nothing interpolated', function () {
    // Task 16, on the block above's ground: the sweep below compares each
    // action's sentence against the UNDESCRIBED-ACTION fallback, and
    // line() on a deleted key evaluates to '' rather than to that
    // fallback, so an action with no case here has a lang line the sweep
    // cannot pin.
    //
    // The second expectation is the arm's SHAPE: the phrase interpolates
    // nothing, so a payload full of facts renders the identical string a
    // thin one does, and the arm needs no bare twin to fall back to.
    expect(AuditSentences::sentence('donation.received', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['status' => 'received'],
    )))->toBe('Maria Quản Lý Kho đã nhận một đề nghị tặng sách');

    expect(AuditSentences::sentence('donation.received', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã nhận một đề nghị tặng sách');
});

it('donation.declined carries the reason, and drops the clause when there is none', function () {
    // Task 16. The :because half is the difference from the block above,
    // and it is worth its own assertion: DeclineDonation requires and
    // trims a reason, so the filled form is what every row it writes
    // renders — and the empty form is what the shared helper does with a
    // payload that carries no `reason` key.
    expect(AuditSentences::sentence('donation.declined', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['status' => 'declined', 'reason' => 'Sách đã quá cũ'],
    )))->toBe('Maria Quản Lý Kho đã từ chối một đề nghị tặng sách vì Sách đã quá cũ');

    expect(AuditSentences::sentence('donation.declined', audFacts(actor: 'Maria Quản Lý Kho')))
        ->toBe('Maria Quản Lý Kho đã từ chối một đề nghị tặng sách');
});

it('every action in the map renders a real sentence, never the undescribed-action fallback', function () {
    // FIX ROUND, item 1. Until this block, NOTHING iterated ACTIONS
    // asserting each key renders something. AuditActionCensusTest looks
    // like it covers this and does not: both of its blocks compare
    // ->record('x.y') string literals against array_keys(ACTIONS) and
    // neither ever calls phrase() or sentence(). Measured — deleting
    // comment.created's match arm left that file at 2 passed while the
    // undescribed-action fallback rendered to a volunteer, and the only
    // thing that reddened was one Feature test that happened to assert
    // that one sentence. Per-action cases in this file cover the arms
    // somebody thought to write a case for; this covers all of them, and
    // every action a later task adds, for free.
    //
    // The facts bag is all-nulls on purpose: AuditLogQuery resolves actor
    // and subject through LEFT joins, so an arm has to render with
    // nothing in hand, and that is also the shape that reaches the
    // default arm if one is missing.
    $fallback = AuditSentences::sentence('bookshelf.created', audFacts(actor: 'Maria Q'));

    foreach (array_keys(AuditSentences::ACTIONS) as $action) {
        expect(AuditSentences::sentence($action, audFacts(actor: 'Maria Q')))
            ->not->toBe($fallback, $action.' renders the undescribed-action fallback — its phrase() arm is missing');
    }
});

it('actionsInGroup partitions the whole map with nothing left over', function () {
    $all = array_merge(...array_map(
        fn (string $g) => AuditSentences::actionsInGroup($g),
        ['loans', 'books', 'readers', 'community'],
    ));
    expect($all)->toEqualCanonicalizing(array_keys(AuditSentences::ACTIONS))
        ->and(AuditSentences::ACTIONS)->toHaveCount(41);
});

it('copy.qr_printed names the count, an int cast to string, never str()\'s trimmed-string shape', function () {
    // Task 8, on known-gaps.md's own ground: seventeen inherited sentences
    // have no per-action wording block, and the census above cannot see a
    // WRONG sentence — only a missing one. This is copy.qr_printed's block,
    // so this phase does not add an eighteenth hole. Phase 2b's nineteen
    // community keys each have one; this matches that shape.
    //
    // $after['count'] is stored as an INT (MarkCopiesPrinted's $after),
    // never a string, so this arm cannot go through the shared str()
    // helper (str() returns null for anything that is not already a
    // string) — this pins that the arm reads and casts the int directly
    // instead of silently rendering the undescribed-action fallback for
    // every real payload this command ever writes.
    expect(AuditSentences::sentence('copy.qr_printed', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['count' => 3],
    )))->toBe('Maria Quản Lý Kho đã in nhãn QR cho 3 bản sách');

    expect(AuditSentences::sentence('copy.qr_printed', audFacts(
        actor: 'Maria Quản Lý Kho',
        after: ['count' => 0],
    )))->toBe('Maria Quản Lý Kho đã in nhãn QR cho 0 bản sách');
});

it('payloadRows: em dash for an absent key, the string null for a stored null', function () {
    $rows = AuditSentences::payloadRows(['state' => 'lost'], ['state' => 'available', 'note' => null]);

    expect($rows)->toBe([
        ['field' => 'note', 'before' => '—', 'after' => 'null'],
        ['field' => 'state', 'before' => '"lost"', 'after' => '"available"'],
    ]);
});

it('payloadRows sorts keys and survives null bags', function () {
    expect(AuditSentences::payloadRows(null, null))->toBe([])
        ->and(array_column(AuditSentences::payloadRows(['b' => 1, 'a' => 2], null), 'field'))
        ->toBe(['a', 'b']);
});

it('the condition words match copy.ts character for character', function () {
    // FoldParityTest's cross-language pattern: the client map is read from
    // source text, so the two copies cannot drift silently.
    $ts = file_get_contents(__DIR__.'/../../../resources/js/lib/copy.ts');
    $lang = require __DIR__.'/../../../lang/vi/audit.php';

    foreach ($lang['conditions'] as $key => $word) {
        expect($ts)->toContain("{$key}: \"{$word}\"");
    }
    expect($lang['conditions'])->toHaveCount(6);
});
