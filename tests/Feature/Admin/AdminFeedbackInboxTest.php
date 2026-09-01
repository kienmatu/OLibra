<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Feedback;
use App\Models\User;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3c-ii Task 4: `/admin/feedback` — BR §16.1's Góp ý inbox, and the
 * read half of a table that has been writable since Phase 2b's schema with
 * nothing anywhere able to open it.
 *
 * FOUR RULES CARRY THIS FILE, each with a test that reddens when the rule is
 * removed rather than merely passing while it holds:
 *
 * 1. **An unknown `?status=` means NO FILTER, never an empty list.** The
 *    reference names the cost: "an empty inbox that reads as 'no messages' is
 *    the shape of a bug this project has already shipped twice."
 * 2. **`guest_contact` is in the DETAIL and not in the list rows.** Both
 *    arrive in ONE Inertia response, so an assertion phrased as "the response
 *    does not contain that number" is guaranteed wrong — it is in the
 *    response, in the open pane. The test below scopes to the `messages[]`
 *    prop, on a fixture where the selected message's number differs from
 *    every list row's, or it could not fail.
 * 3. **Opening a message does NOT mark it read** (spec D3). Marking is an
 *    explicit act with its own button and its own audit row.
 * 4. **The audit row's shelf comes from the MESSAGE, not the caller** (spec
 *    D6) — `forShelf` when the message names one, `global` when it does not.
 *
 * SPEC §5.13'S OTHER HALF IS STRUCTURALLY UNREACHABLE HERE, and this is where
 * that is recorded rather than left as a test somebody notices is missing.
 * The reference's `auditScopeFor` refuses `not_permitted` when the CALLER's
 * bound shelf disagrees with the message's — a state that needs a caller with
 * a bound shelf. Every route reaching MarkFeedbackRead and ResolveFeedback is
 * in the `/admin` group, which binds no tenant at all, so the disagreement
 * cannot be constructed over HTTP and a check for it would be a branch no
 * test could redden. What that refusal protected is held instead by rule 4
 * above: the shelf is read off the row, so there is no caller-supplied shelf
 * for it to disagree with.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model — load-bearing here because it creates Bookshelf rows.
 *
 * Grep first: `grep -rn "^function adminFeedbackFix" tests/`.
 */
function adminFeedbackFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true, 'full_name' => 'Maria Quản Trị']);
}

/**
 * One message. `created_at` is explicit on every row because the ordering
 * under test is unread-first-then-newest, and rows written in the same
 * microsecond would settle it by id instead.
 *
 * Grep first: `grep -rn "^function adminFeedbackRow" tests/`.
 *
 * @param  array<string, mixed>  $attributes
 */
function adminFeedbackRow(array $attributes): Feedback
{
    return Feedback::query()->create(array_merge([
        'bookshelf_id' => null,
        'member_id' => null,
        'guest_name' => 'Chị Hạnh',
        'guest_contact' => '0912345678',
        'guest_hash' => hash('sha256', 'x'),
        'subject' => 'Giờ mở cửa',
        'body' => 'Tủ sách mở lúc mấy giờ ạ?',
        'status' => 'new',
        'created_at' => CarbonImmutable::parse('2026-09-01T03:00:00Z'),
    ], $attributes));
}

it('shows every message when the filter names a status that does not exist', function () {
    $admin = adminFeedbackFix();

    adminFeedbackRow(['subject' => 'Một', 'status' => 'new']);
    adminFeedbackRow(['subject' => 'Hai', 'status' => 'read']);
    adminFeedbackRow(['subject' => 'Ba', 'status' => 'resolved']);

    // Three shapes of wrong, all meaning the same thing. `constructor` is
    // the reference's own example — a value from a URL used to pick a
    // branch — and `NEW` is the one a volunteer actually types.
    foreach ([null, 'constructor', 'NEW', 'đã đọc'] as $bad) {
        $url = $bad === null ? '/admin/feedback' : '/admin/feedback?status='.urlencode($bad);

        test()->actingAs($admin)
            ->get($url)
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('admin/feedback')
                ->has('messages', 3)
                // AND THE CHIP AGREES WITH THE LIST. The server sends back
                // the NARROWED value, so an unrecognised parameter cannot
                // light the *Mới* chip over a list showing everything.
                ->where('filter', null)
            );
    }

    // The other half, or the assertions above pass on a screen with no
    // filtering at all: a RECOGNISED value still narrows.
    test()->actingAs($admin)
        ->get('/admin/feedback?status=resolved')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->has('messages', 1)
            ->where('messages.0.subject', 'Ba')
            ->where('filter', 'resolved')
        );
});

