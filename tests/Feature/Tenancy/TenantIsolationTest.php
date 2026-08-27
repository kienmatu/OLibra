<?php

use App\Models\Announcement;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\BookshelfContact;
use App\Models\BorrowRequest;
use App\Models\Comment;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Support\TenantContext;
use Tests\Support\TenantHarness;

it('shows each shelf only its own colliding rows', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    expect(Book::query()->count())->toBe(1)
        ->and(Book::query()->sole()->bookshelf_id)->toBe($a->id)
        ->and(BookCopy::query()->count())->toBe(1)
        ->and(BookCopy::query()->sole()->bookshelf_id)->toBe($a->id)
        ->and(Membership::query()->count())->toBe(1)
        ->and(Membership::query()->sole()->bookshelf_id)->toBe($a->id);

    TenantHarness::actAs($b);
    expect(Book::query()->sole()->bookshelf_id)->toBe($b->id);
});

// The full census: every one of Task 14's thirteen trait-carrying models,
// proven filtered on both sides of the boundary, not a representative
// sample. Each row created by TenantHarness collides on its business key
// (same slug, code, name...) across shelf A and shelf B, so a count of 1
// here is only true because the scope is doing its job — with the scope
// removed each of these would see 2.
it('shows every trait-carrying model only its own colliding rows', function (string $model) {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    expect($model::query()->count())->toBe(1)
        ->and($model::query()->sole()->bookshelf_id)->toBe($a->id);

    TenantHarness::actAs($b);
    expect($model::query()->count())->toBe(1)
        ->and($model::query()->sole()->bookshelf_id)->toBe($b->id);
})->with([
    Announcement::class,
    Book::class,
    BookCopy::class,
    BookDonation::class,
    BookshelfContact::class,
    BorrowRequest::class,
    Comment::class,
    ConditionAssessment::class,
    Loan::class,
    Membership::class,
    Notification::class,
    ParishUnit::class,
    ProfileChangeRequest::class,
]);

it('finds a colliding slug only inside the bound shelf', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $book = Book::query()->where('slug', 'de-men-phieu-luu-ky')->sole();

    expect($book->bookshelf_id)->toBe($a->id)->not->toBe($b->id);
});

it('cannot update or delete across the boundary through a scoped model', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $touched = Book::query()->update(['is_published' => false]);

    expect($touched)->toBe(1);   // only shelf A's book

    TenantHarness::actAs($b);
    expect(Book::query()->sole()->is_published)->toBeTrue();
});

it('stamps creates with the bound shelf and never a foreign one', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $post = Announcement::query()->create([
        'title' => 'Thông báo', 'slug' => 'thong-bao-moi',
        'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung',
    ]);

    expect($post->bookshelf_id)->toBe($a->id);
});

it('clears back to the fail-closed state, and system-wide is a named opt-in', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    app(TenantContext::class)->clear();

    // clear() does NOT mean "see everything" — it means "no tenant", and a
    // scoped query under no tenant is an error, exactly as an unset RLS
    // session returned nothing rather than everything.
    expect(fn () => Book::query()->count())->toThrow(
        RuntimeException::class,
        'App\Models\Book is shelf-scoped but no tenant is bound. Bind one via the tenant '
        .'middleware, or opt in explicitly with TenantContext::actSystemWide() and name '
        .'bookshelf_id yourself.',
    );

    app(TenantContext::class)->actSystemWide();
    expect(Book::query()->count())->toBe(2);
});
