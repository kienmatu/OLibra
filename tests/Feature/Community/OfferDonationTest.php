<?php

use App\Actions\Community\OfferDonation;
use App\Enums\DonationStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;

/**
 * Shelf + one active reader, bound as the tenant.
 *
 * The MEMBERSHIP is returned beside the user on purpose: this file's
 * first block asserts the stored donor id against both, and a fixture
 * that never named the membership row could not make that comparison.
 * Membership::factory() mints its own uuid, so the two ids are unrelated
 * — which is the construction the trap needs to be visible.
 *
 * Grep first: `grep -rn "^function dofFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User, Membership}
 */
function dofFix(string $slug = 'dong-thap-dof'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($reader);

    return [$shelf, $reader, $membership];
}

it('an offer is stored against the caller\'s membership, not their user id', function () {
    [$shelf, $reader, $membership] = dofFix();

    $result = app(OfferDonation::class)->execute($reader, 'Một túi truyện tranh cũ', 12);

    $row = BookDonation::query()->sole();
    expect($result['donationId'])->toBe($row->id)
        ->and($row->description)->toBe('Một túi truyện tranh cũ')
        ->and($row->estimated_count)->toBe(12)
        // Left to the column default rather than written by the command.
        ->and($row->status)->toBe(DonationStatus::Pending)
        ->and($row->donor_membership_id)->toBe($membership->id);

    // A SEPARATE STATEMENT, and not redundant. book_donations
    // .donor_membership_id names a memberships(id) — the reverse of
    // comments.author_id two tables along, which this same phase writes.
    // Both are 36-char uuid strings, so the line above passes for a value
    // of the right SHAPE and this line is what says it came from the
    // right TABLE. dofFix mints the two ids independently so they can
    // never coincide.
    //
    // WHICH FAILURE ARRIVES FIRST, measured rather than predicted (the
    // plan asked for the answer to be written here). Writing $actor->id
    // into that column reaches NEITHER of the two assertions above: the
    // INSERT is refused by the server and the block dies on a
    // QueryException — "SQLSTATE[23000]: Integrity constraint violation:
    // 1452 Cannot add or update a child row: a foreign key constraint
    // fails (`olibra_testing`.`book_donations`, CONSTRAINT
    // `book_donations_donor_membership_fk` FOREIGN KEY (`bookshelf_id`,
    // `donor_membership_id`) REFERENCES `memberships` (`bookshelf_id`,
    // `id`))". That run is 6 failed, 4 passed across this file, every
    // failure the same 1452. So the composite key is loud, not silently
    // wrong; the assertions are what would answer if it were ever
    // dropped, and a 500 to a reader who offered their books is why the
    // id still comes from the bound membership.
    expect($row->donor_membership_id)->not->toBe($reader->id);

    expect($shelf->donations()->count())->toBe(1);
});

it('an empty description is refused, whitespace included, and no row is written', function () {
    // The column is `description text NOT NULL` (read off the live table),
    // which takes three spaces happily, so the trim is the whole of the
    // rule.
    [, $reader] = dofFix('dong-thap-dof-empty');

    // Caught and compared with ->toBe rather than
    // toThrow(RuleViolated::class, 'empty_description'): toThrow's message
    // check is assertStringContainsString, so a code renamed to
    // empty_description_MUT would pass that form.
    try {
        app(OfferDonation::class)->execute($reader, "  \n ");
        test()->fail('expected a blank description to refuse; the offer was stored');
    } catch (RuleViolated $e) {
        expect($e->code)->toBe('empty_description');
    }

    expect(BookDonation::query()->count())->toBe(0);
});

it('the estimated count is optional and stores null', function () {
    // A rough count is a rough count: a reader who does not know how many
    // books are in the bag leaves it blank, and "not recorded" has to
    // survive to the row rather than becoming a zero somebody later reads
    // as an empty bag.
    [, $reader] = dofFix('dong-thap-dof-nocount');

    app(OfferDonation::class)->execute($reader, 'Vài cuốn sách thiếu nhi');

    $row = BookDonation::query()->sole();
    expect($row->estimated_count)->toBeNull()
        ->and($row->description)->toBe('Vài cuốn sách thiếu nhi');
});

