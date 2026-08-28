<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Queries\ReaderDetailQuery;
use App\Queries\ReadersListQuery;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\Support\TenantHarness;

afterEach(fn () => Carbon::setTestNow());

/** @return array{Bookshelf, ParishUnit, ParishUnit} shelf, l1, l2-under-l1 */
function rosterFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $l1 = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $l2 = ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $l1->id, 'name' => 'Tổ 3']);
    TenantHarness::actAs($shelf);

    return [$shelf, $l1, $l2];
}

function rosterMember(Bookshelf $shelf, string $name, array $memberOver = [], array $userOver = []): Membership
{
    $person = User::factory()->create(array_merge(['full_name' => $name], $userOver));

    return Membership::factory()->for($shelf)->create(array_merge(['user_id' => $person->id, 'status' => 'active'], $memberOver));
}

it('a reader\'s parish line uses the shelf\'s own labels and units, never a hard-coded word', function () {
    [$shelf, $l1, $l2] = rosterFixture();
    rosterMember($shelf, 'Nguyễn Thị Lan', ['parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id]);

    $page = app(ReadersListQuery::class)->run([]);

    expect($page['rows'][0]['parishLine'])->toBe('Tổ 3 · Giáo họ Thánh Tâm')
        ->and($page['taxonomy']['level1Label'])->toBe('Giáo họ');
});

it('the roster rows carry no DOB, no parents, no phone — the list renders none of them', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Nguyễn Thị Lan');

    $row = app(ReadersListQuery::class)->run([])['rows'][0];

    // ONE key per assertion, deliberately: `->not->toHaveKeys([a, b, c])`
    // negates "has ALL of them", so it passes when only ONE is missing —
    // a leaked `phone` beside an absent `dateOfBirth` would go green.
    //
    // Also deliberately NOT `->not->toHaveKey($forbidden, $message)`: Pest's
    // signature is toHaveKey(string|int $key, mixed $value = new Any,
    // string $message = ''), so a string passed second is $value, not
    // $message. toHaveKey then asserts BOTH "has key" AND "value equals
    // that string" — for an absent key it throws on the has-key check, and
    // for a present key (whose value is virtually never that literal
    // sentence) it throws on the value check. Either way `not`'s __call
    // catches the inner exception and treats it as the negation succeeding,
    // so `not->toHaveKey($key, "message")` passes unconditionally — the
    // exact "guards nothing" trap this task was warned about, reproduced in
    // singular form. Verified live: leaking `'phone' => null` into the row
    // left this assertion green. array_key_exists is unambiguous.
    foreach (['dateOfBirth', 'fatherName', 'motherName', 'phone', 'phoneMissingReason',
        'email', 'managerNotes', 'username', 'passwordHash'] as $forbidden) {
        expect(array_key_exists($forbidden, $row))->toBeFalse("roster row leaked {$forbidden}");
    }

    // And the whole page, not just row 0 — a serialised sweep catches a
    // field smuggled in under a name this list does not know.
    $serialized = json_encode(app(ReadersListQuery::class)->run([]));
    expect($serialized)->not->toContain('Trẻ em chưa có điện thoại')  // the factory's phoneMissingReason
        ->and($serialized)->not->toContain('Chưa có');                // the factory's father/mother names
});

it('with role reader, the roster excludes managers and admins; unfiltered, it lists them', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Bạn Đọc Thường');
    rosterMember($shelf, 'Chị Quản Lý', ['role' => 'manager']);

    $readerOnly = app(ReadersListQuery::class)->run(['role' => 'reader']);
    $all = app(ReadersListQuery::class)->run([]);

    expect(collect($readerOnly['rows'])->pluck('fullName')->all())->toBe(['Bạn Đọc Thường'])
        ->and($all['total'])->toBe(2);
});

