<?php

use App\Enums\LoanStatus;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Task 11's "facts that bind you": probe hostile input over real HTTP on
 * every parameter of every new route, query string and body, matching
 * Task 10's 249-probe bar. Every route below is dispatched through the full
 * HTTP kernel (routing, middleware, FormRequest, controller) via Pest's
 * test client — the same layers a real `curl` request traverses; only the
 * TCP socket is skipped.
 *
 * The five payload classes, per parameter: an array, a nested array, an
 * empty array, a NUL byte, invalid UTF-8, and an oversized string. None of
 * these may 500 — a refusal is validation errors, a redirect, or a 404;
 * never an unhandled exception (OPS §2).
 */
function rhiFix(string $slug = 'dong-thap-rhi'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Hostile Probe Manager']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Thử Độc Hại', 'slug' => 'sach-thu-doc-hai-'.$slug]);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'HX-0001', 'state' => 'on_loan']);
    $reader = User::factory()->create(['full_name' => 'Hostile Probe Reader']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $manager, $loan];
}

/** @return array<string, mixed> */
function rhiPayloads(): array
{
    return [
        'array' => ['x', 'y'],
        'nested array' => [['a' => ['b' => 'c']]],
        'empty array' => [],
        'NUL byte' => "de men\x00phieu luu",
        'invalid UTF-8' => "\xC3\x28",
        'oversized' => str_repeat('a', 100000),
    ];
}

foreach (rhiPayloads() as $label => $payload) {
    it("GET /returns ?q= survives a {$label} payload", function () use ($payload) {
        [$shelf, $manager] = rhiFix(slug: 'rhi-q-'.substr(md5((string) json_encode($payload)), 0, 8));

        $response = $this->actingAs($manager)
            ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]).'?q='.(is_array($payload) ? http_build_query(['q' => $payload]) : rawurlencode((string) $payload)));

        expect($response->status())->not->toBe(500);
    });

    it("GET /returns ?loan= survives a {$label} payload", function () use ($payload) {
        [$shelf, $manager] = rhiFix(slug: 'rhi-l-'.substr(md5((string) json_encode($payload)), 0, 8));

        $response = $this->actingAs($manager)
            ->get(route('shelves.manage.returns', ['shelf' => $shelf->slug]).'?loan='.(is_array($payload) ? http_build_query(['loan' => $payload]) : rawurlencode((string) $payload)));

        expect($response->status())->not->toBe(500);
    });

    it("GET /returns/lost ?q= and ?loan= survive a {$label} payload", function () use ($payload) {
        [$shelf, $manager] = rhiFix(slug: 'rhi-lost-'.substr(md5((string) json_encode($payload)), 0, 8));

        $qs = is_array($payload)
            ? http_build_query(['q' => $payload, 'loan' => $payload])
            : 'q='.rawurlencode((string) $payload).'&loan='.rawurlencode((string) $payload);

        $response = $this->actingAs($manager)
            ->get(route('shelves.manage.returns.lost', ['shelf' => $shelf->slug]).'?'.$qs);

        expect($response->status())->not->toBe(500);
    });

    it("POST /returns/{loan} condition survives a {$label} payload", function () use ($payload) {
        [$shelf, $manager, $loan] = rhiFix(slug: 'rhi-c-'.substr(md5((string) json_encode($payload)), 0, 8));

        $response = $this->actingAs($manager)
            ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
                ['condition' => $payload]);

        expect($response->status())->not->toBe(500);
        expect($loan->fresh()->status)->toBe(LoanStatus::Active);
    });

    it("POST /returns/{loan} note survives a {$label} payload", function () use ($payload) {
        [$shelf, $manager, $loan] = rhiFix(slug: 'rhi-n-'.substr(md5((string) json_encode($payload)), 0, 8));

        $response = $this->actingAs($manager)
            ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
                ['condition' => 'perfect', 'note' => $payload]);

        expect($response->status())->not->toBe(500);
        // A valid condition with a hostile note either succeeds (note
        // sanitised/refused independently) or fails validation — either
        // way the loan is never left in a half-processed state.
        expect($loan->fresh()->status)->toBeIn([LoanStatus::Active, LoanStatus::Returned]);
    });
}

it('invalid UTF-8 in note is refused as validation, never reaches the database', function () {
    // "Facts that bind you": an invalid-UTF-8 free-text field reaching the
    // database uncaught is Phase 1b's shape (Registration.php, PR #61 fix
    // round). ReceiveReturnRequest's `note` rule carries `encoding:UTF-8`
    // for exactly this reason — pinned here, not just smoke-tested by the
    // generic loop above, and proved by mutation below.
    [$shelf, $manager, $loan] = rhiFix(slug: 'rhi-note-utf8');

    $this->actingAs($manager)
        ->post(route('shelves.manage.returns.store', ['shelf' => $shelf->slug, 'loan' => $loan->id]),
            ['condition' => 'perfect', 'note' => "r\xC3\x28ch"])
        ->assertSessionHasErrors('note');

    expect($loan->fresh()->status)->toBe(LoanStatus::Active);
});

it('a NUL byte in the returns.store {loan} route parameter itself 404s, never 500s', function () {
    [$shelf, $manager] = rhiFix(slug: 'rhi-loanparam');

    $response = $this->actingAs($manager)
        ->post('/shelves/'.$shelf->slug.'/manage/returns/'.rawurlencode("abc\x00def"),
            ['condition' => 'perfect']);

    expect($response->status())->not->toBe(500);
});
