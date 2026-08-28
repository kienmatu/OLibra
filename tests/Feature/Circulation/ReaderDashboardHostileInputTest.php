<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Task 13's facts that bind: probe hostile input over real HTTP on every
 * parameter of every new route, query string and body, matching the
 * earlier tasks' bar (249 and 32 probes; one of them found a genuine 500).
 * Payload classes: an array, a nested array, an empty array, a NUL byte,
 * invalid UTF-8, and an oversized string. None may 500 — a refusal is
 * validation errors, a redirect, or a 404; never an unhandled exception
 * (OPS §2).
 *
 * The three routes: overview (GET, no parameters at all — nothing to
 * probe there beyond the route segment itself, covered by the shelf-slug
 * probes every tenant route already carries), history (GET, `?page=`),
 * and renew (POST, no body — only the `{loan}` route segment is
 * attacker-controlled).
 */
function rdhFix(string $slug = 'dong-thap-rdh'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Hostile Probe Manager']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $reader = User::factory()->create(['full_name' => 'Hostile Probe Reader']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Sách Thử Độc Hại RDH', 'slug' => 'sach-thu-doc-hai-'.$slug]);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'RH-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $reader->id, 'lent_by' => $manager->id,
        'due_on' => '2026-09-11', 'status' => 'active',
    ]);
    app(TenantContext::class)->clear();

    return [$shelf, $reader, $loan];
}

/** @return array<string, mixed> */
function rdhPayloads(): array
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

foreach (rdhPayloads() as $label => $payload) {
    $slugSuffix = substr(md5($label), 0, 8);

    it("GET history ?page= survives a {$label} payload", function () use ($payload, $slugSuffix) {
        [$shelf, $reader] = rdhFix(slug: 'rdh-page-'.$slugSuffix);

        $query = is_array($payload) ? http_build_query(['page' => $payload]) : 'page='.rawurlencode((string) $payload);

        $response = $this->actingAs($reader)
            ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]).'?'.$query);

        expect($response->status())->not->toBe(500);
    });

    it("POST renew {loan} survives a {$label} route segment", function () use ($payload, $slugSuffix) {
        [$shelf, $reader] = rdhFix(slug: 'rdh-loan-'.$slugSuffix);

        // A path segment cannot literally carry an array the way a query
        // string can, so every payload class here is flattened to a
        // string the way a hand-crafted URL would arrive — the point is
        // that Loan's UUID route binding refuses gracefully (404) rather
        // than 500ing on a segment that is not a well-formed UUID.
        $segment = is_array($payload) ? (string) json_encode($payload) : (string) $payload;

        $response = $this->actingAs($reader)
            ->post('/shelves/'.$shelf->slug.'/profile/loans/'.rawurlencode($segment).'/renew');

        expect($response->status())->not->toBe(500);
    });
}

it('GET history ?page= with a negative number never 500s and clamps to page 1', function () {
    [$shelf, $reader] = rdhFix(slug: 'rdh-page-negative');

    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]).'?page=-5')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->where('history.page', 1));
});

it('GET history ?page= with a non-numeric string never 500s and clamps to page 1', function () {
    [$shelf, $reader] = rdhFix(slug: 'rdh-page-nan');

    $this->actingAs($reader)
        ->get(route('shelves.profile.history', ['shelf' => $shelf->slug]).'?page=abc')
        ->assertOk()
        ->assertInertia(fn ($page) => $page->where('history.page', 1));
});