it('the status filter narrows, and rejected members are reachable (BR §2 keeps the row)', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Đang Hoạt Động');
    rosterMember($shelf, 'Bị Từ Chối', ['status' => 'rejected', 'rejection_reason' => 'lý do']);

    $rejected = app(ReadersListQuery::class)->run(['status' => 'rejected']);

    expect(collect($rejected['rows'])->pluck('fullName')->all())->toBe(['Bị Từ Chối']);
});

it('the parish-unit filter narrows at either level', function () {
    [$shelf, $l1, $l2] = rosterFixture();
    rosterMember($shelf, 'Trong Giáo Họ', ['parish_unit_l1_id' => $l1->id]);
    rosterMember($shelf, 'Trong Tổ', ['parish_unit_l1_id' => $l1->id, 'parish_unit_l2_id' => $l2->id]);
    rosterMember($shelf, 'Chưa Xếp');

    expect(app(ReadersListQuery::class)->run(['parishUnitId' => $l1->id])['total'])->toBe(2)
        ->and(app(ReadersListQuery::class)->run(['parishUnitId' => $l2->id])['total'])->toBe(1);
});

it('the name filter is diacritic-insensitive and a garbage query matches nothing', function () {
    [$shelf] = rosterFixture();
    rosterMember($shelf, 'Trần Minh');
    rosterMember($shelf, 'Lê Ngọc Ánh');

    expect(collect(app(ReadersListQuery::class)->run(['q' => 'tran minh'])['rows'])->pluck('fullName')->all())
        ->toBe(['Trần Minh'])
        // M7's guard: pure punctuation folds to '' and must match nothing,
        // not everything.
        ->and(app(ReadersListQuery::class)->run(['q' => '%%%'])['total'])->toBe(0);
});

it('the roster sorts by folded name, not byte order — seeded in the wrong order on purpose', function () {
    [$shelf] = rosterFixture();
    // Creation order is Vũ, Đặng, An — folded order is An, Đặng(dang), Vũ.
    // Under UUIDv7 an unordered scan returns creation order, so this
    // assertion is falsifiable exactly because the two orders differ
    // (the known-gaps trap this plan's Global Constraints restate).
    rosterMember($shelf, 'Vũ Văn Xuân');
    rosterMember($shelf, 'Đặng Văn Bút');
    rosterMember($shelf, 'An Nguyễn');

    $names = collect(app(ReadersListQuery::class)->run([])['rows'])->pluck('fullName')->all();

    expect($names)->toBe(['An Nguyễn', 'Đặng Văn Bút', 'Vũ Văn Xuân']);
});

it('paging never loses a reader, however alike the names, and pins the id tiebreak mechanism', function () {
    [$shelf] = rosterFixture();
    foreach (range(1, 30) as $i) {
        rosterMember($shelf, 'Nguyễn Văn An');   // 30 identical fold keys
    }

    $seen = [];
    foreach ([1, 2] as $pageNo) {
        $page = app(ReadersListQuery::class)->run(['page' => $pageNo]);
        foreach ($page['rows'] as $row) {
            $seen[] = $row['membershipId'];
        }
    }

    // 24 + 6, no duplicates, none lost.
    expect($seen)->toHaveCount(30)
        ->and(array_unique($seen))->toHaveCount(30);

    // The v7-id tiebreak ALWAYS equals creation order, so no data
    // assertion can falsify its absence (Global Constraints) — pin the
    // mechanism instead: the generated SQL must order by the folded name
    // and THEN the membership id.
    //
    // Capture ONE query, not a concatenation of every query the run emits:
    // a `$sql .= …` accumulator lets `.*full_name_folded.*…id` match across
    // a query boundary (the holding-count query's `borrower_id` satisfies
    // the tail), so the regex would pass with the tiebreak deleted. Isolate
    // the roster SELECT, then match its ORDER BY tail exactly.
    $captured = [];
    DB::listen(function ($query) use (&$captured) {
        $captured[] = $query->sql;
    });
    app(ReadersListQuery::class)->run([]);

    $roster = collect($captured)->first(
        fn (string $sql) => str_contains($sql, 'from `memberships`') && str_contains($sql, 'order by'),
    );

    expect($roster)->not->toBeNull('no roster SELECT was captured')
        // Both keys, in this order, and nothing else after them but paging.
        ->and($roster)->toMatch('/order by\s+`users`\.`full_name_folded`\s+asc,\s*`memberships`\.`id`\s+asc\s+limit/i');
});

