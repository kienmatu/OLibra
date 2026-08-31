<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Support\Qr\LabelPayload;
use App\Support\TenantContext;

/**
 * Grep first: `grep -rn "^function scanFix" tests/`.
 *
 * @return array{Bookshelf, User, Book, BookCopy}
 */
function scanFix(string $slug = 'dong-thap-scan'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Maria Nguyễn Lan']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    $book = Book::factory()->for($shelf)->create(['title' => 'Dế Mèn Phiêu Lưu Ký']);
    $copy = BookCopy::factory()->for($shelf)->for($book)->create(['code' => 'DT-0142']);

    return [$shelf, $reader, $book, $copy];
}

it('a valid label payload resolves to its copy', function () {
    [$shelf, $reader, $book, $copy] = scanFix();

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/scan?payload=".urlencode(LabelPayload::encode($copy->id)))
        ->assertOk()
        ->assertJson([
            'copy' => [
                'copyId' => $copy->id,
                'code' => 'DT-0142',
                'bookId' => $book->id,
                'title' => 'Dế Mèn Phiêu Lưu Ký',
            ],
        ]);
});

it('an OLB2 payload is refused by name rather than decoded into a wrong copy', function () {
    [$shelf, $reader, , $copy] = scanFix();

    // Same 22-character token LabelPayload::encode would have produced for
    // this copy, but stamped with a format version the running code does
    // not speak. uuidFrom() must refuse it on the prefix alone, before any
    // base64 decoding — never resolve it as if it were OLB1.
    $token = substr(LabelPayload::encode($copy->id), strlen(LabelPayload::PREFIX));

    $this->actingAs($reader)
        ->get('/shelves/'.$shelf->slug.'/scan?payload='.urlencode('OLB2:'.$token))
        ->assertOk()
        ->assertJson(['copy' => null]);
});

it('a foreign shelf\'s label resolves to nothing — tenancy, not role', function () {
    [$shelf, $reader] = scanFix();

    app(TenantContext::class)->actSystemWide();
    $other = Bookshelf::factory()->create(['slug' => 'other-scan-shelf', 'settings' => []]);
    $otherBook = Book::factory()->for($other)->create(['title' => 'Zzz']);
    $otherCopy = BookCopy::factory()->for($other)->for($otherBook)->create(['code' => 'ZZ-0001']);

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/scan?payload=".urlencode(LabelPayload::encode($otherCopy->id)))
        ->assertOk()
        ->assertJson(['copy' => null]);
});

it('a bare uuid, not wrapped in the OLB1 payload, is rejected', function () {
    [$shelf, $reader, , $copy] = scanFix();

    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/scan?payload=".urlencode($copy->id))
        ->assertOk()
        ->assertJson(['copy' => null]);
});

it('a reader reaches the scan route — deliberately not manager-only', function () {
    [$shelf, $reader] = scanFix();

    // OPS §3.3: the route's own permission is role:reader, not a manager
    // gate — this asserts exactly that, independent of what payload=
    // resolves to.
    $this->actingAs($reader)
        ->get("/shelves/{$shelf->slug}/scan")
        ->assertOk()
        ->assertJson(['copy' => null]);
});
