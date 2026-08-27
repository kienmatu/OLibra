<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

function communityShelf(): string
{
    $id = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $id, 'slug' => 'shelf-'.substr($id, -8), 'name' => 'Tủ sách Đồng Tháp',
        'settings' => '{}',
    ]);

    return $id;
}

function communityUser(): string
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert([
        'id' => $id, 'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);

    return $id;
}

/** A book on $shelf — comments.book_id now carries a real composite FK (Task 11). */
function communityBook(string $shelf): string
{
    $id = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $id, 'bookshelf_id' => $shelf,
        'title' => 'Hoàng Tử Bé', 'slug' => 'hoang-tu-be-'.substr($id, -8),
    ]);

    return $id;
}

/** A membership on $shelf — book_donations.donor_membership_id now carries a real composite FK (Task 11). */
function communityMembership(string $shelf): string
{
    $id = (string) Str::uuid7();
    DB::table('memberships')->insert([
        'id' => $id, 'bookshelf_id' => $shelf, 'user_id' => communityUser(),
    ]);

    return $id;
}

/**
 * Assert that $attempt() fails with the given CHECK constraint (MariaDB
 * errno 4025, SQLSTATE 23000), not merely with *some* QueryException — a
 * typo'd column name or an unrelated failure must not satisfy this.
 */
function assertCheckViolation(callable $attempt, string $constraint): void
{
    try {
        $attempt();
        test()->fail("expected CHECK constraint `{$constraint}` to fire");
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe(4025)
            ->and($e->errorInfo[2])->toContain("CONSTRAINT `{$constraint}`");
    }
}

/** @return array<int, array{table: string, column: string}> */
function communityIndexColumns(string $table, string $index): array
{
    return DB::select(
        'select column_name from information_schema.statistics
         where table_schema = database() and table_name = ? and index_name = ?
         order by seq_in_index',
        [$table, $index]
    );
}

it('creates the community tables', function () {
    foreach (['comments', 'announcements', 'feedback', 'book_donations'] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }
});

it('lets front-door feedback carry no shelf', function () {
    DB::table('feedback')->insert([
        'id' => (string) Str::uuid7(),
        'bookshelf_id' => null,
        'guest_name' => 'Anna Phạm Thu Hà',
        'guest_contact' => '0900 000 000',
        'subject' => 'Góp ý',
        'body' => 'Trang chủ rất dễ dùng.',
    ]);

    expect(DB::table('feedback')->whereNull('bookshelf_id')->count())->toBe(1);
});

it('also accepts a shelf-scoped feedback row', function () {
    $shelf = communityShelf();

    $id = (string) Str::uuid7();
    DB::table('feedback')->insert([
        'id' => $id,
        'bookshelf_id' => $shelf,
        'guest_name' => 'Maria Nguyễn',
        'subject' => 'Xin cảm ơn',
        'body' => 'Tủ sách rất hữu ích.',
    ]);

    expect(DB::table('feedback')->where('id', $id)->value('bookshelf_id'))->toBe($shelf);
});

it('scopes announcement slugs per shelf, alive rows only', function () {
    $shelf = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $shelf, 'slug' => 'shelf-'.substr($shelf, -8), 'name' => 'Tủ sách Đồng Tháp', 'settings' => '{}',
    ]);

    $insert = fn (?string $deletedAt = null) => DB::table('announcements')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => 'Thông báo', 'slug' => 'thong-bao',
        'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung',
        'deleted_at' => $deletedAt,
    ]);

    $insert(now());   // soft-deleted: frees the slug
    $insert();        // live

    // Confirm the soft-deleted row's slug is genuinely free, not just that
    // the duplicate rejects for some other reason: a distinct third slug
    // on the same shelf must always succeed.
    DB::table('announcements')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => 'Thông báo khác', 'slug' => 'thong-bao-khac',
        'body' => '<p>Nội dung khác</p>', 'body_text' => 'Nội dung khác',
    ]);

    expect(fn () => $insert())->toThrow(QueryException::class);
});

it('rejects a comments status outside the enum', function () {
    $shelf = communityShelf();
    $user = communityUser();

    assertCheckViolation(fn () => DB::table('comments')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'book_id' => communityBook($shelf), 'author_id' => $user,
        'body' => 'Hay quá', 'status' => 'not_a_real_status',
    ]), 'comments_status_check');
});

it('accepts a comments row through the default pending status', function () {
    $shelf = communityShelf();
    $user = communityUser();

    $id = (string) Str::uuid7();
    DB::table('comments')->insert([
        'id' => $id, 'bookshelf_id' => $shelf,
        'book_id' => communityBook($shelf), 'author_id' => $user,
        'body' => 'Hay quá',
    ]);

    expect(DB::table('comments')->where('id', $id)->value('status'))->toBe('pending');
});

