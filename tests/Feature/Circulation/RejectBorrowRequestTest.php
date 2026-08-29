<?php

use App\Actions\Circulation\RejectBorrowRequest;
use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\AuditLogQuery;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/** @return array{Bookshelf, User, User, BorrowRequest} */
function rjbFix(string $slug = 'dong-thap-rjb'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $mm = Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $reader = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    Membership::factory()->for($shelf)->create(['user_id' => $reader->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Totto-chan Bên Cửa Sổ', 'slug' => 'totto-chan']);
    $request = BorrowRequest::query()->create([
        'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'member_id' => $reader->id,
        'status' => RequestStatus::Pending, 'requested_at' => now(),
    ]);
    app(TenantContext::class)->set($shelf, $mm);
    test()->actingAs($manager);

    return [$shelf, $manager, $reader, $request];
}

it('rejecting is terminal, keeps the row, and records the reason', function () {
    [, $manager, $reader, $request] = rjbFix();

    app(RejectBorrowRequest::class)->execute($manager, $request, 'sách đang được kiểm kê');

    $row = $request->fresh();
    expect($row->status)->toBe(RequestStatus::Rejected)
        ->and($row->decided_by)->toBe($manager->id)
        ->and($row->decision_note)->toBe('sách đang được kiểm kê')
        ->and($row->deleted_at)->toBeNull();     // nothing is deleted — BR §11

    $note = Notification::query()->firstOrFail();
    expect($note->user_id)->toBe($reader->id)
        ->and($note->kind)->toBe('request_rejected')
        ->and($note->payload)->toMatchArray(['title' => 'Totto-chan Bên Cửa Sổ', 'reason' => 'sách đang được kiểm kê']);
});

it('the reason is optional, and an empty one is stored as no reason', function () {
    // Ruling 2: optional, the reference's shipped reading, its named test
    // kept. This is the behaviour, not a behaviour that survives a switch.
    [, $manager, , $request] = rjbFix('dong-thap-rjb-noreason');

    app(RejectBorrowRequest::class)->execute($manager, $request, '   ');

    expect($request->fresh()->decision_note)->toBeNull();
    // And the notification degrades to a sentence with no because-clause:
    expect(array_key_exists('reason', Notification::query()->firstOrFail()->payload))->toBeFalse();
});

it('a decided request cannot be rejected', function () {
    [, $manager, , $request] = rjbFix('dong-thap-rjb-decided');
    BorrowRequest::query()->whereKey($request->id)->update(['status' => RequestStatus::Cancelled, 'cancelled_at' => now()]);

    expect(fn () => app(RejectBorrowRequest::class)->execute($manager, $request, null))
        ->toThrow(RuleViolated::class, 'request_not_pending');
    expect(Notification::query()->count())->toBe(0);
});

it('the request lock is the transaction\'s first statement', function () {
    [, $manager, , $request] = rjbFix('dong-thap-rjb-lock');

    DB::flushQueryLog();
    DB::enableQueryLog();
    app(RejectBorrowRequest::class)->execute($manager, $request, null);
    $log = DB::getQueryLog();
    DB::disableQueryLog();

    expect(str_contains($log[0]['query'], 'borrow_requests'))->toBeTrue($log[0]['query'])
        ->and(str_contains(strtolower($log[0]['query']), 'for update'))->toBeTrue($log[0]['query']);
});

it('INV-8: request.rejected names the reader and the reason, and the audit screen renders them', function () {
    [$shelf, $manager, $reader, $request] = rjbFix('dong-thap-rjb-audit');

    app(RejectBorrowRequest::class)->execute($manager, $request, 'thiếu thẻ');

    $entry = AuditLog::query()->where('action', 'request.rejected')->firstOrFail();
    $after = (array) $entry->after;
    expect((array) $entry->before)->toMatchArray(['status' => 'pending'])
        // The fixture's actingAs is load-bearing, not scenery: AuditRecorder
        // takes actor_id from Auth::id(), never from the $actor parameter
        // (that one only reaches decided_by, App\Actions\Circulation\
        // RejectBorrowRequest.php:62) — a fixture that signed nobody in
        // would write a null actor_id here, and this assertion is what
        // notices. actor_id is nullable and the join in AuditLogQuery is a
        // LEFT join (a null actor renders "Hệ thống", not a query failure),
        // so nothing else in this test would go red without it.
        ->and($entry->actor_id)->toBe($manager->id)
        ->and($after['status'])->toBe('rejected')
        ->and($after['title'])->toBe('Totto-chan Bên Cửa Sổ')
        ->and($after['userId'])->toBe($reader->id)
        ->and($after['reason'])->toBe('thiếu thẻ');

    // The Task-1 subject join, pinned here: the rendered sentence names
    // the reader from the payload's userId. Drop that join and THIS goes
    // red (the mutation check below performs exactly that).
    $rendered = app(AuditLogQuery::class)->run(page: 1);
    $line = collect($rendered['rows'])->firstWhere('action', 'request.rejected');
    expect($line['sentence'])->toContain('Têrêsa Bạn Đọc Nhỏ')
        ->and($line['sentence'])->toContain('vì thiếu thẻ');
});
