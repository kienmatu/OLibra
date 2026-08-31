<?php

use App\Actions\Catalogue\MarkCopiesPrinted;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function mcpFix" tests/`.
 *
 * @return array{Bookshelf, User, Book}
 */
function mcpFix(string $slug = 'dong-thap-mcp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return [$shelf, $manager, Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký'])];
}

it('increments the print count rather than setting it', function () {
    // The block the column exists for. An implementation writing
    // `qr_print_count => 1` passes every other block in this file.
    [, $manager, $book] = mcpFix();
    $shelf = $book->bookshelf;
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001', 'qr_print_count' => 2]);

    app(MarkCopiesPrinted::class)->execute($manager, [$copy->id]);

    expect($copy->fresh()->qr_print_count)->toBe(3);
});

it('stamps qr_printed_at with the clock', function () {
    [, $manager, $book] = mcpFix();
    $copy = BookCopy::factory()->for($book->bookshelf)->for($book)->create(['code' => 'DT-0001']);

    expect($copy->qr_printed_at)->toBeNull();

    app(MarkCopiesPrinted::class)->execute($manager, [$copy->id]);

    expect($copy->fresh()->qr_printed_at)->not->toBeNull();
});

it('an empty selection is refused by name', function () {
    [, $manager] = mcpFix();

    expect(fn () => app(MarkCopiesPrinted::class)->execute($manager, []))
        ->toThrow(RuleViolated::class, 'copy_selection_empty');
});

it('writes ONE audit entry for the batch, naming the count', function () {
    [, $manager, $book] = mcpFix();
    $shelf = $book->bookshelf;
    $ids = collect(['DT-0001', 'DT-0002', 'DT-0003'])
        ->map(fn (string $code) => BookCopy::factory()->for($shelf)->for($book)->create(['code' => $code])->id)
        ->all();

    app(MarkCopiesPrinted::class)->execute($manager, $ids);

    $entries = AuditLog::query()->where('action', 'copy.qr_printed')->get();

    expect($entries)->toHaveCount(1)
        ->and($entries->first()->after['count'])->toBe(3);
});

it('another shelf\'s copy is not printed and not counted', function () {
    // TITLED ASSERTIONS FIRST: the tenancy facts, then the count. expect()->and()
    // short-circuits, so leading with $result['count'] would hide a foreign
    // copy that WAS stamped behind a count that happened to read 1.
    [, $manager, $book] = mcpFix();
    $mine = BookCopy::factory()->for($book->bookshelf)->for($book)->create(['code' => 'DT-0001']);

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    $result = app(MarkCopiesPrinted::class)->execute($manager, [$mine->id, $otherCopy->id]);

    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
    expect($mine->fresh()->qr_print_count)->toBe(1);
    expect($result['count'])->toBe(1);
});

it('a selection that scopes down to nothing SUCCEEDS with a count of zero', function () {
    // DESIGN DOC D7, and the first version of this plan asserted the exact
    // opposite. OPS §4.1's MarkCopiesPrinted entry, opened and quoted:
    //
    //   "A zero-row update is not a failure here, and this is the one command
    //    in this document for which that is true. It is set-valued bookkeeping
    //    about a document that already exists — the route builds the PDF bytes
    //    BEFORE calling this — so an empty result is a fact to record, not a
    //    target that was missed. The reported count is what actually moved,
    //    not what was asked for."
    //
    // So copy_selection_empty refuses an EMPTY INPUT and nothing else. A
    // non-empty input that scopes to zero rows records zero and succeeds.
    [, $manager, $book] = mcpFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-mcp2', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    app(TenantContext::class)->set($book->bookshelf, Membership::query()
        ->where('bookshelf_id', $book->bookshelf->id)->firstOrFail());

    $result = app(MarkCopiesPrinted::class)->execute($manager, [$otherCopy->id]);

    expect($result['count'])->toBe(0);
    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
});
