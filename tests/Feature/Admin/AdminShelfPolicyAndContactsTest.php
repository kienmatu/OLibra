<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\Circulation\LendingSettings;
use App\Support\Community\CommentSettings;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Task 5: the shelf editor's other two sections — the lending policy and the
 * up-to-three contacts. Task 4's own file covers the profile section and the
 * slug; this one covers what was added beside it.
 *
 * THE SETTINGS ASSERTIONS GO THROUGH THE READING CLASSES, not through the
 * raw `settings` bag, and that is the centre of this file. The eight keys
 * are storage keys: an editor writing `allow_comments` instead of
 * `comments_enabled` would store something, report success, and change
 * nothing, because App\Support\Community\CommentSettings coalesces the key it
 * actually reads to `true` and never looks at the other spelling. A test
 * asserting `$shelf->settings['comments_enabled']` would pass on that bug for
 * one direction and fail with an "undefined key" for the other — an error,
 * not a statement about behaviour. Asking the consumer "is commenting on?"
 * fails the way the volunteer would experience it: the toggle was turned off
 * and comments are still on.
 *
 * Watched failing before it was accepted, both halves:
 *   - `comments_enabled` renamed to `allow_comments` in the command's key
 *     list reddens "the comment toggles reach the class that reads them"
 *     with `Failed asserting that true is false` — the setting saved and did
 *     not take effect, which is the exact failure mode the key warning
 *     exists to prevent.
 *   - dropping the blank-name branch so every position writes a row reddens
 *     "a blank position-2 name saves no row at all" with a count of 2 where
 *     1 was expected, and again on the nameless row's empty name.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model — and here it is load-bearing rather than defensive the way Task 4's
 * was: `BookshelfContact` is shelf-scoped, so the assertions below would
 * throw in BookshelfScope without it.
 *
 * Grep first: `grep -rn "^function adminShelfPolicyFix" tests/`.
 */
function adminShelfPolicyFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true]);
}

/** The eight the form always posts, as a valid baseline each test varies. */
function adminShelfPolicyPayload(array $overrides = []): array
{
    return array_merge([
        'loan_days' => 21,
        'max_concurrent_loans' => 5,
        'max_renewals' => 2,
        'renewal_days' => 10,
        'hold_days' => 4,
        'due_soon_days' => 2,
        'comments_enabled' => true,
        'comments_require_approval' => true,
    ], $overrides);
}

it('saves the eight policy settings so the classes that read them see the new values', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'chinh-sach', 'settings' => []]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/chinh-sach/policy', adminShelfPolicyPayload())
        ->assertRedirect('/admin/shelves/chinh-sach/edit');

    $lending = LendingSettings::fromShelf($shelf->fresh());

    expect($lending->loanDays)->toBe(21)
        ->and($lending->maxConcurrentLoans)->toBe(5)
        ->and($lending->maxRenewals)->toBe(2)
        ->and($lending->renewalDays)->toBe(10)
        ->and($lending->holdDays)->toBe(4)
        ->and($lending->dueSoonDays)->toBe(2);
});

it('lets the comment toggles reach the class that reads them, under the key it reads', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'binh-luan', 'settings' => []]);

    // Both default TRUE, so turning both OFF is the only direction that can
    // distinguish a save from a no-op. A form writing `allow_comments`
    // leaves this reading `true` — the setting appears to save and changes
    // nothing.
    $this->actingAs($admin)
        ->patch('/admin/shelves/binh-luan/policy', adminShelfPolicyPayload([
            'comments_enabled' => false,
            'comments_require_approval' => false,
        ]))
        ->assertRedirect('/admin/shelves/binh-luan/edit');

    $comments = CommentSettings::fromShelf($shelf->fresh());

    expect($comments->commentsEnabled)->toBeFalse()
        ->and($comments->commentsRequireApproval)->toBeFalse();
});

it('leaves settings keys the policy form never showed alone', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'khong-xoa-khoa-khac',
        // Two of BR §5.5's four the policy form deliberately does not carry
        // (spec D2), both read by App\Queries\BookDetailQuery today. A save
        // that assigned a fresh eight-key array would delete them.
        'settings' => ['public_show_current_borrower' => false, 'public_name_display' => 'initials'],
    ]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/khong-xoa-khoa-khac/policy', adminShelfPolicyPayload());

    $settings = (array) $shelf->fresh()->settings;

    expect($settings['public_show_current_borrower'])->toBeFalse()
        ->and($settings['public_name_display'])->toBe('initials')
        ->and($settings['loan_days'])->toBe(21);
});