it('keeps the contact number out of every list row and puts it in the open one', function () {
    $admin = adminFeedbackFix();

    // THE FIXTURE IS THE TEST. List and detail arrive in ONE Inertia
    // response, so "the response does not contain this number" would be
    // false by construction — the open message's number IS in it. Every
    // row carries a DIFFERENT number, and the one selected below is the
    // only row whose number may appear at all.
    $open = adminFeedbackRow([
        'subject' => 'Đang mở', 'guest_contact' => '0900000001',
        'created_at' => CarbonImmutable::parse('2026-09-01T05:00:00Z'),
    ]);
    adminFeedbackRow([
        'subject' => 'Tin khác', 'guest_contact' => '0900000002',
        'created_at' => CarbonImmutable::parse('2026-09-01T04:00:00Z'),
    ]);
    adminFeedbackRow([
        'subject' => 'Tin cũ', 'guest_contact' => '0900000003',
        'created_at' => CarbonImmutable::parse('2026-09-01T03:00:00Z'),
    ]);

    test()->actingAs($admin)
        ->get('/admin/feedback?message='.$open->id)
        ->assertInertia(function (AssertableInertia $page) {
            $rows = $page->toArray()['props']['messages'];

            expect($rows)->toHaveCount(3);

            foreach ($rows as $row) {
                // SCOPED TO THE LIST PROP, key by key — the server must not
                // send the field at all, not merely leave it unrendered.
                expect($row)->not->toHaveKey('senderContact')
                    ->and($row)->not->toHaveKey('guestContact')
                    // The rate-limit key is in NEITHER pane. It is of no use
                    // to a person and AuditSecrets would refuse it in a
                    // payload for the same reason.
                    ->and($row)->not->toHaveKey('guestHash');
            }

            $page->where('open.senderContact', '0900000001')
                ->where('open.feedbackId', fn (string $id) => $id !== '');
        });
});

it('opens a message without marking it read, and writes no audit row for the look', function () {
    $admin = adminFeedbackFix();

    $message = adminFeedbackRow(['status' => 'new']);

    test()->actingAs($admin)
        ->get('/admin/feedback?message='.$message->id)
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('open.status', 'new')
            ->where('open.isUnread', true)
            // The unread count and the badge are the same number and neither
            // moved: a version that marked on open would show 0 here while
            // still rendering the message as new, which is the pane
            // disagreement the one-read shape exists to prevent.
            ->where('unread', 1)
            ->where('unreadFeedback', 1)
        );

    $message->refresh();

    expect($message->status->value)->toBe('new')
        ->and($message->handled_by)->toBeNull()
        ->and($message->handled_at)->toBeNull()
        // THE AUDIT HALF, and it is the half that would not self-detect: a
        // command run on every open fills the log with a row per glance long
        // before anybody notices the status column moving.
        ->and(AuditLog::query()->whereIn('action', ['feedback.read', 'feedback.resolved'])->count())->toBe(0);
});

it('marks a message read and then resolved, stamping the handler each time', function () {
    $admin = adminFeedbackFix();

    $message = adminFeedbackRow(['status' => 'new']);

    test()->actingAs($admin)
        ->post('/admin/feedback/'.$message->id.'/read')
        // BACK TO THE SAME MESSAGE, not to the bare inbox: the list reorders
        // under a status move, so a redirect without the id would leave the
        // administrator looking at a different message.
        ->assertRedirect('/admin/feedback?message='.$message->id)
        ->assertSessionHas('success', __('rules.feedback_read_flash'));

    $message->refresh();

    expect($message->status->value)->toBe('read')
        ->and($message->handled_by)->toBe($admin->id)
        ->and($message->handled_at)->not->toBeNull();

    $read = AuditLog::query()->where('action', 'feedback.read')->sole();

    expect($read->entity_type)->toBe('feedback')
        ->and($read->entity_id)->toBe($message->id)
        // The status EITHER SIDE, which is what an investigation reads —
        // "resolved straight from the inbox" and "read yesterday, resolved
        // today" are different histories.
        ->and($read->before['status'])->toBe('new')
        ->and($read->after['status'])->toBe('read');

    test()->actingAs($admin)
        ->post('/admin/feedback/'.$message->id.'/resolve')
        ->assertRedirect('/admin/feedback?message='.$message->id)
        ->assertSessionHas('success', __('rules.feedback_resolved_flash'));

    $message->refresh();

    expect($message->status->value)->toBe('resolved');

    $resolved = AuditLog::query()->where('action', 'feedback.resolved')->sole();

    expect($resolved->before['status'])->toBe('read')
        ->and($resolved->after['status'])->toBe('resolved');
});

