<?php

use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Queries\ManagerDashboardQuery;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;

afterEach(fn () => Carbon::setTestNow());

/**
 * One shelf, one borrower, one active loan due on $dueOn.
 *
 * @return array{Bookshelf, User, Loan}
 */
function swpFix(string $dueOn, array $settings = [], string $slug = 'dong-thap-swp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $settings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho '.$slug]);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower = User::factory()->create(['full_name' => 'Giuse Người Mượn '.$slug]);
    Membership::factory()->for($shelf)->create(['user_id' => $borrower->id, 'role' => 'reader', 'status' => 'active']);
    $book = Book::query()->create(['bookshelf_id' => $shelf->id, 'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-'.$slug]);
    $copy = BookCopy::query()->create(['bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0001', 'state' => 'on_loan']);
    $loan = Loan::query()->create([
        'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
        'borrower_id' => $borrower->id, 'lent_by' => $manager->id,
        'due_on' => $dueOn, 'status' => 'active',
    ]);

    return [$shelf, $borrower, $loan];
}

it('the badge is right before the sweep has ever run — the whole exception, bounded', function () {
    // 2026-08-20 was the due date; "today" is the 25th. NO sweep runs.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [$shelf, $borrower] = swpFix('2026-08-20');
    $manager = Membership::query()->where('role', 'manager')->firstOrFail();
    app(TenantContext::class)->set($shelf, $manager);

    $counts = app(ManagerDashboardQuery::class)->run()['counts'];

    expect($counts['overdue'])->toBe(1)                       // computed live, BR §8
        ->and(Notification::query()->count())->toBe(0);       // only late to be TOLD
});

it('the sweep tells the borrower a book is overdue, and prints its evidence line', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, $borrower] = swpFix('2026-08-20', [], 'dong-thap-swp-over');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 0 due-soon, 1 overdue notification(s).');
    $note = Notification::query()->sole();
    expect($note->user_id)->toBe($borrower->id)
        ->and($note->kind)->toBe('loan_overdue')
        ->and($note->payload)->toMatchArray(['title' => 'Dế Mèn Phiêu Lưu Ký', 'due_on' => '2026-08-20']);
});

it('running the sweep twice does not tell a child twice', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    swpFix('2026-08-20', [], 'dong-thap-swp-idem');

    Artisan::call('reminders:sweep');
    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 0 due-soon, 0 overdue notification(s).');
    expect(Notification::query()->count())->toBe(1);
});

it('a book due in two days is due-soon, not overdue — and the window is in HCM days', function () {
    // 23:00 UTC on the 24th is already the 25th in Asia/Ho_Chi_Minh;
    // due 2026-08-27 is two HCM days out — inside the default 3-day
    // window. A UTC "today" would compute three days and still pass, so
    // the pin is the due-soon KIND plus the boundary test below.
    Carbon::setTestNow(Carbon::parse('2026-08-24 23:00:00', 'UTC'));
    swpFix('2026-08-27', [], 'dong-thap-swp-soon');

    Artisan::call('reminders:sweep');

    expect(Notification::query()->sole()->kind)->toBe('loan_due_soon');
});

it('a shelf\'s own due_soon_days sets its window, not the global default', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    // Due in 5 HCM days: outside the default 3, inside this shelf's 7.
    swpFix('2026-08-30', ['due_soon_days' => 7], 'dong-thap-swp-window');
    // And a second shelf at the default, same due date: NOT swept.
    swpFix('2026-08-30', [], 'dong-thap-swp-window-b');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 1 due-soon, 0 overdue notification(s).');
    expect(Notification::query()->sole()->bookshelf_id)
        ->toBe(Bookshelf::withoutGlobalScopes()->where('slug', 'dong-thap-swp-window')->sole()->id);
});

it('a book warned as due-soon is still told when it goes overdue', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, $borrower] = swpFix('2026-08-26', [], 'dong-thap-swp-both');
    Artisan::call('reminders:sweep');   // due-soon written

    Carbon::setTestNow(Carbon::parse('2026-08-29 02:00:00', 'UTC'));
    Artisan::call('reminders:sweep');   // now overdue — a DIFFERENT thing to say

    expect(Notification::query()->where('user_id', $borrower->id)->pluck('kind')->sort()->values()->all())
        ->toBe(['loan_due_soon', 'loan_overdue']);
});

it('a returned book is never swept', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, , $loan] = swpFix('2026-08-20', [], 'dong-thap-swp-ret');
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'returned', 'returned_at' => now(),
        'received_by' => $loan->lent_by, 'return_condition' => 'perfect',
    ]);

    Artisan::call('reminders:sweep');

    expect(Notification::query()->count())->toBe(0);
});

it('the sweep crosses shelves, because a nightly job serves every parish', function () {
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    swpFix('2026-08-20', [], 'dong-thap-swp-a');
    swpFix('2026-08-20', [], 'can-tho-swp-b');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('0 due-soon, 2 overdue')
        ->and(Notification::query()->count())->toBe(2);
});

it('every row it writes lands on its own loan\'s shelf', function () {
    // A separate it() from the crossing test above, not an extra ->and()
    // on it: a failed expect() aborts the whole method, and "it swept both
    // parishes" and "it filed each row under the right parish" are two
    // facts that must be able to fail independently.
    //
    // This is the half actSystemWide() puts at risk. Under it BookshelfScope
    // no-ops, so nothing in the model layer would notice a row filed under
    // the wrong shelf — the only thing keeping a reader's notification out
    // of another parish is the bookshelf_id this command copies off the
    // loan. Pairing shelf with borrower is what makes the assertion
    // falsifiable: a command that stamped every row with one shelf's id, or
    // told the wrong borrower, fails here while the count still reads 2.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    swpFix('2026-08-20', [], 'dong-thap-swp-scope-a');
    swpFix('2026-08-20', [], 'can-tho-swp-scope-b');

    Artisan::call('reminders:sweep');

    $written = Notification::query()->get()
        ->map(fn (Notification $n) => $n->bookshelf_id.' / '.$n->user_id)->sort()->values()->all();
    $lent = Loan::query()->get()
        ->map(fn (Loan $l) => $l->bookshelf_id.' / '.$l->borrower_id)->sort()->values()->all();

    expect($written)->toHaveCount(2)->toBe($lent);
});

it('the 07:00 Asia/Ho_Chi_Minh schedule line exists — Phase 0\'s reservation discharged', function () {
    $schedule = app(Schedule::class);
    $event = collect($schedule->events())
        ->first(fn ($e) => str_contains((string) $e->command, 'reminders:sweep'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('0 7 * * *')
        ->and($event->timezone)->toBe('Asia/Ho_Chi_Minh');
});