it('writes bookshelf.updated when the policy is saved', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'nhat-ky-chinh-sach', 'settings' => ['loan_days' => 14]]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/nhat-ky-chinh-sach/policy', adminShelfPolicyPayload());

    $row = AuditLog::query()->where('action', 'bookshelf.updated')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->actor_id)->toBe($admin->id)
        ->and($row->before['loan_days'])->toBe(14)
        ->and($row->after['loan_days'])->toBe(21)
        // Never stored, so "this shelf has never had a policy of its own" —
        // a different fact from any value, and not the fallback repeated.
        ->and($row->before['hold_days'])->toBeNull()
        ->and($row->after['hold_days'])->toBe(4);
});

it('names the shelf in the sentence both saves render, rather than "một tủ sách"', function () {
    // The fix wave's finding 4, at the layer that produces the defect. The
    // bookshelf.updated arm names the shelf out of the payload, and neither
    // of these two commands moves a name — so unless each puts the shelf's
    // own name in its bags, every policy save and every contacts save reads
    // "đã sửa thông tin MỘT tủ sách" on a log a cross-shelf browser will read.
    //
    // ASSERTED THROUGH THE SENTENCE, not through `$row->after['name']`,
    // because the key alone is not the requirement: a bag carrying `name`
    // under a different spelling, or only in `before`, would satisfy a key
    // assertion and still render the bare twin. AuditLogQuery builds its
    // facts exactly this way (that class, ~line 155).
    $admin = adminShelfPolicyFix();
    Bookshelf::factory()->create(['slug' => 'ten-trong-nhat-ky', 'name' => 'Tủ sách Đồng Tháp', 'settings' => []]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/ten-trong-nhat-ky/policy', adminShelfPolicyPayload());

    $this->actingAs($admin)
        ->put('/admin/shelves/ten-trong-nhat-ky/contacts', [
            'contact_1_name' => 'Chị Hoa',
            'contact_2_name' => '',
            'contact_3_name' => '',
        ]);

    $rows = AuditLog::query()->where('action', 'bookshelf.updated')->orderBy('occurred_at')->get();

    expect($rows)->toHaveCount(2);

    foreach ($rows as $row) {
        $sentence = AuditSentences::sentence('bookshelf.updated', [
            'actor' => $admin->full_name,
            'subject' => null,
            'before' => $row->before,
            'after' => $row->after,
        ]);

        expect($sentence)->toContain('Tủ sách Đồng Tháp')
            ->and($sentence)->not->toContain('một tủ sách');
    }
});

it('refuses a loan period outside the bounds and saves nothing', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'ngoai-khoang', 'settings' => []]);

    // 0 is the measured defect the reference's bounds table closes: every
    // loan from that shelf would fall due the day it was made.
    $this->actingAs($admin)
        ->patch('/admin/shelves/ngoai-khoang/policy', adminShelfPolicyPayload(['loan_days' => 0]))
        ->assertSessionHasErrors('loan_days');

    expect((array) $shelf->fresh()->settings)->toBe([]);
});

it('saves exactly one contact at the right position, and no row for a blank name', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'lien-he', 'settings' => []]);

    $this->actingAs($admin)
        ->put('/admin/shelves/lien-he/contacts', [
            'contact_1_name' => 'Chị Mai',
            'contact_1_phone' => '0900000001',
            'contact_1_role_label' => 'Người giữ chìa khoá',
            // Blank name, phone typed anyway: an abandoned half-edit, not a
            // refusal and not an empty row (spec D3).
            'contact_2_name' => '',
            'contact_2_phone' => '0900000002',
            'contact_2_role_label' => '',
            'contact_3_name' => 'Anh Nam',
            'contact_3_phone' => null,
            'contact_3_role_label' => null,
        ])
        ->assertRedirect('/admin/shelves/lien-he/edit');

    $rows = $shelf->contacts()->orderBy('position')->get();

    // Two rows at positions 1 and 3 — nobody shifted up into the gap.
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('position')->all())->toBe([1, 3])
        ->and($rows->firstWhere('position', 1)->name)->toBe('Chị Mai')
        ->and($rows->firstWhere('position', 1)->phone)->toBe('0900000001')
        ->and($rows->firstWhere('position', 1)->role_label)->toBe('Người giữ chìa khoá')
        ->and($rows->firstWhere('position', 3)->name)->toBe('Anh Nam')
        ->and($rows->firstWhere('position', 3)->phone)->toBeNull();

    // And nothing nameless was written and then hidden by the position
    // filter above: the whole table for this shelf is those two rows.
    expect(BookshelfContact::query()->count())->toBe(2);
});

