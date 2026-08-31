<?php

use App\Models\Book;
use App\Models\Bookshelf;
use App\Support\TenantContext;

/**
 * One book on each of two shelves, with shelf A bound.
 *
 * Grep first: `grep -rn "^function wideFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, Bookshelf}
 */
function wideFix(): array
{
    app(TenantContext::class)->actSystemWide();
    $a = Bookshelf::factory()->create(['slug' => 'shelf-a-wide', 'settings' => []]);
    $b = Bookshelf::factory()->create(['slug' => 'shelf-b-wide', 'settings' => []]);
    Book::factory()->for($a)->create();
    Book::factory()->for($b)->create();

    app(TenantContext::class)->set($a, null);

    return [$a, $b];
}

it('reads every shelf inside the callback and only one outside it', function () {
    wideFix();
    $context = app(TenantContext::class);

    expect(Book::query()->count())->toBe(1);

    $inside = $context->systemWide(fn (): int => Book::query()->count());

    expect($inside)->toBe(2);
});

it('RESTORES the bound tenant after the callback returns', function () {
    // The block this task exists for. Without the finally, every later read
    // in the request spans the network — silently, because BookshelfScope
    // adds no predicate under a widening rather than throwing.
    [$a] = wideFix();
    $context = app(TenantContext::class);

    $context->systemWide(fn (): int => Book::query()->count());

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});

it('restores even when the callback throws', function () {
    // An untested finally is a comment. A query that throws mid-read must
    // not leave the rest of the request unscoped.
    [$a] = wideFix();
    $context = app(TenantContext::class);

    expect(fn () => $context->systemWide(function (): never {
        throw new RuntimeException('boom');
    }))->toThrow(RuntimeException::class, 'boom');

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});

it('restores correctly when nested', function () {
    [$a] = wideFix();
    $context = app(TenantContext::class);

    $context->systemWide(function () use ($context): void {
        $context->systemWide(fn (): int => Book::query()->count());
        // The INNER call must restore to system-wide, not to the outer
        // caller's bound shelf — it restores what it found, not a default.
        expect($context->isSystemWide())->toBeTrue();
    });

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
});

it('restores an unset tenant as unset, not as a bound one', function () {
    // The third state. BookshelfScope THROWS on unset, so restoring wrongly
    // here would turn a loud failure into a silent one.
    app(TenantContext::class)->clear();
    $context = app(TenantContext::class);

    $context->systemWide(fn (): int => Bookshelf::query()->count());

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBeNull();
    // Name a fragment: BookshelfScope throws a distinctive message, and a
    // bare class assertion would pass on any RuntimeException at all —
    // including one from a broken fixture.
    expect(fn () => Book::query()->count())
        ->toThrow(RuntimeException::class, 'actSystemWide');
});
