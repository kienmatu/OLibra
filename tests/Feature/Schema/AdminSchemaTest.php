<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

function adminShelf(): string
{
    $id = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $id, 'slug' => 'shelf-'.substr($id, -8), 'name' => 'Tủ sách Đồng Tháp',
        'settings' => '{}',
    ]);

    return $id;
}

function adminUser(): string
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert([
        'id' => $id, 'saint_name' => 'Anna', 'full_name' => 'Nguyễn Thị Bình',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);

    return $id;
}

/**
 * Assert that $attempt() fails with the given CHECK constraint (MariaDB
 * errno 4025, SQLSTATE 23000), not merely with *some* QueryException — a
 * typo'd column name or an unrelated failure must not satisfy this.
 */
function assertAdminCheckViolation(callable $attempt, string $constraint): void
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

/** @return array<int, array{column_name: string}> */
function adminIndexColumns(string $table, string $index): array
{
    return DB::select(
        'select column_name from information_schema.statistics
         where table_schema = database() and table_name = ? and index_name = ?
         order by seq_in_index',
        [$table, $index]
    );
}

it('creates the last five tables, completing the twenty', function () {
    foreach ([
        'notifications', 'audit_log', 'profile_change_requests',
        'system_settings', 'bookshelf_contacts',
    ] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }

    // The full census: 20 application tables + Laravel's own infrastructure
    // (sessions counted as application — the schema owns it; cache/jobs are
    // framework).
    foreach ([
        'users', 'bookshelves', 'parish_units', 'memberships', 'categories',
        'books', 'book_copies', 'loans', 'borrow_requests',
        'condition_assessments', 'comments', 'announcements', 'feedback',
        'book_donations', 'notifications', 'audit_log',
        'profile_change_requests', 'sessions', 'system_settings',
        'bookshelf_contacts',
    ] as $table) {
        expect(Schema::hasTable($table))->toBeTrue("missing table {$table}");
    }
});

it('gives audit_log a bigint identity pk, not a uuid', function () {
    $row = DB::selectOne("
        select data_type, extra, is_nullable
        from information_schema.columns
        where table_schema = database() and table_name = 'audit_log' and column_name = 'id'
    ");

    expect($row->data_type)->toBe('bigint')
        ->and($row->extra)->toContain('auto_increment');
});

it('accepts an audit_log row with no shelf and no actor', function () {
    $id = DB::table('audit_log')->insertGetId([
        'bookshelf_id' => null,
        'actor_id' => null,
        'action' => 'system.sweep',
        'entity_type' => 'loan',
        'entity_id' => null,
        'context' => '{}',
    ]);

    $row = DB::table('audit_log')->where('id', $id)->first();

    expect($row->bookshelf_id)->toBeNull()
        ->and($row->actor_id)->toBeNull();
});

it('refuses malformed json in audit_log context via a json_valid CHECK', function () {
    assertAdminCheckViolation(fn () => DB::table('audit_log')->insert([
        'action' => 'system.sweep', 'entity_type' => 'loan', 'context' => 'not json at all',
    ]), 'audit_log.context');
});

it('refuses malformed json in notifications payload via a json_valid CHECK', function () {
    $shelf = adminShelf();
    $user = adminUser();

    assertAdminCheckViolation(fn () => DB::table('notifications')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'user_id' => $user,
        'kind' => 'loan_due_soon', 'payload' => '{not valid json',
    ]), 'notifications.payload');
});

it('holds exactly one system_settings row, refusing a second', function () {
    // The migration itself seeded the row.
    // toEqual, not toBe: PDO may hand these back as strings depending on
    // driver options; the value is what matters, not the PHP type.
    expect(DB::table('system_settings')->count())->toBe(1)
        ->and(DB::table('system_settings')->value('default_loan_days'))->toEqual(14)
        ->and(DB::table('system_settings')->value('default_max_concurrent_loans'))->toEqual(3)
        ->and(DB::table('system_settings')->value('default_hold_days'))->toEqual(3)
        ->and(DB::table('system_settings')->value('default_max_renewals'))->toEqual(1)
        ->and(DB::table('system_settings')->value('default_renewal_days'))->toEqual(7)
        ->and(DB::table('system_settings')->value('default_due_soon_days'))->toEqual(3);

    // A second row under the same id: a plain 1062 duplicate-key error.
    try {
        DB::table('system_settings')->insert(['id' => 1]);
        test()->fail('expected the second row to violate the primary key');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000');
    }

    // And the CHECK stops a second row arriving under a different id — this
    // is the property that actually proves the single-row shape, since a
    // different id does not collide with the primary key at all.
    assertAdminCheckViolation(
        fn () => DB::table('system_settings')->insert(['id' => 2]),
        'system_settings_single_row'
    );
});

it('allows one pending profile change per person, more once decided', function () {
    $user = adminUser();
    $shelf = adminShelf();

    $insert = fn (string $status, ?string $rejectionReason = null) => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{"phone":"0900000001"}', 'previous_values' => '{"phone":null}',
        'status' => $status, 'rejection_reason' => $rejectionReason,
    ]);

    $insert('approved');
    $insert('pending');

    expect(fn () => $insert('pending'))->toThrow(QueryException::class);
});

it('frees the pending slot on rejected, not only approved', function () {
    $user = adminUser();
    $shelf = adminShelf();

    $insert = fn (string $status, ?string $rejectionReason = null) => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{"phone":"0900000002"}', 'previous_values' => '{"phone":null}',
        'status' => $status, 'rejection_reason' => $rejectionReason,
    ]);

    $insert('rejected', 'không hợp lệ');
    $insert('pending');

    expect(fn () => $insert('pending'))->toThrow(QueryException::class);
});

