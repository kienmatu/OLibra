<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

// ── fixture builders ─────────────────────────────────────────────────────

function dbgShelf(array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('bookshelves')->insert(array_merge([
        'id' => $id, 'slug' => 'shelf-'.substr($id, -12), 'name' => 'Tủ sách Đồng Tháp', 'settings' => '{}',
    ], $extra));

    return $id;
}

function dbgUser(array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('users')->insert(array_merge([
        'id' => $id, 'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ], $extra));

    return $id;
}

function dbgBook(string $shelf, array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('books')->insert(array_merge([
        'id' => $id, 'bookshelf_id' => $shelf,
        'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'slug-'.substr($id, -12),
    ], $extra));

    return $id;
}

function dbgCopy(string $shelf, string $book, array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('book_copies')->insert(array_merge([
        'id' => $id, 'bookshelf_id' => $shelf, 'book_id' => $book, 'code' => 'DT-'.substr($id, -6),
    ], $extra));

    return $id;
}

function dbgMembership(string $shelf, string $user, array $extra = []): string
{
    $id = (string) Str::uuid7();
    DB::table('memberships')->insert(array_merge([
        'id' => $id, 'bookshelf_id' => $shelf, 'user_id' => $user,
    ], $extra));

    return $id;
}

/**
 * Runs $fn expecting SQLSTATE 23000 (integrity violation), pinned to a
 * specific errno/constraint pair. $errno distinguishes the three flavours a
 * single table can raise on one insert — 4025 CHECK, 1062 duplicate key,
 * 1452 FK — and $name pins which constraint of that flavour fired, checked
 * against the driver message: "for key '<name>'" for a duplicate key,
 * "CONSTRAINT `<name>`" for a CHECK or FK. Without the name, a probe that
 * crafts data meant to trip one constraint could pass by tripping a
 * different constraint of the same errno on the same table instead — the
 * defect Task 11 found and fixed.
 */
function dbgExpectViolation(Closure $fn, int $errno, string $name): void
{
    try {
        $fn();
        test()->fail("expected errno {$errno} naming `{$name}`, the write succeeded");
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('23000')
            ->and($e->errorInfo[1])->toBe($errno);

        $needle = $errno === 1062 ? "for key '{$name}'" : "CONSTRAINT `{$name}`";
        expect($e->errorInfo[2])->toContain($needle);
    }
}

// ── the ten generated-column uniques ─────────────────────────────────────

it('users_username_key: blocks a live duplicate username case-insensitively, frees it on soft delete', function () {
    dbgUser(['username' => 'lan', 'password_hash' => 'x']);
    dbgUser(['username' => 'lan', 'password_hash' => 'x', 'deleted_at' => now()]);   // never blocks

    dbgExpectViolation(fn () => dbgUser(['username' => 'LAN', 'password_hash' => 'x']), 1062, 'users_username_key');
});

it('bookshelves_slug_unique: one live shelf per slug, a soft-deleted one frees it', function () {
    dbgShelf(['slug' => 'dong-thap', 'deleted_at' => now()]);
    dbgShelf(['slug' => 'dong-thap']);

    dbgExpectViolation(fn () => dbgShelf(['slug' => 'dong-thap']), 1062, 'bookshelves_slug_unique');
});

it('parish_units_name_unique_in_scope: null parent is not a wildcard', function () {
    $shelf = dbgShelf();
    $unit = fn (array $extra = []) => DB::table('parish_units')->insert(array_merge([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'level' => 1, 'name' => 'Giới trẻ',
    ], $extra));

    $unit(['deleted_at' => now()]);            // soft-deleted: frees the name
    $unit();                                   // live level-1, null parent

    // The IFNULL('') in the key is what catches this: without it two null
    // parents would be "distinct" and duplicate level-1 names would pass —
    // the exact Postgres NULLS NOT DISTINCT bug class 20260808_03 records.
    dbgExpectViolation(fn () => $unit(), 1062, 'parish_units_name_unique_in_scope');

    // Binary keys: 'Giới trẻ' and 'Gioi tre' are different names — the insert
    // above did not throw, proving the SHA2 key told them apart. A plain
    // `where('name', ...)` cannot re-confirm that here: parish_units.name
    // keeps the table's default utf8mb4_unicode_ci, which folds accents for
    // display and sorting, so it reads 'Giới trẻ' and 'Gioi tre' as equal —
    // that folding is exactly what the binary key exists to see past.
    // COLLATE utf8mb4_bin recovers a byte-exact comparison for the check.
    $unit(['name' => 'Gioi tre']);
    expect(DB::table('parish_units')->whereRaw('name = ? COLLATE utf8mb4_bin', ['Gioi tre'])->count())->toBe(1);
});

it('memberships_one_per_shelf: one live membership per person per shelf', function () {
    $shelf = dbgShelf();
    $user = dbgUser();

    dbgMembership($shelf, $user, ['deleted_at' => now(), 'status' => 'left']);   // re-joining is allowed
    dbgMembership($shelf, $user);

    dbgExpectViolation(fn () => dbgMembership($shelf, $user), 1062, 'memberships_one_per_shelf');
});

it('books_bookshelf_id_slug_key: per shelf, alive rows only', function () {
    $a = dbgShelf();
    $b = dbgShelf();

    dbgBook($a, ['slug' => 'de-men', 'deleted_at' => now()]);
    dbgBook($a, ['slug' => 'de-men']);
    dbgBook($b, ['slug' => 'de-men']);   // other shelf: fine

    dbgExpectViolation(fn () => dbgBook($a, ['slug' => 'de-men']), 1062, 'books_bookshelf_id_slug_key');
});

it('book_copies_code_unique: per shelf, alive rows only', function () {
    $a = dbgShelf();
    $b = dbgShelf();
    $bookA = dbgBook($a);
    $bookB = dbgBook($b);

    dbgCopy($a, $bookA, ['code' => 'DT-0142', 'deleted_at' => now()]);
    dbgCopy($a, $bookA, ['code' => 'DT-0142']);
    dbgCopy($b, $bookB, ['code' => 'DT-0142']);   // other shelf: fine

    dbgExpectViolation(fn () => dbgCopy($a, $bookA, ['code' => 'DT-0142']), 1062, 'book_copies_code_unique');
});

it('loans_one_active_per_copy: the INV-1 race loses cleanly', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $book = dbgBook($shelf);
    $copy = dbgCopy($shelf, $book);

    $loan = fn (string $status, array $extra = []) => DB::table('loans')->insert(array_merge([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'copy_id' => $copy,
        'book_id' => $book, 'borrower_id' => $user, 'lent_by' => $user,
        'due_on' => '2026-09-09', 'status' => $status,
    ], $extra));

    $loan('returned', ['returned_at' => now(), 'return_condition' => 'perfect']);
    $loan('active');

    dbgExpectViolation(fn () => $loan('active'), 1062, 'loans_one_active_per_copy');
});

it('profile_change_requests_one_pending: one pending request per person', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $request = fn (string $status, array $extra = []) => DB::table('profile_change_requests')->insert(array_merge([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{"phone":"0900000001"}', 'previous_values' => '{"phone":null}',
        'status' => $status,
    ], $extra));

    // The reason satisfies rejected_has_reason (its own probe is below) so
    // this test provokes only its own invariant.
    $request('rejected', ['rejection_reason' => 'Sai số điện thoại']);
    $request('pending');

    dbgExpectViolation(fn () => $request('pending'), 1062, 'profile_change_requests_one_pending');
});

it('announcements_bookshelf_id_slug_key: per shelf, alive rows only', function () {
    $shelf = dbgShelf();
    $post = fn (?string $deletedAt = null) => DB::table('announcements')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'title' => 'Thông báo', 'slug' => 'thong-bao',
        'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung', 'deleted_at' => $deletedAt,
    ]);

    $post(now());
    $post();

    dbgExpectViolation(fn () => $post(), 1062, 'announcements_bookshelf_id_slug_key');
});

