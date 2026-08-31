<?php

use App\Enums\BookshelfStatus;
use App\Enums\CommentStatus;
use App\Enums\DonationStatus;
use App\Enums\LoanStatus;
use App\Enums\MembershipStatus;
use App\Enums\RequestStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\BorrowRequest;
use App\Models\Comment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\Admin\AdminOverviewQuery;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;

/**
 * Two shelves, so every count can be checked for leakage in both directions —
 * and THE TENANT IS LEFT BOUND TO SHELF A.
 *
 * THAT BINDING IS THE POINT OF THIS FILE, and an earlier draft of this plan
 * omitted it. Without it, every block below runs from an already-widened
 * context, and `Bookshelf` is not shelf-scoped anyway (`app/Models/Bookshelf.php`
 * uses HasFactory, HasUuids, SoftDeletes — no BelongsToBookshelf), so an
 * AdminOverviewQuery that FORGOT TO WIDEN AT ALL would pass every assertion.
 * The test that proves the phase would have proved nothing.
 *
 * Widen only to build fixtures; bind before returning.
 *
 * Grep first: `grep -rn "^function adminFix" tests/`.
 *
 * @return array{Bookshelf, Bookshelf}
 */
function adminFix(): array
{
    $context = app(TenantContext::class);
    $context->actSystemWide();

    $a = Bookshelf::factory()->create(['slug' => 'shelf-a-admin', 'name' => 'Aó Dài', 'settings' => []]);
    $b = Bookshelf::factory()->create(['slug' => 'shelf-b-admin', 'name' => 'Zzz', 'settings' => []]);

    // Bound, not widened. Every block below therefore reads as an ordinary
    // request would, and only the query's own widening can see shelf B.
    $context->set($a, null);

    return [$a, $b];
}

afterEach(fn () => CarbonImmutable::setTestNow());

it('lists every shelf, ordered by name', function () {
    [$a, $b] = adminFix();

    $rows = app(AdminOverviewQuery::class)->run();

    expect(collect($rows)->pluck('slug')->all())->toBe([$a->slug, $b->slug]);
});

it('SEES THE SHELF IT IS NOT BOUND TO — the block that fails if the widening is forgotten', function () {
    // The phase's central proof, and BE PRECISE ABOUT WHICH HALF PROVES IT.
    // Bookshelf is NOT tenant-scoped (adminFix's docblock says so), so shelf
    // B's ROW is listed either way — toHaveKey below can never fail and is a
    // readability guard, not evidence. What only the widening can produce is
    // shelf B's COUNT: bound to shelf A, a scoped Book aggregate returns
    // nothing for B, and the assertion reads 0 instead of 1.
    //
    // An earlier draft of this comment claimed the row and the count were
    // both proof. Half of that was false, and it contradicted adminFix's own
    // docblock thirty lines above.
    [$a, $b] = adminFix();

    $context = app(TenantContext::class);
    $context->systemWide(function () use ($a, $b): void {
        Book::factory()->for($a)->count(3)->create();
        Book::factory()->for($b)->count(1)->create();
    });

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows)->toHaveKey($b->slug);
    expect($rows[$b->slug]['books'])->toBe(1);
    expect($rows[$a->slug]['books'])->toBe(3);
});

it('counts active memberships as readers, managers included', function () {
    // ManagerDashboardQuery:50 defines it: "readers counts every ACTIVE
    // membership, managers included". The pending membership below is what
    // catches a predicate that counts every row regardless of status.
    [$a] = adminFix();

    app(TenantContext::class)->systemWide(function () use ($a): void {
        foreach ([MembershipStatus::Active, MembershipStatus::Active, MembershipStatus::Pending] as $status) {
            Membership::factory()->for($a)->create([
                'user_id' => User::factory()->create()->id, 'role' => 'reader', 'status' => $status,
            ]);
        }
    });

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['readers'])->toBe(2);
});

it('reads every figure live — no materialised counter can creep in', function () {
    // Spec D5, and OPS §3.4's "all live". Two reads, one row changed
    // between them. Cheap, and it is what a cached count would fail.
    [$a] = adminFix();

    $before = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');
    expect($before[$a->slug]['books'])->toBe(0);

    app(TenantContext::class)->systemWide(fn () => Book::factory()->for($a)->create());

    $after = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');
    expect($after[$a->slug]['books'])->toBe(1);
});