it('INV-8: donation.offered records the status and the count, never the description', function () {
    // The reference's own payload is status and estimated_count, and a
    // description is free text a child wrote on a row that survives — a
    // second copy is a second thing to redact if they ever ask for theirs
    // to be removed. NOT on BR §14's authority: an earlier draft cited it
    // and §14 does not say this (it names only passwords and session
    // tokens as never captured). See OfferDonation's docblock.
    [, $reader] = dofFix('dong-thap-dof-audit');

    app(OfferDonation::class)->execute($reader, 'Bộ Doraemon con đọc xong rồi', 8);

    $entry = AuditLog::query()->where('action', 'donation.offered')->sole();
    $after = (array) $entry->after;

    // KEY BY KEY, AND FIRST. The order is the finding, not a style
    // choice: with this line placed after the whole-bag chain below, the
    // "put the description into the audit payload" mutation reddened the
    // chain's `toBe` and this line never ran at all, because a failed
    // expect() aborts the whole Pest method. The named probe for the one
    // absence this block is titled about has to be the statement that
    // fires. Re-measured with it here: the mutation's failure is
    // "Failed asserting that true is false", on this line.
    expect(array_key_exists('description', $after))->toBeFalse();

    expect($entry->entity_type)->toBe('donation')
        ->and($entry->actor_id)->toBe($reader->id)
        ->and((array) $entry->before)->toBe([])
        // THE WHOLE BAG, not a subset: toMatchArray would pass on a bag
        // that also carried the description, inside a block titled
        // "never the description". It stays as the second net, for a key
        // nobody thought to name above.
        ->and($after)->toBe(['status' => 'pending', 'estimated_count' => 8]);

    // Through the query the audit screen calls, so the arm is REACHABLE
    // and not merely present: AuditSentences::phrase() ends in a default
    // arm, so a missing arm renders the undescribed-action fallback to a
    // volunteer instead of failing the build.
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'donation.offered');
    expect($line)->not->toBeNull()
        ->and($line['group'])->toBe('community')
        ->and($line['sentence'])->toBe('Têrêsa Bạn Đọc Nhỏ đã đề nghị tặng sách')
        ->and($line['sentence'])->not->toContain('Doraemon');
});

it('a reader offers over HTTP and the offer lands on their membership', function () {
    // THE POSITIVE SIBLING for the two refusal blocks below. Both of them
    // assert a status code a missing route also answers — 404 is what an
    // unrouted URL returns — so on their own they would stay green
    // against a deleted route. This block reddens in exactly that case,
    // and the three are never all green with the route gone.
    [$shelf, $reader, $membership] = dofFix('dong-thap-dof-http');
    $page = "/shelves/{$shelf->slug}/donate";

    test()->actingAs($reader)->from($page)
        ->post($page, ['description' => 'Một thùng sách giáo khoa cũ', 'estimated_count' => 20])
        ->assertRedirect($page)
        ->assertSessionHas('success', __('rules.donation_offered_flash'));

    $row = BookDonation::query()->sole();
    expect($row->donor_membership_id)->toBe($membership->id)
        ->and($row->estimated_count)->toBe(20);
});