it('bookshelf_contacts_position: one live contact per position, retired ones free it', function () {
    $shelf = dbgShelf();
    $contact = fn (int $position, ?string $deletedAt = null) => DB::table('bookshelf_contacts')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'position' => $position,
        'name' => 'Giuse Trần Minh', 'deleted_at' => $deletedAt,
    ]);

    $contact(1, now());
    $contact(1);
    $contact(2);

    dbgExpectViolation(fn () => $contact(1), 1062, 'bookshelf_contacts_position');
});

// ── the CHECK constraints ────────────────────────────────────────────────
// MariaDB reports a failed CHECK as SQLSTATE 23000, errno 4025.

it('users_credentials_paired: never a username without a password, or the reverse', function () {
    dbgExpectViolation(fn () => dbgUser(['username' => 'lan', 'password_hash' => null]), 4025, 'users_credentials_paired');
    dbgExpectViolation(fn () => dbgUser(['username' => null, 'password_hash' => 'x']), 4025, 'users_credentials_paired');
    dbgUser(['username' => null, 'password_hash' => null]);   // a child who never signs in
});

it('parish_units_l1_has_no_parent, and level is 1 or 2', function () {
    $shelf = dbgShelf();
    $parent = (string) Str::uuid7();
    DB::table('parish_units')->insert([
        'id' => $parent, 'bookshelf_id' => $shelf, 'level' => 1, 'name' => 'Giới trẻ',
    ]);

    dbgExpectViolation(fn () => DB::table('parish_units')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'level' => 1, 'parent_id' => $parent, 'name' => 'Tổ 1',
    ]), 4025, 'parish_units_l1_has_no_parent');

    dbgExpectViolation(fn () => DB::table('parish_units')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'level' => 3, 'name' => 'Tổ 9',
    ]), 4025, 'parish_units_level_check');
});