it('counts overdue as active loans past their due date, per shelf', function () {
    [$a] = adminFix();
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-02 02:00:00', 'UTC'));

    $book = Book::factory()->for($a)->create();
    $user = User::factory()->create();

    foreach ([['2026-08-01', 'DT-0001'], ['2026-12-01', 'DT-0002']] as [$due, $code]) {
        $copy = BookCopy::factory()->for($a)->for($book)->create(['code' => $code]);
        Loan::query()->create([
            'bookshelf_id' => $a->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
            'borrower_id' => $user->id, 'lent_by' => $user->id,
            'due_on' => $due, 'status' => LoanStatus::Active,
        ]);
    }

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['overdue'])->toBe(1);
    expect($rows[$a->slug]['loans'])->toBe(2);
});

it('sums pending from all four sources — D3, including APPROVED requests', function () {
    // The `approved` half is the one a reader would not guess: an approved
    // hold nobody has collected is still waiting on a person. Four distinct
    // sources, one each, so a dropped source shows as 3 rather than passing.
    [$a] = adminFix();

    $book = Book::factory()->for($a)->create();
    $user = User::factory()->create();
    $member = Membership::factory()->for($a)->create([
        'user_id' => $user->id, 'role' => 'reader', 'status' => MembershipStatus::Active,
    ]);

    $pendingUser = User::factory()->create();
    Membership::factory()->for($a)->create([
        'user_id' => $pendingUser->id, 'role' => 'reader', 'status' => MembershipStatus::Pending,
    ]);
    BorrowRequest::query()->create([
        'bookshelf_id' => $a->id, 'book_id' => $book->id,
        'member_id' => $user->id, 'status' => RequestStatus::Approved,
    ]);
    Comment::query()->create([
        // author_id is a users(id), NOT a memberships(id) — the FK is
        // comments_author_id_foreign → users(id), and App\Models\Comment's
        // own docblock says so. book_donations.donor_membership_id below is
        // the reverse. An earlier draft of this plan passed $member->id here
        // and would have died on the foreign key.
        'bookshelf_id' => $a->id, 'book_id' => $book->id, 'author_id' => $user->id,
        'body' => 'Hay lắm', 'status' => CommentStatus::Pending,
    ]);
    BookDonation::query()->create([
        'bookshelf_id' => $a->id, 'donor_membership_id' => $member->id,
        'description' => 'Một túi sách', 'status' => DonationStatus::Pending,
    ]);

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['pending'])->toBe(4);
});

it('flags a shelf with no contacts, and does not flag one with a contact', function () {
    [$a, $b] = adminFix();
    // Widened to SEED, because the tenant is bound to shelf A and this row
    // belongs to B. BookshelfContact carries BelongsToBookshelf, so a bound
    // write would be refused.
    app(TenantContext::class)->systemWide(fn () => BookshelfContact::query()->create([
        'bookshelf_id' => $b->id, 'position' => 1, 'name' => 'Maria Nguyễn Lan',
    ]));

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows[$a->slug]['contactsMissing'])->toBeTrue();
    expect($rows[$b->slug]['contactsMissing'])->toBeFalse();
});

it('LISTS an archived shelf and marks it — D9', function () {
    // The one place the dashboard and the portal deliberately disagree. An
    // administrator is the only person who can reach an archived shelf at
    // all, so a listing that dropped it would make the shelf unreachable
    // from every surface at once.
    [$a] = adminFix();
    $a->update(['status' => BookshelfStatus::Archived]);

    $rows = collect(app(AdminOverviewQuery::class)->run())->keyBy('slug');

    expect($rows)->toHaveKey($a->slug);
    expect($rows[$a->slug]['status'])->toBe(BookshelfStatus::Archived->value);
});

it('leaves the caller\'s tenant exactly as it found it', function () {
    // Task 2's guarantee, asserted from the consumer's side: after the one
    // query in this namespace runs, an ordinary scoped read still filters.
    [$a] = adminFix();
    Book::factory()->for($a)->create();
    $context = app(TenantContext::class);
    $context->set($a, null);

    app(AdminOverviewQuery::class)->run();

    expect($context->isSystemWide())->toBeFalse();
    expect($context->bookshelfId())->toBe($a->id);
    expect(Book::query()->count())->toBe(1);
});
