<?php

use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\Comment;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * THE SCREEN, not the command. tests/Feature/Community/CreateCommentTest
 * owns the POST's own behaviour (the row it writes, the audit entry, the
 * refusals, the two 404s) and this file owns what the BOOK PAGE carries:
 * the props BookDetailQuery now hands it, and the two flashes as the
 * reader meets them on the page they were sent back to.
 *
 * KNOWN BLIND SPOT, measured rather than asserted. assertInertia reads
 * server-side props only, and there is no second runner that would read
 * the rendered markup: at this commit `find resources/js -name '*.test.*'
 * -o -name '*.spec.*'` returns nothing and the repo carries no vitest or
 * jest config at its root (package.json's `test` script cd's into
 * old_next). Phase 1d measured what that costs — swapping two stat cards'
 * values left the whole suite, Pint, Larastan, Biome, tsc and the build
 * green. So every block here pins a PROP or a REDIRECT. That the list is
 * rendered under the comments heading, that the form posts to
 * shelves.books.comments.store, and that its button is the non-primary
 * variant are checked by READING resources/js/pages/shelves/book.tsx.
 *
 * Grep first: `grep -rn "^function bcsFix" tests/` — top-level helpers
 * are process-global (AGENTS.md).
 *
 * The fixture does NOT actingAs: cmcFix does, and every block below needs
 * exactly one identity of its own (SessionGuard caches the acting user
 * for a whole test method).
 *
 * @param  array<string, bool>  $settings  the shelf's settings blob VERBATIM
 * @return array{Bookshelf, User, Book}
 */
function bcsFix(array $settings = [], string $slug = 'dong-thap-bcs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $settings]);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men',
        'is_published' => true,
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader, $book];
}

/** One comment on $book in a named status, at a fixed instant. */
function bcsComment(Book $book, User $author, string $status, string $body, string $at): Comment
{
    return Comment::query()->create([
        'bookshelf_id' => $book->bookshelf_id, 'book_id' => $book->id, 'author_id' => $author->id,
        'body' => $body, 'status' => $status, 'created_at' => $at,
    ]);
}

it('the page carries the approved comment and neither the pending nor the rejected one', function () {
    // BY ID, not by count. A count of one would pass on a page that
    // dropped the approved row and kept the pending one, which is the
    // exact defect INV-9 exists for; the id list says WHICH row survived.
    //
    // The three are seeded pending, rejected, approved — the approved one
    // LAST — so a page that simply took the first row it found, or that
    // ordered by the primary key, cannot answer correctly by accident:
    // UUID v7 keys are chronologically monotonic, so insertion order and
    // id order agree here and the approved row is the newest id.
    [$shelf, $reader, $book] = bcsFix();
    bcsComment($book, $reader, 'pending', 'Đang chờ duyệt', '2026-08-01 08:00:00');
    bcsComment($book, $reader, 'rejected', 'Đã bị từ chối', '2026-08-01 09:00:00');
    $approved = bcsComment($book, $reader, 'approved', 'Con thích chú Dế Mèn', '2026-08-01 10:00:00');

    $response = test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}");

    $rows = $response->viewData('page')['props']['detail']['comments'];
    expect(array_column($rows, 'id'))->toBe([$approved->id]);
});

it('the approved comment reaches the page with the author\'s name and its instant', function () {
    // Its own block: a failed expect() aborts the whole METHOD, so the
    // "which rows" fact above and the "which fields" fact here must be
    // able to fail independently. What this adds over
    // BookCommentsQueryTest's own field block is that the query's rows
    // survive the CONTROLLER — BookDetailQuery merging them into the
    // detail bag, and Inertia serialising them.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-fields');
    bcsComment($book, $reader, 'approved', 'Con thích chú Dế Mèn', '2026-08-01 10:00:00');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('detail.comments.0.body', 'Con thích chú Dế Mèn')
            ->where('detail.comments.0.authorName', 'Têrêsa Bạn Đọc Nhỏ')
            ->where('detail.comments.0.createdAt', '2026-08-01T10:00:00.000000Z'));
});

it('a shelf that has turned comments off sends commentsEnabled false', function () {
    // The form is hidden off this prop. What the assertion pins is the
    // PROP; that the JSX branches on it is read, not tested (the blind
    // spot in this file's header).
    [$shelf, $reader, $book] = bcsFix(['comments_enabled' => false], 'dong-thap-bcs-off');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('detail.commentsEnabled', false));
});

it('a shelf that never opened its settings screen sends commentsEnabled true', function () {
    // The non-vacuity partner of the block above, and the default
    // direction BR §5.5 chose: an empty settings blob TAKES comments.
    // Without this block, a prop hardcoded to false would be green.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-on');

    test()->actingAs($reader)->get("/shelves/{$shelf->slug}/books/{$book->slug}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('detail.commentsEnabled', true));
});

it('the comment box on a moderating shelf sends the reader back to the page with the pending sentence', function () {
    // CreateCommentTest already pins that this POST flashes
    // rules.comment_pending_flash into the SESSION. What is pinned here
    // is the READER's end of the same round trip: the redirect lands on
    // the book page, and that page's shared flash prop carries the
    // sentence — which is the half a controller could break by flashing
    // under a key the page does not read.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-pending');
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    test()->actingAs($reader)->from($page)->post($page.'/comments', ['body' => 'Cuốn này hay lắm ạ'])
        ->assertRedirect($page);

    test()->get($page)->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('flash.success', __('rules.comment_pending_flash')));
});

