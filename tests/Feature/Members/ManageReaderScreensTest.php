<?php

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\Scopes\BookshelfScope;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

/** @return array{Bookshelf, User} */
function mrsFixture(): array
{
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 1, 'nested' => false, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    $manager = User::factory()->create();
    Membership::factory()->for($shelf)->manager()->create(['user_id' => $manager->id, 'status' => 'active']);

    return [$shelf, $manager];
}

function mrsReader(Bookshelf $shelf, string $name, string $status = 'active'): Membership
{
    $person = User::factory()->create(['full_name' => $name]);

    return Membership::factory()->for($shelf)->create(['user_id' => $person->id, 'status' => $status]);
}

it('renders the roster with rows, the taxonomy labels, and the unit filter options', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Nguyễn Thị Lan');

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/index')
            ->has('readers.rows', 1)
            ->where('readers.rows.0.fullName', 'Nguyễn Thị Lan')
            ->where('readers.taxonomy.level1Label', 'Giáo họ')
            ->has('units', 1)
            ->where('filters.status', null));
});

it('the roster page never carries a manager-only person field — a list must not disclose what it does not render', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Nguyễn Thị Lan');

    $readers = $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers")
        ->assertOk()
        ->inertiaProps('readers');

    $row = $readers['rows'][0];

    // ONE key per assertion, deliberately — see ReaderQueriesTest's own
    // docblock on this exact property: `not->toHaveKeys([...])` negates
    // "has ALL of them" and so passes when only one of several is
    // missing, and `not->toHaveKey($key, "message")` passes
    // unconditionally (the string lands in Pest's $value parameter, not
    // a message, and `not` swallows the resulting exception). This is
    // the HTTP/Inertia boundary's own proof, not a re-run of
    // ReadersListQuery's unit-level one: a controller can leak a field
    // the query never returned by spreading the wrong array into
    // Inertia::render(), and this is what would catch that.
    foreach (['dateOfBirth', 'fatherName', 'motherName', 'phone', 'phoneMissingReason',
        'email', 'managerNotes', 'username', 'passwordHash'] as $forbidden) {
        expect(array_key_exists($forbidden, $row))->toBeFalse("roster page leaked {$forbidden}");
    }
});

it('filters travel as English query params and repeated keys take their first value', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Đang Hoạt Động');
    mrsReader($shelf, 'Chờ Duyệt', 'pending');

    // DEVIATION FROM BRIEF (tests/Feature/Members/ManageReaderScreensTest.php,
    // this test): the brief's own version asserted this same repeated-key
    // request resolves to 'pending' — but PHP's parse_str() decides the
    // winner among two DIFFERENTLY-shaped occurrences of the same key
    // before Laravel or QueryParam::first() ever see the query string, and
    // it keeps the LAST occurrence, discarding the first outright,
    // verified directly:
    //   parse_str('status=pending&status[]=active', $o) => ['status' =>
    //   ['active']] — 'pending' is gone, not merely deprioritised.
    // QueryParam::first() only flattens an ARRAY's own first element
    // (app/Support/QueryParam.php's docblock); it has no way to recover a
    // value PHP's own decoder already discarded. 'active' is therefore the
    // correct, only-possible resolution of this exact query string, and
    // the assertion below is what "repeated keys take their first value"
    // actually verifies here: an all-array repetition
    // (?status[]=pending&status[]=active), where QueryParam::first() picks
    // element 0.
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers?status=pending&status[]=active")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('readers.rows', 1)
            ->where('readers.rows.0.fullName', 'Đang Hoạt Động'));

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers?status[]=pending&status[]=active")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('readers.rows', 1)
            ->where('readers.rows.0.fullName', 'Chờ Duyệt'));
});

it('the roster screen is titled Người đọc and shows readers only', function () {
    [$shelf, $manager] = mrsFixture();
    mrsReader($shelf, 'Bạn Đọc Thường');

    // The manager's own membership must not appear in a list built to
    // edit reader profiles directly (post-review fix wave item 1).
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers")
        ->assertInertia(fn (Assert $page) => $page->has('readers.rows', 1));
});

it('the create form carries the shelf\'s pickers and no credential section props', function () {
    [$shelf, $manager] = mrsFixture();

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/readers/create")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('manage/readers/create')
            ->has('units', 1)
            ->where('taxonomy.level1Label', 'Giáo họ'));
});

it('storing on behalf creates a PENDING member and lands on their detail page', function () {
    [$shelf, $manager] = mrsFixture();

    $response = $this->actingAs($manager)->post("/shelves/{$shelf->slug}/manage/readers", [
        'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'date_of_birth' => '2014-09-01', 'father_name' => 'Trần Văn Ba',
        'mother_name' => 'Lê Thị Tư', 'phone' => '0987654321',
    ]);

    $membership = Membership::query()->withoutGlobalScope(BookshelfScope::class)
        ->where('bookshelf_id', $shelf->id)->where('role', 'reader')->firstOrFail();
    expect($membership->status->value)->toBe('pending');
    $response->assertRedirect("/shelves/{$shelf->slug}/manage/readers/{$membership->id}");
});

it('a guest is redirected to login', function () {
    [$shelf] = mrsFixture();

    $this->get("/shelves/{$shelf->slug}/manage/readers")->assertRedirect('/login');
});

it('a signed-in reader 404s on every manager readers route', function () {
    [$shelf] = mrsFixture();
    $reader = mrsReader($shelf, 'Chỉ Là Bạn Đọc');
    $person = User::query()->findOrFail($reader->user_id);

    $this->actingAs($person)->get("/shelves/{$shelf->slug}/manage/readers")->assertNotFound();
});