it('memberships_rejected_has_reason', function () {
    $shelf = dbgShelf();
    $user = dbgUser();

    dbgExpectViolation(
        fn () => dbgMembership($shelf, $user, ['status' => 'rejected', 'rejection_reason' => null]),
        4025,
        'memberships_rejected_has_reason',
    );
});

it('book_copies_retired_has_reason', function () {
    $shelf = dbgShelf();
    $book = dbgBook($shelf);

    dbgExpectViolation(
        fn () => dbgCopy($shelf, $book, ['state' => 'retired', 'retired_reason' => null]),
        4025,
        'book_copies_retired_has_reason',
    );
});

it('loans_voided_has_reason and loans_returned_has_condition', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $book = dbgBook($shelf);
    $copy = dbgCopy($shelf, $book);

    $loan = fn (array $extra) => DB::table('loans')->insert(array_merge([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'copy_id' => $copy,
        'book_id' => $book, 'borrower_id' => $user, 'lent_by' => $user, 'due_on' => '2026-09-09',
    ], $extra));

    dbgExpectViolation(fn () => $loan(['status' => 'voided', 'void_reason' => null]), 4025, 'loans_voided_has_reason');
    dbgExpectViolation(fn () => $loan(['status' => 'returned', 'return_condition' => null]), 4025, 'loans_returned_has_condition');
});

it('book_donations_declined_has_reason', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $membership = dbgMembership($shelf, $user);

    dbgExpectViolation(fn () => DB::table('book_donations')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'donor_membership_id' => $membership, 'description' => 'Một thùng sách thiếu nhi',
        'status' => 'declined', 'decision_note' => null,
    ]), 4025, 'book_donations_declined_has_reason');
});

it('profile_change_requests_rejected_has_reason', function () {
    $shelf = dbgShelf();
    $user = dbgUser();

    dbgExpectViolation(fn () => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{}', 'previous_values' => '{}',
        'status' => 'rejected', 'rejection_reason' => null,
    ]), 4025, 'profile_change_requests_rejected_has_reason');
});

it('bookshelf_contacts_position_check: positions beyond 3 are unrepresentable', function () {
    $shelf = dbgShelf();

    dbgExpectViolation(fn () => DB::table('bookshelf_contacts')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'position' => 4, 'name' => 'Ai đó',
    ]), 4025, 'bookshelf_contacts_position_check');
});

it('enum checks: a label outside the set is refused on every enum column', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $book = dbgBook($shelf);

    dbgExpectViolation(fn () => dbgShelf(['status' => 'closed']), 4025, 'bookshelves_status_check');
    dbgExpectViolation(fn () => dbgMembership($shelf, $user, ['role' => 'owner']), 4025, 'memberships_role_check');
    dbgExpectViolation(fn () => dbgMembership($shelf, $user, ['status' => 'banned']), 4025, 'memberships_status_check');
    dbgExpectViolation(fn () => dbgCopy($shelf, $book, ['state' => 'missing']), 4025, 'book_copies_state_check');
    dbgExpectViolation(fn () => dbgCopy($shelf, $book, ['condition' => 'destroyed']), 4025, 'book_copies_condition_check');
});

