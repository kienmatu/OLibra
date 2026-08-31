<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Grep first: `grep -rn "^function lblExpFix" tests/`.
 *
 * @return array{Bookshelf, User, Book, BookCopy}
 */
function lblExpFix(string $slug = 'dong-thap-lblexp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0001']);

    return [$shelf, $manager, $book, $copy];
}

it('renders the selection screen with its titles', function () {
    [$shelf, $manager, $book, $copy] = lblExpFix();

    // Prop assertions only — this repo has no frontend rendering tests
    // (LabelController's docblock, and Task 11's brief), so the shape
    // TitlesForLabelsQuery hands the accordion is the only part of the
    // screen anything here can verify: one title, its bookId/title, and
    // its one copy's copyId/code/printCount.
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/qr-labels")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/labels')
            ->has('titles', 1)
            ->where('titles.0.bookId', $book->id)
            ->where('titles.0.title', 'Dế Mèn Phiêu Lưu Ký')
            ->has('titles.0.copies', 1)
            ->where('titles.0.copies.0.copyId', $copy->id)
            ->where('titles.0.copies.0.code', 'DT-0001')
            ->where('titles.0.copies.0.printCount', 0)
            ->where('onlyUnprinted', false));
});

it('the onlyUnprinted query param round-trips into the prop and drops printed-out titles', function () {
    [$shelf, $manager, , $copy] = lblExpFix();
    $copy->forceFill(['qr_print_count' => 1, 'qr_printed_at' => now()])->save();

    // The shelf's only copy is already printed, so with the filter on,
    // TitlesForLabelsQuery's docblock applies: "a title whose every copy
    // is already printed" is dropped, not rendered with an empty copies
    // array.
    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/qr-labels?onlyUnprinted=1")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/labels')
            ->where('onlyUnprinted', true)
            ->has('titles', 0));
});

it('exporting returns a PDF and stamps the copies', function () {
    [$shelf, $manager, , $copy] = lblExpFix();

    $response = $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$copy->id]]);

    $response->assertOk();
    expect($response->headers->get('content-type'))->toContain('application/pdf')
        ->and($copy->fresh()->qr_print_count)->toBe(1)
        ->and($copy->fresh()->qr_printed_at)->not->toBeNull();
});

it('an empty selection is refused as a rule, not a 500', function () {
    [$shelf, $manager] = lblExpFix();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [], 'bookIds' => []])
        ->assertRedirect()
        // bootstrap/app.php renders RuleViolated as
        // back()->withErrors(['rule' => …]). Assert the KEY, not merely
        // that some error bag exists: `manage/labels` reads exactly
        // `errors.rule`, so a refusal filed under any other key would
        // render nothing at all.
        ->assertSessionHasErrors(['rule']);

    // WHAT THIS BLOCK CANNOT SEE, said plainly because its absence is
    // how the defect survived a whole branch: nothing here proves the
    // page RENDERS the message. The whole-branch review found
    // manage/labels.tsx destructuring only `{ shelf, csrfToken }` while
    // these two assertions passed. This repo has no frontend rendering
    // tests; the `errors.rule` block in manage/labels.tsx is verified by
    // reading the component, and its docblock says so.
});

it('ticking a whole title exports EVERY copy of it, including already-printed ones', function () {
    [$shelf, $manager, $book, $printed] = lblExpFix();
    $printed->forceFill(['qr_print_count' => 3, 'qr_printed_at' => now()])->save();
    $fresh = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0002']);

    // PINNING SHIPPED BEHAVIOUR, not endorsing it. The selection screen's
    // "Chỉ hiện bản chưa in nhãn" filter would show this title with ONE
    // copy (DT-0002), but LabelController::export calls
    // CopiesForLabelsQuery::run($bookIds, $copyIds) without
    // $onlyUnprinted and the form carries no filter state — so a ticked
    // title expands to BOTH copies and stamps both, DT-0001 to a fourth
    // print. That matches the reference (old_next's route omits the
    // filter too); the fix wave made the checkbox SAY so
    // (copy.manageLabels.selectWholeTitle) rather than change it. Anyone
    // narrowing this to the filtered subset must break this block first.
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['bookIds' => [$book->id]])
        ->assertOk();

    expect($printed->fresh()->qr_print_count)->toBe(4)
        ->and($fresh->fresh()->qr_print_count)->toBe(1);
});

it('another shelf\'s copy id stamps nothing', function () {
    [$shelf, $manager] = lblExpFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-lblexp', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create();
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$otherCopy->id]]);

    expect($otherCopy->fresh()->qr_print_count)->toBe(0);
});

it('a reader meets 404 on both the screen and the export', function () {
    [$shelf, , , $copy] = lblExpFix();
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // NOT a vacuous 404 pair, and here is the proof rather than the claim:
    // /qr-labels is ALREADY claimed by the placeholder at routes/web.php:492,
    // inside ['auth','role:manager'], so the GET block is meaningful before
    // this task changes anything. The POST is the one to watch — until the
    // verb changes at :493 the path is claimed by a GET, and an unrouted
    // METHOD on a claimed path answers 405, not 404. If this block passes with
    // 404 before the route lands, it is passing on the router's absence; check
    // it again afterwards.
    $this->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/qr-labels")->assertNotFound();
    $this->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/manage/exports/qr-labels", ['copyIds' => [$copy->id]])
        ->assertNotFound();
});
