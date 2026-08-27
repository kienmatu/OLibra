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

it('cannot update across the boundary through a scoped model', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $touched = Book::query()->update(['is_published' => false]);

    expect($touched)->toBe(1);   // only shelf A's book

    TenantHarness::actAs($b);
    expect(Book::query()->sole()->is_published)->toBeTrue();
});

it('cannot delete across the boundary through a scoped model', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $deleted = Book::query()->delete();

    expect($deleted)->toBe(1);   // only shelf A's book

    TenantHarness::actAs($b);
    expect(Book::query()->count())->toBe(1);   // shelf B's colliding book survives
});

it('stamps creates with the bound shelf when bookshelf_id is left unset', function () {
    ['a' => $a] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $post = Announcement::query()->create([
        'title' => 'Thông báo', 'slug' => 'thong-bao-moi',
        'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung',
    ]);

    expect($post->bookshelf_id)->toBe($a->id);
});

// BelongsToBookshelf's creating hook validates an explicitly-named
// bookshelf_id against the bound context, not just fills a gap when it is
// left null: while shelf A is bound, naming shelf B's id throws instead of
// writing through. This closes the write-side hole the final review found —
// a manager of shelf A could otherwise satisfy every other tenancy layer
// and still write a row into shelf B by naming it explicitly.
it('refuses to create an explicitly-named foreign bookshelf_id while a shelf is bound', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);

    expect(fn () => Announcement::query()->create([
        'bookshelf_id' => $b->id,
        'title' => 'Thông báo', 'slug' => 'thong-bao-xuyen-tu',
        'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung',
    ]))->toThrow(
        RuntimeException::class,
        sprintf('App\Models\Announcement cannot be created for bookshelf_id %s while bound to shelf %s.', $b->id, $a->id),
    );
});

// The update-side twin: nothing previously stopped moving an existing row
// to another shelf either.
it('refuses to move an existing row to another shelf while a shelf is bound', function () {
    ['a' => $a, 'b' => $b] = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($a);
    $post = Announcement::query()->sole();

    expect(fn () => $post->update(['bookshelf_id' => $b->id]))->toThrow(
        RuntimeException::class,
        sprintf('App\Models\Announcement cannot be moved to bookshelf_id %s while bound to shelf %s.', $b->id, $a->id),
    );
});

// The write-side twin of the read-side guided error below: replacing driver
// errno 1048 ("column cannot be null") with a message naming the fix is
// carried-in fix 1's entire purpose, and it needs the same message-pinned
// coverage the read side already has.
it('refuses to stamp a create when no tenant is bound — guided, not a driver error', function () {
    TenantHarness::twoCollidingShelves();

    app(TenantContext::class)->clear();

    expect(fn () => Book::query()->create(['title' => 'Vô Chủ', 'slug' => 'vo-chu']))->toThrow(
        RuntimeException::class,
        'App\Models\Book is shelf-scoped but no tenant is bound to stamp bookshelf_id. Bind one '
        .'via the tenant middleware, or opt in explicitly with TenantContext::actSystemWide() '
        .'and name bookshelf_id yourself.',
    );
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