// The brief's own five enum probes above cover bookshelves, membership role
// and status, and book_copies state and condition. Six more enum-backed
// columns carry the same shape of CHECK across the circulation and
// community tables (Tasks 8–13, 16); this probe is the census closing that
// gap rather than leaving it implicit in the per-table schema tests.
it('enum checks: the remaining enum-backed status and condition columns', function () {
    $shelf = dbgShelf();
    $user = dbgUser();
    $book = dbgBook($shelf);
    $copy = dbgCopy($shelf, $book);
    $membership = dbgMembership($shelf, $user);

    dbgExpectViolation(fn () => DB::table('condition_assessments')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'copy_id' => $copy,
        'assessed_by' => $user, 'condition' => 'shredded',
    ]), 4025, 'condition_assessments_condition_check');

    dbgExpectViolation(fn () => DB::table('comments')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $book,
        'author_id' => $user, 'body' => 'Hay quá', 'status' => 'flagged',
    ]), 4025, 'comments_status_check');

    dbgExpectViolation(fn () => DB::table('book_donations')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf,
        'donor_membership_id' => $membership, 'description' => 'Một thùng sách thiếu nhi',
        'status' => 'lost',
    ]), 4025, 'book_donations_status_check');

    dbgExpectViolation(fn () => DB::table('borrow_requests')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'book_id' => $book,
        'member_id' => $user, 'status' => 'stalled',
    ]), 4025, 'borrow_requests_status_check');

    dbgExpectViolation(fn () => DB::table('feedback')->insert([
        'id' => (string) Str::uuid7(), 'subject' => 'Góp ý', 'body' => 'Nội dung', 'status' => 'ignored',
    ]), 4025, 'feedback_status_check');

    dbgExpectViolation(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'copy_id' => $copy,
        'book_id' => $book, 'borrower_id' => $user, 'lent_by' => $user,
        'due_on' => '2026-09-09', 'status' => 'overdue',
    ]), 4025, 'loans_status_check');

    dbgExpectViolation(fn () => DB::table('loans')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'copy_id' => $copy,
        'book_id' => $book, 'borrower_id' => $user, 'lent_by' => $user, 'due_on' => '2026-09-09',
        'status' => 'returned', 'return_condition' => 'shredded',
    ]), 4025, 'loans_return_condition_check');

    dbgExpectViolation(fn () => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => '{}', 'previous_values' => '{}', 'status' => 'ghosted',
    ]), 4025, 'profile_change_requests_status_check');
});

it('enum checks are case-exact — the columns are ascii_bin, so ACTIVE is not active', function () {
    // Under the table default utf8mb4_unicode_ci, 'ACTIVE' PASSES the CHECK
    // (verified on 10.11.19) and then LoanStatus::from('ACTIVE') throws a
    // ValueError in every read path. The Postgres enum refused it; the
    // ascii_bin collation on these columns is what makes the CHECK refuse
    // it too.
    dbgExpectViolation(fn () => dbgShelf(['status' => 'ACTIVE']), 4025, 'bookshelves_status_check');
    $shelf = dbgShelf();
    $user = dbgUser();
    dbgExpectViolation(fn () => dbgMembership($shelf, $user, ['role' => 'Reader']), 4025, 'memberships_role_check');
});

it('settings must be valid json', function () {
    dbgExpectViolation(fn () => dbgShelf(['settings' => 'not json']), 4025, 'bookshelves.settings');
});

// Every table's json() column compiles to LONGTEXT plus an auto-named
// json_valid() CHECK on MariaDB (spec §9's "2 KB expression" case, minus the
// expression: the guarantee here is that the column refuses non-JSON at
// all). bookshelves.settings is proved above; these are the rest of the
// twenty tables' json columns.
it('json_valid checks: every remaining json-backed column refuses malformed json', function () {
    $shelf = dbgShelf();
    $user = dbgUser();

    dbgExpectViolation(fn () => DB::table('notifications')->insert([
        'id' => (string) Str::uuid7(), 'bookshelf_id' => $shelf, 'user_id' => $user,
        'kind' => 'loan_due_soon', 'payload' => '{not valid json',
    ]), 4025, 'notifications.payload');

    dbgExpectViolation(fn () => DB::table('audit_log')->insert([
        'action' => 'system.sweep', 'entity_type' => 'loan', 'context' => 'not json at all',
    ]), 4025, 'audit_log.context');

    dbgExpectViolation(fn () => DB::table('profile_change_requests')->insert([
        'id' => (string) Str::uuid7(), 'user_id' => $user, 'bookshelf_id' => $shelf,
        'proposed_values' => 'not json', 'previous_values' => '{}', 'status' => 'pending',
    ]), 4025, 'profile_change_requests.proposed_values');
});

// The remaining invariants have their probes in sibling files, all part of
// this suite in the spec's sense:
//   - the 15 composite tenant FKs → tests/Feature/Schema/CompositeTenantFkTest.php
//   - loans undeletable, audit append-only, slug/feedback immutability
//     → tests/Feature/Schema/ImmutabilityTriggerTest.php
//   - the single-row system_settings pk → tests/Feature/Schema/AdminSchemaTest.php
