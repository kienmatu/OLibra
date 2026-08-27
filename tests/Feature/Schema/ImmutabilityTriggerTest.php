<?php

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

function triggerFixture(): array
{
    $shelf = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $shelf, 'slug' => 'shelf-'.substr($shelf, -8), 'name' => 'Tủ sách Đồng Tháp', 'settings' => '{}',
    ]);
    $user = (string) Str::uuid7();
    DB::table('users')->insert([
        'id' => $user, 'saint_name' => 'Phêrô', 'full_name' => 'Nguyễn Văn Bình',
        'father_name' => 'Cha', 'mother_name' => 'Mẹ',
    ]);
    $book = (string) Str::uuid7();
    DB::table('books')->insert([
        'id' => $book, 'bookshelf_id' => $shelf, 'title' => 'Đất Rừng Phương Nam', 'slug' => 'dat-rung',
    ]);
    $copy = (string) Str::uuid7();
    DB::table('book_copies')->insert([
        'id' => $copy, 'bookshelf_id' => $shelf, 'book_id' => $book, 'code' => 'DT-0142',
    ]);

    return compact('shelf', 'user', 'book', 'copy');
}

function expectSignal(Closure $fn): void
{
    try {
        $fn();
        test()->fail('expected SIGNAL SQLSTATE 45000, nothing was thrown');
    } catch (QueryException $e) {
        expect($e->getCode())->toBe('45000');
    }
}

it('refuses to delete a loan — loans are voided, never deleted', function () {
    $fx = triggerFixture();
    $loan = (string) Str::uuid7();
    DB::table('loans')->insert([
        'id' => $loan, 'bookshelf_id' => $fx['shelf'], 'copy_id' => $fx['copy'],
        'book_id' => $fx['book'], 'borrower_id' => $fx['user'], 'lent_by' => $fx['user'],
        'due_on' => '2026-09-09',
    ]);

    expectSignal(fn () => DB::table('loans')->where('id', $loan)->delete());
    expect(DB::table('loans')->count())->toBe(1);

    // The permitted neighbour: voiding is the mechanism, not deletion.
    DB::table('loans')->where('id', $loan)->update([
        'status' => 'voided', 'void_reason' => 'copy withdrawn from circulation',
    ]);
    expect(DB::table('loans')->where('id', $loan)->value('status'))->toBe('voided');
});

it('refuses to update or delete an audit record', function () {
    $fx = triggerFixture();
    DB::table('audit_log')->insert([
        'bookshelf_id' => $fx['shelf'], 'actor_id' => $fx['user'],
        'action' => 'loan.lend', 'entity_type' => 'loan',
        'entity_id' => (string) Str::uuid7(), 'context' => '{}',
    ]);

    expectSignal(fn () => DB::table('audit_log')->where('id', '>', 0)->update(['action' => 'loan.return']));
    expectSignal(fn () => DB::table('audit_log')->where('id', '>', 0)->delete());

    // The permitted neighbour: append-only still permits appending.
    DB::table('audit_log')->insert([
        'bookshelf_id' => $fx['shelf'], 'actor_id' => $fx['user'],
        'action' => 'loan.return', 'entity_type' => 'loan',
        'entity_id' => (string) Str::uuid7(), 'context' => '{}',
    ]);
    expect(DB::table('audit_log')->count())->toBe(2);
});

it('refuses to change a bookshelf slug after creation', function () {
    $fx = triggerFixture();

    expectSignal(fn () => DB::table('bookshelves')->where('id', $fx['shelf'])->update(['slug' => 'renamed']));

    // Other columns still update freely.
    DB::table('bookshelves')->where('id', $fx['shelf'])->update(['name' => 'Tủ sách mới']);
    expect(DB::table('bookshelves')->where('id', $fx['shelf'])->value('name'))->toBe('Tủ sách mới');
});

it('refuses to move feedback between shelves, in either direction', function () {
    $fx = triggerFixture();
    $doorId = (string) Str::uuid7();
    DB::table('feedback')->insert([
        'id' => $doorId, 'bookshelf_id' => null, 'subject' => 'Góp ý', 'body' => 'Nội dung',
    ]);
    $shelfId = (string) Str::uuid7();
    DB::table('feedback')->insert([
        'id' => $shelfId, 'bookshelf_id' => $fx['shelf'], 'subject' => 'Góp ý', 'body' => 'Nội dung',
    ]);

    // Front-door feedback cannot be claimed by a shelf, and shelf feedback
    // cannot be detached or moved — the NULL-safe comparison covers both.
    expectSignal(fn () => DB::table('feedback')->where('id', $doorId)->update(['bookshelf_id' => $fx['shelf']]));
    expectSignal(fn () => DB::table('feedback')->where('id', $shelfId)->update(['bookshelf_id' => null]));

    // Third direction: shelf-to-shelf reassignment via a second shelf.
    $otherShelf = (string) Str::uuid7();
    DB::table('bookshelves')->insert([
        'id' => $otherShelf, 'slug' => 'shelf-'.substr($otherShelf, -8), 'name' => 'Tủ sách khác', 'settings' => '{}',
    ]);
    expectSignal(fn () => DB::table('feedback')->where('id', $shelfId)->update(['bookshelf_id' => $otherShelf]));

    // Status still moves.
    DB::table('feedback')->where('id', $shelfId)->update(['status' => 'read']);
    expect(DB::table('feedback')->where('id', $shelfId)->value('status'))->toBe('read');
});

it('defines exactly the five immutability triggers, over information_schema', function () {
    $rows = DB::select('
        select trigger_name, event_manipulation, event_object_table, action_timing
        from information_schema.triggers
        where trigger_schema = database()
        order by trigger_name
    ');

    $triggers = collect($rows)->mapWithKeys(fn ($r) => [$r->trigger_name => [
        'event' => $r->event_manipulation, 'table' => $r->event_object_table, 'timing' => $r->action_timing,
    ]])->all();

    expect($triggers)->toBe([
        'audit_log_no_delete' => ['event' => 'DELETE', 'table' => 'audit_log', 'timing' => 'BEFORE'],
        'audit_log_no_update' => ['event' => 'UPDATE', 'table' => 'audit_log', 'timing' => 'BEFORE'],
        'bookshelves_slug_immutable' => ['event' => 'UPDATE', 'table' => 'bookshelves', 'timing' => 'BEFORE'],
        'feedback_bookshelf_immutable' => ['event' => 'UPDATE', 'table' => 'feedback', 'timing' => 'BEFORE'],
        'loans_no_delete' => ['event' => 'DELETE', 'table' => 'loans', 'timing' => 'BEFORE'],
    ]);
});