it('holdingCount is derived on read, and moves with no member command in between', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);

    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(0);

    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(1);

    // loans_returned_has_condition (database/migrations/2026_08_26_000007_create_loans_table.php:67-68):
    // a returned loan must carry a return_condition — the brief's plain
    // `->update(['status' => 'returned'])` violates that check constraint
    // on this schema, so the fixture supplies one.
    $loan->update(['status' => 'returned', 'return_condition' => 'perfect']);
    expect(app(ReadersListQuery::class)->run([])['rows'][0]['holdingCount'])->toBe(0);
});

it('the detail carries the manager-only fields BR §5.3 names, and never a password hash', function () {
    [$shelf, $l1] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan',
        ['parish_unit_l1_id' => $l1->id, 'manager_notes' => 'Nhà gần nhà xứ'],
        ['date_of_birth' => '2015-04-02', 'phone' => '0912345678', 'phone_missing_reason' => null],
    );
    $person = User::query()->findOrFail($member->user_id);
    $person->username = 'lan.nguyen';
    $person->password_hash = Hash::make('mat-khau-123');
    $person->save();

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['dateOfBirth'])->toBe('2015-04-02')
        ->and($detail['fatherName'])->not->toBe('')
        ->and($detail['phone'])->toBe('0912345678')
        ->and($detail['managerNotes'])->toBe('Nhà gần nhà xứ')
        ->and($detail['parishUnitL1Id'])->toBe($l1->id)
        ->and($detail['hasCredentials'])->toBeTrue()
        ->and($detail['username'])->toBe('lan.nguyen')
        ->and(json_encode($detail))->not->toContain($person->fresh()->password_hash);
});

it('a current loan names the book and the copy, with days remaining from the clock', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-28 03:00:00', 'UTC'));
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-31', 'status' => 'active',
    ]);
    // loans_returned_has_condition: same constraint as above — a returned
    // loan needs a return_condition.
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-20', 'status' => 'returned', 'return_condition' => 'perfect',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'])->toHaveCount(1)
        ->and($detail['currentLoans'][0]['title'])->toBe('Dế Mèn Phiêu Lưu Ký')
        ->and($detail['currentLoans'][0]['copyCode'])->toBe('DT-0001')
        ->and($detail['currentLoans'][0]['dueOn'])->toBe('2026-08-31')
        ->and($detail['currentLoans'][0]['isOverdue'])->toBeFalse()
        // 28th in Asia/Ho_Chi_Minh (10:00 local) to the 31st: 3 days.
        ->and($detail['currentLoans'][0]['daysRemaining'])->toBe(3)
        ->and($detail['holdingCount'])->toBe(1);
});

it('an overdue loan is overdue by the parish\'s calendar, not the server\'s', function () {
    // 18:30 UTC on the 30th is already 01:30 on the 31st in Hồ Chí Minh:
    // a loan due on the 30th is overdue THERE and not in UTC.
    Carbon::setTestNow(Carbon::parse('2026-08-30 18:30:00', 'UTC'));
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-08-30', 'status' => 'active',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'][0]['isOverdue'])->toBeTrue()
        ->and($detail['currentLoans'][0]['daysRemaining'])->toBe(-1);
});

it('a soft-deleted book or copy still leaves the loan on the reader\'s list', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    $book->delete();
    $copy->delete();

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'])->toHaveCount(1)
        ->and($detail['currentLoans'][0]['title'])->toBe('Dế Mèn');
});