it('frees the pending slot on cancelled, not only approved', function () {
    $user = adminUser();
    $shelf = adminShelf();

    $insert = fn (string $status) => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{"phone":"0900000003"}', 'previous_values' => '{"phone":null}',
        'status' => $status,
    ]);

    $insert('cancelled');
    $insert('pending');

    expect(fn () => $insert('pending'))->toThrow(QueryException::class);
});

it('rejects a profile_change_requests status outside the enum', function () {
    $user = adminUser();
    $shelf = adminShelf();

    assertAdminCheckViolation(fn () => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{}', 'previous_values' => '{}', 'status' => 'not_a_real_status',
    ]), 'profile_change_requests_status_check');
});

it('requires a rejection_reason when a profile change is rejected', function () {
    $user = adminUser();
    $shelf = adminShelf();

    assertAdminCheckViolation(fn () => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{}', 'previous_values' => '{}',
        'status' => 'rejected', 'rejection_reason' => null,
    ]), 'profile_change_requests_rejected_has_reason');
});

it('scopes bookshelf_contacts positions per shelf, alive rows only', function () {
    $shelf = adminShelf();

    $insert = fn (int $position, ?string $deletedAt = null) => DB::table('bookshelf_contacts')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'position' => $position, 'name' => 'Người giữ chìa khoá', 'deleted_at' => $deletedAt,
    ]);

    $insert(1, now());   // soft-deleted: frees the position
    $insert(1);          // live

    expect(fn () => $insert(1))->toThrow(QueryException::class);

    // A distinct position on the same shelf must always succeed.
    $insert(2);
});

it('rejects a bookshelf_contacts position outside 1..3', function () {
    $shelf = adminShelf();

    assertAdminCheckViolation(fn () => DB::table('bookshelf_contacts')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'position' => 4, 'name' => 'Ai đó',
    ]), 'bookshelf_contacts_position_check');
});

it('names the access-path indexes exactly, over information_schema', function () {
    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('notifications', 'notifications_unread')))
        ->toBe(['user_id', 'created_at']);

    // Added by 2026_08_30_000001 for Task 16's bell count, and pinned here
    // because losing it is SILENT: no test reddens, no gate complains, and
    // the count merely goes back to the `type: ALL` full scan of every
    // tenant's notifications that it planned as before the index existed
    // (docs/known-gaps.md carries both plans). The most expensive kind of
    // regression is the one only a stopwatch can see.
    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('notifications', 'notifications_unread_by_user')))
        ->toBe(['user_id', 'read_at']);

    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('audit_log', 'audit_log_actor')))
        ->toBe(['actor_id', 'occurred_at']);

    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('audit_log', 'audit_log_shelf')))
        ->toBe(['bookshelf_id', 'occurred_at']);

    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('audit_log', 'audit_log_entity')))
        ->toBe(['entity_type', 'entity_id', 'occurred_at']);

    expect(array_map(fn ($r) => $r->column_name, adminIndexColumns('bookshelf_contacts', 'bookshelf_contacts_by_shelf')))
        ->toBe(['bookshelf_id']);
});

it('carries exactly the expected foreign keys', function () {
    $rows = DB::select("
        select table_name, column_name, referenced_table_name
        from information_schema.key_column_usage
        where table_schema = database()
          and table_name in ('notifications', 'audit_log', 'profile_change_requests', 'system_settings', 'bookshelf_contacts')
          and referenced_table_name is not null
        order by table_name, column_name
    ");

    $actual = collect($rows)
        ->map(fn ($r) => "{$r->table_name}.{$r->column_name}->{$r->referenced_table_name}")
        ->all();

    $expected = [
        'audit_log.actor_id->users',
        'audit_log.bookshelf_id->bookshelves',
        'bookshelf_contacts.bookshelf_id->bookshelves',
        'notifications.bookshelf_id->bookshelves',
        'notifications.user_id->users',
        'profile_change_requests.bookshelf_id->bookshelves',
        'profile_change_requests.decided_by->users',
        'profile_change_requests.user_id->users',
        'system_settings.changed_by->users',
    ];
    sort($expected);

    expect($actual)->toBe($expected);
});

it('collates every enum-backed and uuid column ascii_bin', function () {
    $rows = DB::select("
        select table_name, column_name, collation_name
        from information_schema.columns
        where table_schema = database()
          and table_name in ('notifications', 'audit_log', 'profile_change_requests', 'system_settings', 'bookshelf_contacts')
    ");

    $expectedAsciiBin = [
        'notifications' => ['id', 'bookshelf_id', 'user_id'],
        'audit_log' => ['bookshelf_id', 'actor_id', 'entity_id'],
        'profile_change_requests' => ['id', 'user_id', 'bookshelf_id', 'status', 'decided_by', 'pending_user_id'],
        'system_settings' => ['changed_by'],
        'bookshelf_contacts' => ['id', 'bookshelf_id'],
    ];

    foreach ($rows as $row) {
        if (in_array($row->column_name, $expectedAsciiBin[$row->table_name], true)) {
            expect($row->collation_name)
                ->toBe('ascii_bin', "{$row->table_name}.{$row->column_name} should be ascii_bin, got ".($row->collation_name ?? 'NULL'));
        }
    }
});
