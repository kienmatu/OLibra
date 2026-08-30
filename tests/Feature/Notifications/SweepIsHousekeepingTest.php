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
 * Pass $borrower to put an EXISTING reader on this second shelf instead of
 * making a new one — a person holding memberships on more than one shelf is
 * a recorded design fact (docs/known-gaps.md, "User is deliberately
 * global"), and the sweep's idempotence key has to survive it.
 *
 * @return array{Bookshelf, User, Loan}
 */
function swpFix(string $dueOn, array $settings = [], string $slug = 'dong-thap-swp', ?User $borrower = null): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => $settings]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho '.$slug]);
    Membership::factory()->for($shelf)->create(['user_id' => $manager->id, 'role' => 'manager', 'status' => 'active']);
    $borrower ??= User::factory()->create(['full_name' => 'Giuse Người Mượn '.$slug]);
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
    // this block pins the due-soon KIND and NOT the timezone. The block
    // that pins the timezone is "the civil date is Asia/Ho_Chi_Minh's…"
    // below, which is the only one whose answer changes with it — measured
    // by swapping Clock::today() for a UTC date and watching that block,
    // and only that block, redden.
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

it('the civil date is Asia/Ho_Chi_Minh\'s, not the server\'s — a book late in HCM is late', function () {
    // THE Clock CONSTRAINT, made falsifiable. 23:00 UTC on the 24th is
    // already the 25th in Asia/Ho_Chi_Minh, so a loan due on the 24th is
    // one day LAPSED here and merely due TODAY (inside the due-soon
    // window) on a UTC reading. This is the only clock position in the
    // file where the two answers differ: swap Clock::today() for a UTC
    // date string and this block flips to loan_due_soon while every other
    // block stays green.
    Carbon::setTestNow(Carbon::parse('2026-08-24 23:00:00', 'UTC'));
    swpFix('2026-08-24', [], 'dong-thap-swp-tz');

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('Sweep complete: 0 due-soon, 1 overdue notification(s).');
    expect(Notification::query()->sole()->kind)->toBe('loan_overdue');
});

it('a voided loan is never swept', function () {
    // The brief asked only for `returned`. A loan that was voided is a
    // lending that never truly happened (INV-11: voided, never deleted),
    // and the status filter is one clause covering all three terminal
    // states — but "covers all three" is a claim, so all three are seeded.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, , $loan] = swpFix('2026-08-20', [], 'dong-thap-swp-void');
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'voided', 'voided_at' => now(),
        'voided_by' => $loan->lent_by, 'void_reason' => 'ghi nhầm bản sao',
    ]);

    Artisan::call('reminders:sweep');

    expect(Notification::query()->count())->toBe(0);
});

it('a book reported lost is never told to be brought back', function () {
    // The sharpest of the three: loan_overdue's Vietnamese asks the reader
    // to "mang sách đến trả giúp nhé", which is the one sentence nobody
    // wants sent nightly about a book already reported lost.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, , $loan] = swpFix('2026-08-20', [], 'dong-thap-swp-lost');
    Loan::query()->whereKey($loan->id)->update([
        'status' => 'lost', 'lost_reported_at' => now(), 'lost_reported_by' => $loan->lent_by,
    ]);

    Artisan::call('reminders:sweep');

    expect(Notification::query()->count())->toBe(0);
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
    // ONE reader, on both shelves, with the same title due the same day —
    // and that is the whole point of the fixture rather than a tidy reuse.
    // The idempotence key is "has this person been told about this title
    // for this date", and it runs with BookshelfScope switched off, so
    // without bookshelf_id in the key the second shelf's loan reads as
    // already-told and this reader is never warned about a book they
    // actually hold. Measured: drop the bookshelf_id clause from the probe
    // and this block reports 1 row where it must report 2.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [, $reader] = swpFix('2026-08-20', [], 'dong-thap-swp-a');
    swpFix('2026-08-20', [], 'can-tho-swp-b', $reader);

    Artisan::call('reminders:sweep');

    expect(Artisan::output())->toContain('0 due-soon, 2 overdue')
        ->and(Notification::query()->count())->toBe(2);
});

it('and each of that one reader\'s two shelves gets its own row', function () {
    // A separate it(): "it wrote two rows" and "the two rows are on
    // different shelves" have to be able to fail independently, and the
    // second is what proves the fix filed them where each bell will find
    // them rather than writing a duplicate on one shelf.
    Carbon::setTestNow(Carbon::parse('2026-08-25 02:00:00', 'UTC'));
    [$a, $reader] = swpFix('2026-08-20', [], 'dong-thap-swp-two-a');
    [$b] = swpFix('2026-08-20', [], 'can-tho-swp-two-b', $reader);

    Artisan::call('reminders:sweep');

    $shelves = Notification::query()->where('user_id', $reader->id)
        ->get()->map(fn (Notification $n) => $n->bookshelf_id)->sort()->values()->all();

    expect($shelves)->toBe(collect([$a->id, $b->id])->sort()->values()->all());
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
