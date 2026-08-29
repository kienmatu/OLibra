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

it('groupOf answers the family for the 21 actions and null for a stranger', function () {
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
        ->and(AuditSentences::ACTIONS)->toHaveCount(21);
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
