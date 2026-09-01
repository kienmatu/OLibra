<?php

use App\Actions\Community\SubmitFeedback;
use App\Http\Requests\Community\SubmitFeedbackRequest;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Feedback;
use App\Models\Membership;
use App\Models\User;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * THE SHELF'S Góp ý, over HTTP: the form at `shelves.feedback` and the
 * POST beside it. Phase 3c-ii Task 2.
 *
 * WHAT IS COVERED ELSEWHERE AND IS NOT REPEATED HERE. Task 1's
 * tests/Feature/Community/SubmitFeedbackTest.php owns the command — the
 * typed name written beside member_id, the five spellings of one number
 * folding into one bucket, the rolling 24-hour window, the invalid phone,
 * the site-wide row. This file owns what a REQUEST to these two addresses
 * does: who may reach them, which shelf the row lands on, and where in
 * the response a refusal appears.
 *
 * THE ROUTE IS GUEST-REACHABLE, which is the fact most of these blocks
 * exist for, and it is protected by an EXEMPTION rather than a pin:
 * RouteOrderTest:117 removes `feedback` from the reader-area role-gate
 * sweep, so adding `role:reader` to either line in routes/web.php cannot
 * redden THAT file. It reddens this one. MEASURED for this task, by
 * wrapping both route lines in `Route::middleware(['auth', 'role:reader'])`
 * and running the whole suite: 8 failed, 1930 passed, RouteOrderTest green
 * — five of the eight are the blocks below, and the other three are
 * SubmitFeedbackTest's rate-limit block, ShellTest's "serves feedback to a
 * guest" and MyNotificationsTest's non-member bell block. routes/web.php
 * carries the same measurement beside the two lines. So the guest blocks
 * here assert the page and the row rather than a status alone.
 *
 * Grep first: `grep -rn "^function rfsFix" tests/` — top-level helpers are
 * process-global (AGENTS.md).
 *
 * KNOWN BLIND SPOT, inherited from ReaderDonationsTest and re-stated
 * because it bounds every block here: this repository has no frontend test
 * runner, and assertInertia reads SERVER-SIDE props only. That the name
 * field is marked *Bắt buộc*, that the subject is not, and that the limit
 * sentence renders the dailyLimit prop are pinned by nothing here and were
 * checked by READING resources/js/pages/shelves/feedback.tsx.
 *
 * The fixture does NOT actingAs — SessionGuard caches the first user it
 * resolves for the rest of the process, so each block chooses for itself
 * (docs/known-gaps.md carries the reproduction).
 *
 * @return array{Bookshelf, User}
 */