it('files a handling row on the shelf the MESSAGE names, and globally when it names none', function () {
    $admin = adminFeedbackFix();

    $shelf = Bookshelf::factory()->create(['slug' => 'vinh-long-fbk', 'settings' => []]);

    $ofShelf = adminFeedbackRow(['bookshelf_id' => $shelf->id, 'subject' => 'Của giáo xứ']);
    $siteWide = adminFeedbackRow(['bookshelf_id' => null, 'subject' => 'Toàn hệ thống']);

    test()->actingAs($admin)->post('/admin/feedback/'.$ofShelf->id.'/read')->assertRedirect();
    test()->actingAs($admin)->post('/admin/feedback/'.$siteWide->id.'/resolve')->assertRedirect();

    app(TenantContext::class)->actSystemWide();

    // SPEC D6, AND THE INCIDENT IT COMES FROM: the reference recorded an
    // administrator resolving one parish's message while scoped to another,
    // which wrote the sentence into the wrong parish's log — where its own
    // manager read it, and where the right parish's manager never saw that
    // anything had happened. The caller here is scoped to NOTHING, so the
    // only place either shelf could come from is the row.
    expect(AuditLog::query()->where('action', 'feedback.read')->sole()->bookshelf_id)
        ->toBe($shelf->id)
        ->and(AuditLog::query()->where('action', 'feedback.resolved')->sole()->bookshelf_id)
        ->toBeNull();
});

it('counts the badge off the inbox\'s own predicate on a mixed inbox', function () {
    $admin = adminFeedbackFix();

    // MIXED, WITH UNEQUAL COUNTS, deliberately: two new, three read, one
    // resolved. A badge written as Feedback::count() would say 6, one
    // written as "not resolved" would say 5, and a fixture of three unread
    // messages would have let both pass.
    adminFeedbackRow(['status' => 'new', 'subject' => 'Mới 1']);
    adminFeedbackRow(['status' => 'new', 'subject' => 'Mới 2']);
    adminFeedbackRow(['status' => 'read', 'subject' => 'Đọc 1']);
    adminFeedbackRow(['status' => 'read', 'subject' => 'Đọc 2']);
    adminFeedbackRow(['status' => 'read', 'subject' => 'Đọc 3']);
    adminFeedbackRow(['status' => 'resolved', 'subject' => 'Xong 1']);

    test()->actingAs($admin)
        ->get('/admin/feedback')
        ->assertInertia(function (AssertableInertia $page) {
            $rows = $page->toArray()['props']['messages'];

            $unreadRows = count(array_filter($rows, fn (array $row): bool => $row['isUnread'] === true));

            // THE THREE NUMBERS ARE ONE NUMBER. The shell's badge, the
            // screen's "n tin mới" line and the rows the list itself shows
            // as unread all come from FeedbackInboxQuery, and a second
            // predicate written anywhere would show up as a disagreement
            // here — the drift commit 8e81c82 had to fix once already.
            expect($unreadRows)->toBe(2);

            $page->has('messages', 6)
                ->where('unread', 2)
                ->where('unreadFeedback', 2);
        });

    // AND THE BADGE IS NOT THE INBOX PAGE'S ALONE — it is shared on every
    // `/admin` page, which is the trap copying pendingDonations' `$shelf !==
    // null` clause would have sprung: that shape ships null on every page of
    // an area that binds no tenant, and a test written only against this
    // screen could not tell.
    test()->actingAs($admin)
        ->get('/admin/categories')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('unreadFeedback', 2));
});