/**
 * Task 14 fixture-sweep finding: every prior test of ReaderDetailQuery's
 * currentLoans seeded exactly one reader with one active loan on the
 * shelf, so a count/content assertion could not distinguish "scoped to
 * THIS reader's borrower_id" from "scoped to the whole shelf" — the same
 * fixture-shape gap the reader-dashboard carry-over closed for
 * MyDashboardQuery/MyLoanHistoryQuery. Two readers, two active loans, same
 * shelf: the detail of one must show only their own.
 */
it('currentLoans excludes another reader\'s active loan on the same shelf', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $other = rosterMember($shelf, 'Trần Văn Khác');
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn', 'slug' => 'de-men-rdq']);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001']);
    $mine = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $member->user_id, 'lent_by' => $member->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    $copy2 = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0002']);
    Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy2->id, 'book_id' => $book->id,
        'borrower_id' => $other->user_id, 'lent_by' => $other->user_id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['currentLoans'])->toHaveCount(1)
        ->and($detail['currentLoans'][0]['loanId'])->toBe($mine->id)
        ->and($detail['holdingCount'])->toBe(1);
});

it('a pending profile change shows as a display-only stub', function () {
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $request = ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $member->user_id,
        'proposed_values' => ['phone' => '0999999999'], 'previous_values' => [],
        'status' => 'pending',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['pendingProfileChange'])->not->toBeNull()
        ->and($detail['pendingProfileChange']['id'])->toBe($request->id);
});

it('pendingProfileChange never picks up another reader\'s pending change on the same shelf', function () {
    // Same fixture-shape gap as currentLoans above: a lone pending request
    // per shelf cannot distinguish `where('user_id', $person->id)` from an
    // unscoped `first()` that happens to hit the only row on the shelf.
    [$shelf] = rosterFixture();
    $member = rosterMember($shelf, 'Nguyễn Thị Lan');
    $other = rosterMember($shelf, 'Trần Văn Khác');
    ProfileChangeRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'user_id' => $other->user_id,
        'proposed_values' => ['phone' => '0911111111'], 'previous_values' => [],
        'status' => 'pending',
    ]);

    $detail = app(ReaderDetailQuery::class)->run($member);

    expect($detail['pendingProfileChange'])->toBeNull();
});

it('the detail query refuses a membership from a shelf other than the one bound — the Task 14 review flag', function () {
    // ReaderDetailQuery::run(Membership) never re-checked $membership's
    // OWN bookshelf_id against TenantContext::bookshelfId() — flagged in
    // Task 12's review and recorded in ReaderDetailQuery's own docblock.
    // Today the one caller (a {shelf}/manage/readers/{reader} route)
    // cannot produce a mismatch, because scopeBindings() resolves
    // {reader} through the SAME {shelf} ResolveTenant already bound — but
    // that agreement is a property of that ONE route, not of this class.
    // This test bypasses the route entirely (withoutGlobalScopes(), the
    // same escape hatch TenantHarness::readerFor() and every direct
    // cross-shelf read in this suite already uses) to hand the query a
    // membership from a DIFFERENT shelf than the one bound, proving the
    // guard added in this task — not the route layer — is what refuses it.
    $shelves = TenantHarness::twoCollidingShelves();
    $foreignMembership = Membership::query()->withoutGlobalScopes()
        ->where('bookshelf_id', $shelves['b']->id)->firstOrFail();

    TenantHarness::actAs($shelves['a']);

    expect(fn () => app(ReaderDetailQuery::class)->run($foreignMembership))
        ->toThrow(ModelNotFoundException::class);
});

it('INV-10: another shelf\'s readers never appear in the roster', function () {
    $shelves = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($shelves['a']);
    $page = app(ReadersListQuery::class)->run([]);

    // The harness seeds one identical-named member per shelf; the bound
    // shelf sees exactly one row, not two.
    expect($page['total'])->toBe(1);
});
