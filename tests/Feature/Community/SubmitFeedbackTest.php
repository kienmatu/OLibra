<?php

use App\Actions\Community\SubmitFeedback;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Feedback;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Route;

/**
 * Shelf + one active reader, bound as the tenant — the shelf Góp ý route's
 * situation, which is the one Task 1 can exercise (Tasks 2 and 3 add the two
 * routes themselves).
 *
 * Grep first: `grep -rn "^function sfbFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * @return array{Bookshelf, User}
 */
function sfbFix(string $slug = 'dong-thap-sfb'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $reader = User::factory()->create(['full_name' => 'Quản Trị Viên']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);
    app(TenantContext::class)->set($shelf, $membership);

    return [$shelf, $reader];
}

it('writes the name the sender typed AND the account they were signed into', function () {
    [$shelf, $reader] = sfbFix();
    test()->actingAs($reader);

    $result = app(SubmitFeedback::class)->execute(
        $reader, 'Chị Hạnh', '0912 345 678', 'Giờ mở cửa', 'Tủ sách mở lúc mấy giờ ạ?',
    );

    $row = Feedback::query()->sole();

    // THE INCIDENT THIS PINS, from the reference's own record: the guest
    // fields and member_id are written TOGETHER, never as alternatives. A
    // signed-in reader who typed "Chị Hạnh" was shown to the administrator
    // as "Quản trị viên" — their account's name — and the administrator rang
    // the wrong person. The fixture's user is deliberately named "Quản Trị
    // Viên" so a version that let the account stand in for the typed name
    // reproduces that exact display.
    expect($result['feedbackId'])->toBe($row->id)
        ->and($row->guest_name)->toBe('Chị Hạnh')
        ->and($row->guest_name)->not->toBe($reader->full_name)
        ->and($row->guest_contact)->toBe('0912 345 678')
        ->and($row->member_id)->toBe($reader->id)
        ->and($row->subject)->toBe('Giờ mở cửa')
        ->and($row->body)->toBe('Tủ sách mở lúc mấy giờ ạ?')
        // The shelf comes from the bound tenant, not from the caller.
        ->and($row->bookshelf_id)->toBe($shelf->id);

    // The contact is stored as TYPED, spaces and all — the administrator
    // has to ring it back. Only the rate-limit key is normalised.
    expect($row->guest_hash)->toBe(hash('sha256', '0912345678'));

    $audit = AuditLog::query()->where('action', 'feedback.submitted')->sole();
    expect($audit->entity_id)->toBe($row->id)
        ->and($audit->bookshelf_id)->toBe($shelf->id)
        ->and($audit->after)->toBe(['site_wide' => false]);
});

it('a guest submission carries the typed fields and no member id', function () {
    [$shelf] = sfbFix();

    app(SubmitFeedback::class)->execute(
        null, 'Ông Sáu', '0912345678', null, 'Xin thêm sách thiếu nhi.',
    );

    $row = Feedback::query()->sole();
    expect($row->member_id)->toBeNull()
        ->and($row->guest_name)->toBe('Ông Sáu')
        ->and($row->bookshelf_id)->toBe($shelf->id)
        // No subject typed: the column is NOT NULL, so the empty string is
        // what a message with no subject line stores.
        ->and($row->subject)->toBe('');
});

it('five spellings of one number are one sender, not five', function () {
    sfbFix();

    // Every one of these is accepted by Phone::isValid(), and every one is
    // the same subscriber number. The reference hashes the
    // whitespace-stripped string, which gives the dotted, hyphenated and
    // +84 spellings buckets of their own — a 12/day budget wearing a 3/day
    // label. Phone::normalise() folds all five into one.
    $spellings = ['0912345678', '0912 345 678', '0912.345.678', '0912-345-678', '+84912345678'];

    foreach (array_slice($spellings, 0, 3) as $i => $spelling) {
        app(SubmitFeedback::class)->execute(null, 'Ông Sáu', $spelling, null, "Góp ý {$i}");
    }

    expect(Feedback::query()->distinct()->pluck('guest_hash'))->toHaveCount(1);

    // The fourth and fifth spellings are the same sender's fourth and fifth
    // messages, so both are refused.
    foreach (array_slice($spellings, 3) as $spelling) {
        expect(fn () => app(SubmitFeedback::class)
            ->execute(null, 'Ông Sáu', $spelling, null, 'Góp ý nữa'))
            ->toThrow(RuleViolated::class);
    }

    expect(Feedback::query()->count())->toBe(3);
});