it('clears a contact when its name is emptied, and frees the position', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'go-lien-he', 'settings' => []]);
    $shelf->contacts()->create(['position' => 1, 'name' => 'Chị Mai']);
    $shelf->contacts()->create(['position' => 2, 'name' => 'Anh Nam', 'phone' => '0900000002']);

    $this->actingAs($admin)
        ->put('/admin/shelves/go-lien-he/contacts', [
            'contact_1_name' => 'Chị Mai',
            'contact_2_name' => '',
            'contact_3_name' => '',
        ])
        ->assertRedirect('/admin/shelves/go-lien-he/edit');

    expect($shelf->contacts()->count())->toBe(1);

    // The retired row released position 2 — `position_key` is null once
    // `deleted_at` is set, so the unique index no longer holds the slot and
    // a later save can put somebody else there.
    $this->actingAs($admin)
        ->put('/admin/shelves/go-lien-he/contacts', [
            'contact_1_name' => 'Chị Mai',
            'contact_2_name' => 'Chị Lan',
            'contact_3_name' => '',
        ])
        ->assertRedirect('/admin/shelves/go-lien-he/edit');

    expect($shelf->contacts()->where('position', 2)->sole()->name)->toBe('Chị Lan');
});

it('refuses a save that would leave the shelf with no first contact', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'thieu-nguoi-mot', 'settings' => []]);
    $shelf->contacts()->create(['position' => 1, 'name' => 'Chị Mai']);

    $this->actingAs($admin)
        ->put('/admin/shelves/thieu-nguoi-mot/contacts', [
            'contact_1_name' => '',
            'contact_2_name' => 'Anh Nam',
            'contact_3_name' => '',
        ])
        ->assertSessionHasErrors('contact_1_name');

    // Refused before anything was written: the existing contact survives and
    // the second block's name did not land.
    expect($shelf->contacts()->count())->toBe(1)
        ->and($shelf->contacts()->sole()->name)->toBe('Chị Mai');
});

it('gives the editor the policy and contact shapes its two new forms need', function () {
    $admin = adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'hinh-dang',
        'settings' => ['loan_days' => 30, 'comments_enabled' => false],
    ]);
    $shelf->contacts()->create(['position' => 1, 'name' => 'Chị Mai', 'role_label' => 'Quản lý tủ sách']);
    $shelf->contacts()->create(['position' => 3, 'name' => 'Anh Nam']);

    $this->actingAs($admin)
        ->get('/admin/shelves/hinh-dang/edit')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/shelves/edit')
            // Stored values come back; unstored ones come back as the
            // fallback the application actually behaves as, not as 0.
            ->where('policy.loan_days', 30)
            ->where('policy.max_concurrent_loans', 3)
            ->where('policy.comments_enabled', false)
            ->where('policy.comments_require_approval', true)
            ->has('policy.max_renewals')
            ->has('policy.renewal_days')
            ->has('policy.hold_days')
            ->has('policy.due_soon_days')
            // Three entries, null in the middle — three fixed blocks, not a
            // list that shortened and moved the third volunteer up.
            ->has('contacts', 3)
            ->where('contacts.0.name', 'Chị Mai')
            ->where('contacts.0.roleLabel', 'Quản lý tủ sách')
            ->where('contacts.1', null)
            ->where('contacts.2.name', 'Anh Nam'));
});

it('404s a signed-in reader on both routes this task adds', function () {
    adminShelfPolicyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'khong-phai-cua-ban-5', 'settings' => []]);
    $reader = User::factory()->create(['is_super_admin' => false]);

    $this->actingAs($reader)
        ->patch("/admin/shelves/{$shelf->slug}/policy", adminShelfPolicyPayload())
        ->assertNotFound();

    $this->actingAs($reader)
        ->put("/admin/shelves/{$shelf->slug}/contacts", ['contact_1_name' => 'Chị Mai'])
        ->assertNotFound();
});