function rfsFix(string $slug = 'dong-thap-rfs'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    // Deliberately named the way spec D1's incident named its user: if a
    // version of this screen ever lets the ACCOUNT stand in for the typed
    // name, the row below reproduces that display exactly.
    $reader = User::factory()->create(['full_name' => 'Quản Trị Viên']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    return [$shelf, $reader];
}

it('opens the form for a guest, with the limit the command enforces', function () {
    [$shelf] = rfsFix('dong-thap-rfs-guest-form');

    $response = test()->get("/shelves/{$shelf->slug}/feedback");

    // THE COMPONENT, not just the status. A GET that reached the
    // under-construction placeholder this route rendered until now answers
    // 200 too, and the placeholder is precisely what this task replaced.
    $response->assertOk()->assertInertia(
        fn (AssertableInertia $page) => $page->component('shelves/feedback')
            // The number the form promises comes from the constant the
            // command counts against, so a copy edit cannot make the page
            // lie about the rule.
            ->where('dailyLimit', SubmitFeedback::DAILY_LIMIT)
    );
});

it('a signed-in reader\'s message carries the shelf AND their account', function () {
    [$shelf, $reader] = rfsFix('dong-thap-rfs-reader');

    $response = test()->actingAs($reader)
        ->from("/shelves/{$shelf->slug}/feedback")
        ->post("/shelves/{$shelf->slug}/feedback", [
            'guest_name' => 'Chị Hạnh',
            'guest_contact' => '0912 345 678',
            'subject' => 'Giờ mở cửa',
            'body' => 'Tủ sách mở lúc mấy giờ ạ?',
        ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/feedback");
    $response->assertSessionHas('success', __('rules.feedback_submitted_flash'));

    $row = Feedback::query()->sole();

    // The two facts spec D1 keeps apart, asserted apart: the name the
    // sender typed, and the account they were signed into. The fixture's
    // user is named "Quản Trị Viên" so a version that let one stand in for
    // the other reproduces the reference's own incident.
    expect($row->guest_name)->toBe('Chị Hạnh')
        ->and($row->guest_name)->not->toBe($reader->full_name)
        ->and($row->member_id)->toBe($reader->id)
        ->and($row->guest_contact)->toBe('0912 345 678')
        ->and($row->subject)->toBe('Giờ mở cửa')
        ->and($row->body)->toBe('Tủ sách mở lúc mấy giờ ạ?')
        // FROM THE URI. Nothing in the body named it.
        ->and($row->bookshelf_id)->toBe($shelf->id);

    // The surface runs under a bound tenant, so it audits with no
    // configuration at all — the audit row's shelf is the request's.
    $audit = AuditLog::query()->where('action', 'feedback.submitted')->sole();
    expect($audit->bookshelf_id)->toBe($shelf->id)
        ->and($audit->actor_id)->toBe($reader->id);
});

it('a guest\'s message carries the shelf and no account at all', function () {
    [$shelf] = rfsFix('dong-thap-rfs-guest-post');

    // NO actingAs, and no membership of any kind. This is the sender the
    // route's exemption from role:reader exists for.
    $response = test()->from("/shelves/{$shelf->slug}/feedback")
        ->post("/shelves/{$shelf->slug}/feedback", [
            'guest_name' => 'Ông Sáu',
            'guest_contact' => '0912345678',
            'body' => 'Xin thêm sách thiếu nhi.',
        ]);

    // NOT a redirect to /login, which is what this route would answer if
    // it ever gained `auth` — and 302 alone cannot tell the two apart, so
    // the destination is the assertion.
    $response->assertRedirect("/shelves/{$shelf->slug}/feedback");

    $row = Feedback::query()->sole();
    expect($row->member_id)->toBeNull()
        ->and($row->guest_name)->toBe('Ông Sáu')
        ->and($row->bookshelf_id)->toBe($shelf->id)
        // No subject typed: the column is NOT NULL, so a message with no
        // subject line stores the empty string.
        ->and($row->subject)->toBe('');

    // AuditRecorder's actor is null for a guest, which AuditSentences
    // already renders as "Hệ thống đã…".
    expect(AuditLog::query()->where('action', 'feedback.submitted')->sole()->actor_id)->toBeNull();
});

it('the request body cannot name a shelf', function () {
    // THE BLOCK THE TASK'S FALSIFICATION TARGETS. Spec D1's shelf comes
    // from the route and never from the body, and the reference's own page
    // says why in one line: "The shelf is not named in the form."
    //
    // TWO SHELVES, and the message is posted to A's address while the body
    // shouts B's identity in every spelling a naive implementation might
    // read — the column name, the route parameter's name, the reference's
    // own Vietnamese field name, the id and the slug. A single-shelf
    // fixture could not fail: the right answer and the wrong answer would
    // be the same row.
    [$shelfA] = rfsFix('dong-thap-rfs-here');
    app(TenantContext::class)->actSystemWide();
    $shelfB = Bookshelf::factory()->create(['slug' => 'dong-thap-rfs-elsewhere', 'settings' => []]);

    test()->from("/shelves/{$shelfA->slug}/feedback")
        ->post("/shelves/{$shelfA->slug}/feedback", [
            'guest_name' => 'Ông Sáu',
            'guest_contact' => '0912345678',
            'body' => 'Góp ý gửi tủ sách Đồng Tháp.',
            'bookshelf_id' => $shelfB->id,
            'shelf' => $shelfB->slug,
            'tu-sach' => $shelfB->slug,
            'siteWide' => true,
            'site_wide' => true,
        ]);

    $row = Feedback::query()->sole();

    // The shelf in the URI, not the one in the body — and not null, which
    // is where `siteWide` in the body would have sent it: straight into
    // the administrator's site-wide inbox, out of the parish's sight.
    expect($row->bookshelf_id)->toBe($shelfA->id);
    expect($row->bookshelf_id)->not->toBe($shelfB->id);

    // The audit row follows the same shelf, so the message and its record
    // cannot end up in two different inboxes.
    expect(AuditLog::query()->where('action', 'feedback.submitted')->sole()->bookshelf_id)
        ->toBe($shelfA->id);

    // AND FROM THE OTHER SIDE, because the assertions above pass for a
    // controller that reads a shelf key the validator happens to drop:
    // the Form Request's own ruleset is the whole of what a body can say,
    // and no key in it names a shelf. A future field added here has to
    // pass this list, not merely fail to be read today.
    expect(array_keys((new SubmitFeedbackRequest)->rules()))
        ->toBe(['guest_name', 'guest_contact', 'subject', 'body']);
});

it('a missing name is a field error, not the rule banner', function () {
    // The floor and the form ask the same question in two places, and this
    // is the one a sender meets: SubmitFeedbackRequest's `required` puts
    // the error beside the field, while SubmitFeedback's own
    // `feedback_fields_required` (pinned by Task 1's file, on the direct
    // call) is the floor under a caller who never went through a form.
    [$shelf] = rfsFix('dong-thap-rfs-blank');

    $response = test()->from("/shelves/{$shelf->slug}/feedback")
        ->post("/shelves/{$shelf->slug}/feedback", [
            'guest_name' => '   ',
            'guest_contact' => '0912345678',
            'body' => 'Góp ý',
        ]);

    $response->assertSessionHasErrors(['guest_name']);
    $response->assertSessionDoesntHaveErrors(['rule']);

    expect(Feedback::query()->count())->toBe(0);
});

it('a phone that is not a phone comes back as the rule banner', function () {
    // The other half of the pair above, and the reason the Form Request
    // does NOT carry a regex: the number's shape is Phone::assert()'s
    // ruling inside the command, so an HTTP caller and a direct caller
    // meet the same sentence rather than two spellings of one rule.
    [$shelf] = rfsFix('dong-thap-rfs-phone');

    $response = test()->from("/shelves/{$shelf->slug}/feedback")
        ->post("/shelves/{$shelf->slug}/feedback", [
            'guest_name' => 'Ông Sáu',
            'guest_contact' => 'khong-phai-so',
            'body' => 'Góp ý',
        ]);

    $response->assertRedirect("/shelves/{$shelf->slug}/feedback");
    $response->assertSessionHasErrors(['rule' => __('rules.phone_invalid')]);
    expect(__('rules.phone_invalid'))->not->toBe('rules.phone_invalid');

    expect(Feedback::query()->count())->toBe(0);
});
