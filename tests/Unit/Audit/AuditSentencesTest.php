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

it('groupOf answers the family for the 26 actions and null for a stranger', function () {
    expect(AuditSentences::groupOf('loan.renewed'))->toBe('loans')
        ->and(AuditSentences::groupOf('credentials.set'))->toBe('readers')
        ->and(AuditSentences::groupOf('copy.retired'))->toBe('books')
        ->and(AuditSentences::groupOf('bookshelf.created'))->toBeNull();
});

it('actionsInGroup partitions the whole map with nothing left over', function () {
    $all = array_merge(...array_map(
        fn (string $g) => AuditSentences::actionsInGroup($g),
        ['loans', 'books', 'readers'],
    ));
    expect($all)->toEqualCanonicalizing(array_keys(AuditSentences::ACTIONS))
        ->and(AuditSentences::ACTIONS)->toHaveCount(26);
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