it('orders unread first and then newest, and names the shelf on every row', function () {
    $admin = adminFeedbackFix();

    $shelf = Bookshelf::factory()->create(['slug' => 'dong-thap-fbk', 'settings' => []]);

    adminFeedbackRow([
        'subject' => 'Đã đọc, mới nhất', 'status' => 'read',
        'bookshelf_id' => $shelf->id,
        'created_at' => CarbonImmutable::parse('2026-09-01T09:00:00Z'),
    ]);
    adminFeedbackRow([
        'subject' => 'Chưa đọc, cũ', 'status' => 'new',
        'bookshelf_id' => $shelf->id,
        'created_at' => CarbonImmutable::parse('2026-09-01T01:00:00Z'),
    ]);
    adminFeedbackRow([
        'subject' => 'Chưa đọc, mới', 'status' => 'new',
        'bookshelf_id' => null,
        'created_at' => CarbonImmutable::parse('2026-09-01T02:00:00Z'),
    ]);

    test()->actingAs($admin)
        ->get('/admin/feedback')
        ->assertInertia(fn (AssertableInertia $page) => $page
            // A QUEUE DRAINS RATHER THAN PILING UP: the read message is
            // newer than both unread ones and still sorts last.
            ->where('messages.0.subject', 'Chưa đọc, mới')
            ->where('messages.1.subject', 'Chưa đọc, cũ')
            ->where('messages.2.subject', 'Đã đọc, mới nhất')
            // NULL IS THE SITE-WIDE MESSAGE and the screen renders
            // "Toàn hệ thống" for it; what the server must not do is send a
            // shelf name it invented.
            ->where('messages.0.shelfName', null)
            ->where('messages.1.shelfName', $shelf->name)
            // The server opens the top of the list when nothing is chosen —
            // the unread message the administrator came for.
            ->where('open.subject', 'Chưa đọc, mới')
        );
});

it('shows the typed name and the signed-in account as two separate facts', function () {
    $admin = adminFeedbackFix();

    // THE REFERENCE'S RECORDED INCIDENT, reproduced as a fixture: the
    // account is called "Quản Trị Viên" and the sender typed "Chị Hạnh". A
    // version that let the account stand in for the typed name displays the
    // former, and the administrator rings the wrong person.
    $sender = User::factory()->create(['full_name' => 'Quản Trị Viên']);

    $message = adminFeedbackRow([
        'guest_name' => 'Chị Hạnh',
        'member_id' => $sender->id,
    ]);

    test()->actingAs($admin)
        ->get('/admin/feedback?message='.$message->id)
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('messages.0.senderName', 'Chị Hạnh')
            ->where('messages.0.accountName', 'Quản Trị Viên')
            ->where('open.senderName', 'Chị Hạnh')
            ->where('open.accountName', 'Quản Trị Viên')
        );

    // A genuine guest's row carries the typed name and NO account, so the
    // screen's "gửi khi đang đăng nhập bằng …" line has nothing to render —
    // an accountName that fell back to the typed name would claim a session
    // that never existed.
    $guest = adminFeedbackRow(['guest_name' => 'Em Bảo', 'member_id' => null]);

    test()->actingAs($admin)
        ->get('/admin/feedback?message='.$guest->id)
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('open.senderName', 'Em Bảo')
            ->where('open.accountName', null)
        );
});

it('falls back to the top of the list when the chosen message names no row', function () {
    $admin = adminFeedbackFix();

    adminFeedbackRow(['subject' => 'Duy nhất']);

    // An id in a URL a volunteer edited, or kept from a message somebody
    // deleted from the database by hand. NOT a 404: the top of the list is
    // the unread message they came for anyway.
    test()->actingAs($admin)
        ->get('/admin/feedback?message=00000000-0000-0000-0000-000000000000')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('open.subject', 'Duy nhất'));

    // And an empty inbox opens nothing rather than throwing.
    Feedback::query()->delete();

    test()->actingAs($admin)
        ->get('/admin/feedback')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->has('messages', 0)->where('open', null));
});

it('answers 404 for a handling post naming no message, and refuses a caller who is not a super administrator', function () {
    $admin = adminFeedbackFix();

    test()->actingAs($admin)
        ->post('/admin/feedback/00000000-0000-0000-0000-000000000000/read')
        // The number implicit binding would have produced, and the one spec
        // §5.4's anti-enumeration rule wants — never a 403.
        ->assertNotFound();

    $message = adminFeedbackRow([]);
    $reader = User::factory()->create(['is_super_admin' => false]);

    // The `/admin` group's own middleware is the whole of the refusal —
    // there is no Gate call anywhere in the controller or the query. It
    // answers 404 rather than 403, which is this repo's anti-enumeration
    // shape: a reader poking at /admin cannot learn from the status code
    // that the area exists.
    test()->actingAs($reader)->get('/admin/feedback')->assertNotFound();
    test()->actingAs($reader)->post('/admin/feedback/'.$message->id.'/read')->assertNotFound();
    test()->actingAs($reader)->post('/admin/feedback/'.$message->id.'/resolve')->assertNotFound();

    expect($message->refresh()->status->value)->toBe('new');

    // And the badge is not merely hidden from them — the server never sends
    // the number at all.
    test()->actingAs($reader)
        ->get('/')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('unreadFeedback', null));
});