it('a memberless super admin meets not_permitted as a Vietnamese sentence, over HTTP', function () {
    // A LIVE path, not defence in depth. AppServiceProvider's Gate::before
    // returns true for any act-as-* ability when is_super_admin, so
    // EnsureShelfRole lets a super admin through role:reader and
    // OfferDonationRequest::authorize allows the POST; ResolveTenant
    // resolves only ACTIVE memberships, so a super admin who is not a
    // member of this shelf arrives with a null membership. OfferDonation's
    // own null check is then what is left, and it fails closed.
    //
    // Over HTTP rather than as a unit call, because the READER's end of it
    // is half the point: bootstrap/app.php renders RuleViolated as
    // back()->withErrors(['rule' => ...]), so the sentence has to survive
    // a 302. One actingAs for the whole method (the SessionGuard rule).
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-dof-super', 'settings' => []]);
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Giuse Quản Trị Toàn Hệ Thống']);
    $page = "/shelves/{$shelf->slug}/donate";

    test()->actingAs($admin)->from($page)->post($page, ['description' => 'Thử quyền'])
        ->assertRedirect($page)
        ->assertSessionHasErrors(['rule' => __('rules.not_permitted')]);

    expect(BookDonation::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a signed-in non-member gets 404 on the donate POST, never 403', function () {
    // Spec §5.4 (the MIGRATION DESIGN spec): the URL space must not
    // confirm what exists. Its own it() with its own fixture — dofFix
    // ends in actingAs($reader) and docs/known-gaps.md's SessionGuard
    // entry concludes non-member coverage does not layer a second
    // identity over a first.
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-dof-stranger', 'settings' => []]);
    $stranger = User::factory()->create(['full_name' => 'Phêrô Người Lạ']);

    test()->actingAs($stranger)
        ->post("/shelves/{$shelf->slug}/donate", ['description' => 'Chào tủ sách'])
        ->assertNotFound();

    expect(BookDonation::query()->withoutGlobalScopes()->count())->toBe(0);
});

it('a blank description over HTTP is a field error, not the rule banner', function () {
    // OfferDonationRequest's `required` refuses a whitespace-only string
    // as well as an empty one, so the reader gets errors.description
    // beside the textarea rather than the errors.rule banner. The
    // Action's own trim still guards the direct execute() call the second
    // block makes, where no Form Request runs at all.
    [$shelf, $reader] = dofFix('dong-thap-dof-blank');
    $page = "/shelves/{$shelf->slug}/donate";

    test()->actingAs($reader)->from($page)->post($page, ['description' => '   '])
        ->assertSessionHasErrors(['description']);

    expect(BookDonation::query()->count())->toBe(0);
});

it('BookDonation::donor() resolves the memberships row named by donor_membership_id', function () {
    // The relation's TARGET is what is pinnable here, not the spelling of
    // its foreign key: point donor() at User and every donation row in the
    // queue renders a blank donor, and this block reddens. The last two
    // expectations are the id direction stated as data — the id in that
    // column IS a memberships row and is NOT a users row — which nothing
    // in the column's type says.
    [, $reader, $membership] = dofFix('dong-thap-dof-donor');
    app(OfferDonation::class)->execute($reader, 'Sách con không đọc nữa');

    $row = BookDonation::query()->sole();
    expect($row->donor)->toBeInstanceOf(Membership::class)
        ->and($row->donor->id)->toBe($membership->id)
        ->and($row->donor->user->full_name)->toBe('Têrêsa Bạn Đọc Nhỏ')
        ->and(Membership::query()->whereKey($row->donor_membership_id)->exists())->toBeTrue()
        ->and(User::query()->whereKey($row->donor_membership_id)->exists())->toBeFalse();
});

it('Bookshelf::donations() is shelf-local', function () {
    // The block borrowRequests(), notifications(), loans() and comments()
    // each carry. Run under actSystemWide() precisely so BookshelfScope is
    // switched OFF and this relation's own FK filter is left to do the
    // separating.
    [$shelfA, $reader] = dofFix('dong-thap-dof-rel-a');
    app(OfferDonation::class)->execute($reader, 'Của tủ sách A');

    $row = BookDonation::query()->sole();
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-dof-rel-b', 'settings' => []]);

    expect($shelfA->donations()->pluck('id')->all())->toBe([$row->id])
        ->and($shelfB->donations()->count())->toBe(0);
});