it('the fourth message in a rolling 24 hours is refused with a sentence, and the window rolls', function () {
    sfbFix();

    // A route of this test's own, because Tasks 2 and 3 are what add the
    // real ones — what it exercises is bootstrap/app.php's single
    // RuleViolated render hook, the one place a code becomes a sentence, so
    // the assertion below is about the response a sender really gets.
    Route::post('/_test/feedback', function () {
        app(SubmitFeedback::class)->execute(
            null, 'Ông Sáu', '0912345678', null, 'Góp ý thứ tư.',
        );

        return redirect('/');
    })->middleware('web');

    CarbonImmutable::setTestNow('2026-09-01 08:00:00');
    for ($i = 0; $i < 3; $i++) {
        app(SubmitFeedback::class)->execute(null, 'Ông Sáu', '0912345678', null, "Góp ý {$i}");
    }

    // Twenty-three hours on: still inside the window, still refused. A
    // calendar-day limiter would have reset at midnight.
    CarbonImmutable::setTestNow('2026-09-02 07:00:00');
    $refused = test()->from('/tu-sach/dong-thap-sfb/gop-y')->post('/_test/feedback');

    // NOT a 429, deliberately: the domain rule answers with the redirect
    // every other refusal in this system uses, carrying the Vietnamese
    // sentence in the error bag where the form reads it.
    $refused->assertRedirect('/tu-sach/dong-thap-sfb/gop-y');
    $refused->assertSessionHasErrors(['rule' => __('rules.rate_limited')]);
    expect(__('rules.rate_limited'))->not->toBe('rules.rate_limited');
    expect(Feedback::query()->count())->toBe(3);

    // Twenty-five hours after the first three, the window has rolled past
    // them and the same number is welcome again.
    CarbonImmutable::setTestNow('2026-09-02 09:00:01');
    test()->from('/tu-sach/dong-thap-sfb/gop-y')->post('/_test/feedback')->assertRedirect('/');
    expect(Feedback::query()->count())->toBe(4);

    CarbonImmutable::setTestNow();
});

it('refuses a phone that is not a phone, and a message missing its fields', function () {
    sfbFix();

    // The reference's QA round found this literal string accepted and
    // stored by this command, on the only form a parish with no shelf has.
    expect(fn () => app(SubmitFeedback::class)
        ->execute(null, 'Ông Sáu', 'khong-phai-so', null, 'Góp ý'))
        ->toThrow(RuleViolated::class, 'phone_invalid');

    // Whitespace is not a name, a number or a message. Each of the three
    // fields is checked, so a version that tested only one of them fails.
    expect(fn () => app(SubmitFeedback::class)->execute(null, '   ', '0912345678', null, 'Góp ý'))
        ->toThrow(RuleViolated::class, 'feedback_fields_required');
    expect(fn () => app(SubmitFeedback::class)->execute(null, 'Ông Sáu', '  ', null, 'Góp ý'))
        ->toThrow(RuleViolated::class, 'feedback_fields_required');
    expect(fn () => app(SubmitFeedback::class)->execute(null, 'Ông Sáu', '0912345678', null, ' '))
        ->toThrow(RuleViolated::class, 'feedback_fields_required');

    expect(Feedback::query()->count())->toBe(0);
});

it('a site-wide message belongs to no shelf, and says so in its audit row', function () {
    sfbFix();

    // The public contact page's situation, minus its route: no shelf at
    // all. TenantContext is cleared so nothing can quietly supply one, and
    // the audit row can only be written because SubmitFeedback names its
    // (absent) shelf to the recorder — with a tenant bound and no such
    // configuration the recorder throws.
    app(TenantContext::class)->clear();

    app(SubmitFeedback::class)->execute(
        null, 'Ông Sáu', '0912345678', 'Xin lập tủ sách', 'Giáo xứ chúng tôi muốn lập tủ sách.',
        siteWide: true,
    );

    $row = Feedback::query()->sole();
    expect($row->bookshelf_id)->toBeNull();

    $audit = AuditLog::query()->where('action', 'feedback.submitted')->sole();
    expect($audit->bookshelf_id)->toBeNull()
        ->and($audit->after)->toBe(['site_wide' => true]);
});

it('refuses a shelf message when no shelf is bound, rather than filing it site-wide', function () {
    sfbFix();
    app(TenantContext::class)->clear();

    expect(fn () => app(SubmitFeedback::class)
        ->execute(null, 'Ông Sáu', '0912345678', null, 'Góp ý'))
        ->toThrow(RuleViolated::class, 'shelf_not_found');

    expect(Feedback::query()->count())->toBe(0);
});