it('rejects a feedback status outside the enum', function () {
    assertCheckViolation(fn () => DB::table('feedback')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => null,
        'subject' => 'x', 'body' => 'y', 'status' => 'archived',
    ]), 'feedback_status_check');
});

it('rejects a book_donations status outside the enum', function () {
    $shelf = communityShelf();

    assertCheckViolation(fn () => DB::table('book_donations')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'donor_membership_id' => communityMembership($shelf),
        'description' => '3 quyển truyện', 'status' => 'not_a_real_status',
    ]), 'book_donations_status_check');
});

it('requires a decision_note when a donation is declined', function () {
    $shelf = communityShelf();

    assertCheckViolation(fn () => DB::table('book_donations')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'donor_membership_id' => communityMembership($shelf),
        'description' => '3 quyển truyện', 'status' => 'declined', 'decision_note' => null,
    ]), 'book_donations_declined_has_reason');

    // But with a note, it succeeds.
    $id = (string) Str::uuid7();
    DB::table('book_donations')->insert([
        'id' => $id, 'bookshelf_id' => $shelf,
        'donor_membership_id' => communityMembership($shelf),
        'description' => '3 quyển truyện', 'status' => 'declined', 'decision_note' => 'sách hỏng',
    ]);

    expect(DB::table('book_donations')->where('id', $id)->exists())->toBeTrue();
});

it('accepts a pending book_donations row with no decision_note', function () {
    $shelf = communityShelf();

    $id = (string) Str::uuid7();
    DB::table('book_donations')->insert([
        'id' => $id, 'bookshelf_id' => $shelf,
        'donor_membership_id' => communityMembership($shelf),
        'description' => '3 quyển truyện',
    ]);

    expect(DB::table('book_donations')->where('id', $id)->value('status'))->toBe('pending');
});

it('names the access-path indexes exactly, over information_schema', function () {
    expect(communityIndexColumns('comments', 'comments_public'))
        ->toHaveCount(2)
        ->and(array_map(fn ($r) => $r->column_name, communityIndexColumns('comments', 'comments_public')))
        ->toBe(['book_id', 'created_at']);

    expect(array_map(fn ($r) => $r->column_name, communityIndexColumns('book_donations', 'book_donations_queue')))
        ->toBe(['bookshelf_id', 'created_at']);

    expect(array_map(fn ($r) => $r->column_name, communityIndexColumns('announcements', 'announcements_bookshelf_id_slug_key')))
        ->toBe(['slug_key']);
});

it('carries exactly the expected foreign keys, including the Task-11 composite ones', function () {
    $rows = DB::select("
        select table_name, column_name, referenced_table_name
        from information_schema.key_column_usage
        where table_schema = database()
          and table_name in ('comments', 'announcements', 'feedback', 'book_donations')
          and referenced_table_name is not null
        order by table_name, column_name
    ");

    $actual = collect($rows)
        ->map(fn ($r) => "{$r->table_name}.{$r->column_name}->{$r->referenced_table_name}")
        ->all();
    sort($actual);

    $expected = [
        'announcements.author_id->users',
        'announcements.bookshelf_id->bookshelves',
        // book_donations.donor_membership_id -> memberships (Task 11): a
        // composite FK is listed twice — once per column of the pair.
        'book_donations.bookshelf_id->bookshelves',
        'book_donations.bookshelf_id->memberships',
        'book_donations.decided_by->users',
        'book_donations.donor_membership_id->memberships',
        // comments.book_id -> books (Task 11), same shape.
        'comments.author_id->users',
        'comments.book_id->books',
        'comments.bookshelf_id->books',
        'comments.bookshelf_id->bookshelves',
        'comments.moderated_by->users',
        'feedback.bookshelf_id->bookshelves',
        'feedback.handled_by->users',
        'feedback.member_id->users',
    ];
    sort($expected);

    expect($actual)->toBe($expected);
});

it('collates every enum-backed and uuid column ascii_bin', function () {
    $rows = DB::select("
        select table_name, column_name, collation_name
        from information_schema.columns
        where table_schema = database()
          and table_name in ('comments', 'announcements', 'feedback', 'book_donations')
    ");

    $expectedAsciiBin = [
        'comments' => ['id', 'bookshelf_id', 'book_id', 'author_id', 'status', 'moderated_by'],
        'announcements' => ['id', 'bookshelf_id', 'author_id'],
        'feedback' => ['id', 'bookshelf_id', 'member_id', 'status', 'handled_by'],
        'book_donations' => ['id', 'bookshelf_id', 'donor_membership_id', 'status', 'decided_by'],
    ];

    foreach ($rows as $row) {
        if (in_array($row->column_name, $expectedAsciiBin[$row->table_name], true)) {
            expect($row->collation_name)
                ->toBe('ascii_bin', "{$row->table_name}.{$row->column_name} should be ascii_bin, got ".($row->collation_name ?? 'NULL'));
        }
    }
});