it('the same box on a shelf that does not moderate says the comment is up, not that it is waiting', function () {
    // Its own block, and the pair is the point: these two sentences are
    // what a reader is told about a shelf's moderation setting, and each
    // must be able to fail without the other. Measured — hardcoding
    // CommentController's ternary to `true` reddens this block alone, and
    // to `false` reddens its twin above alone.
    [$shelf, $reader, $book] = bcsFix(['comments_require_approval' => false], 'dong-thap-bcs-open');
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    test()->actingAs($reader)->from($page)->post($page.'/comments', ['body' => 'Cuốn này hay lắm ạ'])
        ->assertRedirect($page);

    test()->get($page)->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('shelves/book')
            ->where('flash.success', __('rules.comment_published_flash')));
});

it('and on that same shelf the comment is on the page immediately, not waiting for a manager', function () {
    // The write half of the block above, separated so the flash and the
    // row can fail apart. CreateComment (opened at this commit) picks
    // Approved from one condition — comments_require_approval being off —
    // and this is that path reaching the reader's own list on the next
    // render.
    [$shelf, $reader, $book] = bcsFix(['comments_require_approval' => false], 'dong-thap-bcs-open-row');
    $page = "/shelves/{$shelf->slug}/books/{$book->slug}";

    test()->actingAs($reader)->from($page)->post($page.'/comments', ['body' => 'Hiện ngay không cần duyệt']);

    $rows = test()->get($page)->viewData('page')['props']['detail']['comments'];
    expect(array_column($rows, 'body'))->toBe(['Hiện ngay không cần duyệt']);
});

it('a signed-in non-member meets 404 on the book page itself, never 403', function () {
    // Spec §5.4: a refusal must not tell a stranger which shelf URLs are
    // real. CreateCommentTest pins the same answer on the comment POST;
    // this is the GET that renders the comment list, and the reason it is
    // in THIS file is that the list is what the 404 is now withholding.
    //
    // Its own it() with its own fixture identity — SessionGuard caches
    // the acting user for a whole method.
    [$shelf, , $book] = bcsFix([], 'dong-thap-bcs-stranger');
    app(TenantContext::class)->actSystemWide();
    $stranger = User::factory()->create(['full_name' => 'Phêrô Người Lạ']);

    $response = test()->actingAs($stranger)->get("/shelves/{$shelf->slug}/books/{$book->slug}");

    // The not-403 line cannot fail on its own — assertNotFound() is
    // assertStatus(404), which a 403 already fails. It is kept so the
    // property this block exists for is legible without knowing that.
    $response->assertNotFound();
    expect($response->getStatusCode())->not->toBe(403);
});

it('an empty body is a field error on body, the Form Request\'s own required', function () {
    // TWO DOORS, TWO SHAPES, and this is the first. A truly empty body
    // fails StoreCommentRequest's `required` and comes back as
    // errors.body, which the form renders beside the textarea.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-empty');

    $response = test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => '']);

    $response->assertSessionHasErrors(['body']);
    expect(Comment::query()->count())->toBe(0);
});

it('an empty body is NOT the banner — errors.rule is absent from that response', function () {
    // The other half of the shape above, in its own block because a
    // failed expect() aborts the method. KEY-BY-KEY rather than by count:
    // a bag that carried both `body` and `rule` would satisfy the block
    // above and paint the page with a banner AND a field error for one
    // mistake.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-empty-nobanner');

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => '']);

    $messages = session('errors')->getBag('default')->getMessages();
    expect(array_key_exists('rule', $messages))->toBeFalse();
});

it('a body of three spaces is the SAME field error — over HTTP it never reaches CreateComment', function () {
    // DIVERGENCE FROM THIS TASK'S BRIEF, measured rather than argued. The
    // brief expected three spaces to pass `required`, reach CreateComment
    // and come back as its empty_body RuleViolated — the banner. On this
    // route it does not. Laravel's `required` refuses a string whose
    // trim() is empty (validateRequired's second arm, in
    // Illuminate\Validation\Concerns\ValidatesAttributes, opened and read
    // at this commit), so the Form Request answers first and the reader
    // gets errors.body.
    //
    // MEASURED WITH THE OTHER SUSPECT REMOVED, because the default global
    // stack also carries TrimStrings and ConvertEmptyStringsToNull and
    // either would produce this same answer: the probe re-ran this exact
    // POST under ->withoutMiddleware([TrimStrings::class,
    // ConvertEmptyStringsToNull::class]) and the response still carried
    // exactly one error key, `body`. So `required` alone is sufficient
    // here, and the two layers agree rather than one hiding the other.
    //
    // WHAT THE READER SEES IS UNCHANGED EITHER WAY, which is why this is
    // a divergence and not a defect: lang/vi/validation.php's `required`
    // is "Vui lòng nhập :attribute." over the attribute name "nội dung
    // bình luận", which is the same sentence as lang/vi/rules.php's
    // empty_body. Only the KEY it arrives under differs — field, not
    // banner — and the form renders that key beside the textarea.
    //
    // CreateComment's own trim is not made redundant by this: it guards
    // the direct execute() call CreateCommentTest makes, where no Form
    // Request runs at all.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-spaces');

    $response = test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => '   ']);

    $response->assertSessionHasErrors(['body']);
    expect(Comment::query()->count())->toBe(0);
});

it('and the whitespace refusal is not the banner either — errors.rule stays absent', function () {
    // Its own block, key-by-key, the mirror of the empty-body pair above.
    // This is the assertion that would go red if the two doors ever both
    // opened for one mistake, painting a banner AND a field error.
    [$shelf, $reader, $book] = bcsFix([], 'dong-thap-bcs-spaces-nobanner');

    test()->actingAs($reader)
        ->post("/shelves/{$shelf->slug}/books/{$book->slug}/comments", ['body' => '   ']);

    $messages = session('errors')->getBag('default')->getMessages();
    expect(array_key_exists('rule', $messages))->toBeFalse();
});
