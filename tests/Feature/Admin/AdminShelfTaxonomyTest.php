<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\Circulation\LendingSettings;
use App\Support\Community\CommentSettings;
use App\Support\Members\ParishTaxonomy;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 4: the parish taxonomy's SHAPE, the fourth section of the
 * admin shelf editor (spec D5, D8).
 *
 * THE ASSERTIONS GO THROUGH ParishTaxonomy, not through the raw `settings`
 * bag, for the reason the policy file's own docblock gives about
 * `comments_enabled`: these are storage keys, and a command writing
 * `level_1_label` or `levelOneLabel` would store something, report success
 * and change nothing any screen reads — `fromSettings()` falls back per
 * field and would keep answering "Tổ". Asking the reading class "what does
 * this shelf call its units?" fails the way the volunteer experiences it.
 *
 * THE KEY-PRESERVATION TEST IS THE CENTRE OF THIS FILE. `settings` is one
 * bag holding the eight lending keys, the two public-display settings and
 * this task's four, so a writer that assigned rather than merged would
 * delete a shelf's whole lending policy the first time somebody renamed its
 * tổ. Watched failing before it was accepted — see the report; assigning
 * `$settings = ['parish_taxonomy' => $stored]` in UpdateParishTaxonomy
 * reddens it on the first stored key it looks for.
 *
 * NO UNIT CRUD IS TESTED HERE BECAUSE NONE SHIPS HERE (spec D5). `ParishUnit`
 * is shelf-scoped and `/admin` binds no tenant; the units live on
 * `manage/units`, which binds one.
 *
 * THE /admin GROUP BINDS NO TENANT, so the fixture widens before touching a
 * model. Defensive rather than load-bearing here — `Bookshelf` and
 * `AuditLog` carry no shelf scope — and kept for the shape every other admin
 * test file in this directory uses.
 *
 * Grep first: `grep -rn "^function adminShelfTaxonomyFix" tests/`.
 */
function adminShelfTaxonomyFix(): User
{
    app(TenantContext::class)->actSystemWide();

    return User::factory()->create(['is_super_admin' => true]);
}

/** The four the form always posts, as a valid baseline each test varies. */
function adminShelfTaxonomyPayload(array $overrides = []): array
{
    return array_merge([
        'levels' => 2,
        'nested' => true,
        'level1_label' => 'Giáo họ',
        'level2_label' => 'Tổ',
    ], $overrides);
}

it('saves the shape under the keys ParishTaxonomy reads', function () {
    $admin = adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'cach-chia', 'settings' => []]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/cach-chia/taxonomy', adminShelfTaxonomyPayload())
        ->assertRedirect('/admin/shelves/cach-chia/edit')
        // Its own sentence, and that is the requirement rather than a
        // nicety: this screen has one banner shared by four forms, so a
        // save that flashed the policy's sentence would be indistinguishable
        // from a policy save.
        ->assertSessionHas('success', __('rules.bookshelf_taxonomy_saved_flash'));

    expect(__('rules.bookshelf_taxonomy_saved_flash'))
        ->not->toBe(__('rules.bookshelf_policy_saved_flash'));

    $stored = ((array) $shelf->fresh()->settings)['parish_taxonomy'] ?? null;
    $taxonomy = ParishTaxonomy::fromSettings($stored);

    expect($taxonomy->levels)->toBe(2)
        ->and($taxonomy->nested)->toBeTrue()
        ->and($taxonomy->level1Label)->toBe('Giáo họ')
        ->and($taxonomy->level2Label)->toBe('Tổ');
});

it('leaves every other settings key the taxonomy form never showed alone', function () {
    // 3b-i's data-loss test applied to the new writer. The eight lending
    // keys and the two public-display settings share one column with this
    // task's four; a wholesale write drops all ten.
    $admin = adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'khong-xoa-chinh-sach',
        'settings' => [
            'loan_days' => 30,
            'max_concurrent_loans' => 7,
            'max_renewals' => 0,
            'renewal_days' => 5,
            'hold_days' => 2,
            'due_soon_days' => 0,
            'comments_enabled' => false,
            'comments_require_approval' => false,
            // The two BR §5.5 settings no form on this screen carries,
            // both read by App\Queries\BookDetailQuery today.
            'public_show_current_borrower' => false,
            'public_name_display' => 'initials',
        ],
    ]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/khong-xoa-chinh-sach/taxonomy', adminShelfTaxonomyPayload());

    $fresh = $shelf->fresh();
    $settings = (array) $fresh->settings;

    // THROUGH THE READING CLASSES for the eight, so the failure reads the
    // way the volunteer would meet it — "this shelf lends for 14 days
    // again" — rather than as an undefined-key error, which is a crash and
    // not a statement about behaviour. The two public-display keys have no
    // reading class of their own yet, so they are asserted off the bag with
    // an explicit presence check for the same reason.
    $lending = LendingSettings::fromShelf($fresh);
    $comments = CommentSettings::fromShelf($fresh);

    expect($lending->loanDays)->toBe(30)
        ->and($lending->maxConcurrentLoans)->toBe(7)
        ->and($lending->maxRenewals)->toBe(0)
        ->and($lending->renewalDays)->toBe(5)
        ->and($lending->holdDays)->toBe(2)
        ->and($lending->dueSoonDays)->toBe(0)
        ->and($comments->commentsEnabled)->toBeFalse()
        ->and($comments->commentsRequireApproval)->toBeFalse()
        ->and(array_key_exists('public_show_current_borrower', $settings))->toBeTrue()
        ->and(array_key_exists('public_name_display', $settings))->toBeTrue()
        ->and($settings['public_show_current_borrower'])->toBeFalse()
        ->and($settings['public_name_display'])->toBe('initials')
        // And the save itself landed, so this is not green on a write that
        // simply did nothing.
        ->and($settings['parish_taxonomy']['level1_label'])->toBe('Giáo họ');
});

it('writes parish_taxonomy.updated on the shelf, with both shapes and a real sentence', function () {
    $admin = adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'nhat-ky-co-cau', 'settings' => []]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/nhat-ky-co-cau/taxonomy', adminShelfTaxonomyPayload());

    $row = AuditLog::query()->where('action', 'parish_taxonomy.updated')->sole();

    // The row belongs to the SHELF, unlike the category rows this phase
    // also adds: the taxonomy is one parish's own arrangement. The /admin
    // group binds no tenant, so this only lands because the command
    // configures the recorder with forShelf().
    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->actor_id)->toBe($admin->id)
        // `before` is what the shelf BEHAVED as, not four nulls: a shelf
        // that never configured its taxonomy was answering with the
        // defaults all along.
        ->and($row->before['levels'])->toBe(1)
        ->and($row->before['nested'])->toBeFalse()
        ->and($row->before['level1_label'])->toBe('Tổ')
        ->and($row->after['levels'])->toBe(2)
        ->and($row->after['level1_label'])->toBe('Giáo họ')
        // A real sentence, never the undescribed-action fallback — and one
        // that names the CÁCH CHIA rather than the đơn vị, because no unit
        // moved here.
        ->and(AuditSentences::sentence('parish_taxonomy.updated', [
            'actor' => 'Maria Q',
            'subject' => null,
            'before' => $row->before,
            'after' => $row->after,
        ]))->toBe('Maria Q đã '.__('audit.parish_taxonomy_updated'))
        ->and(AuditSentences::groupOf('parish_taxonomy.updated'))->toBe('administration');
});

it('refuses a blank label and a level count that is neither one nor two', function () {
    $admin = adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create([
        'slug' => 'tu-choi-co-cau',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/tu-choi-co-cau/taxonomy', adminShelfTaxonomyPayload(['level2_label' => '   ']))
        ->assertSessionHasErrors('level2_label');

    // Three levels is not a shape this application has: ParishTaxonomy
    // coerces anything that is not exactly 2 down to 1, so accepting it
    // would store a number the reader silently collapses.
    $this->actingAs($admin)
        ->patch('/admin/shelves/tu-choi-co-cau/taxonomy', adminShelfTaxonomyPayload(['levels' => 3]))
        ->assertSessionHasErrors('levels');

    // Refused before anything was written: the shelf keeps what it had.
    $taxonomy = ParishTaxonomy::fromSettings(((array) $shelf->fresh()->settings)['parish_taxonomy'] ?? null);

    expect($taxonomy->levels)->toBe(2)
        ->and($taxonomy->level2Label)->toBe('Tổ');
});

it('keeps the level-2 choice when a shelf drops to one level', function () {
    // OPS §4.5's invariant: a shelf that drops to one level and later
    // returns to two finds its previous choice intact.
    // ParishUnits::validateSelection() gates its nesting rule on
    // `levels === 2 && nested`, so the flag surviving is behaviour and not
    // tidiness.
    $admin = adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 've-mot-cap', 'settings' => []]);

    $this->actingAs($admin)
        ->patch('/admin/shelves/ve-mot-cap/taxonomy', adminShelfTaxonomyPayload([
            'levels' => 1,
            'nested' => true,
            'level2_label' => 'Tổ',
        ]));

    $taxonomy = ParishTaxonomy::fromSettings(((array) $shelf->fresh()->settings)['parish_taxonomy'] ?? null);

    expect($taxonomy->levels)->toBe(1)
        ->and($taxonomy->nested)->toBeTrue()
        ->and($taxonomy->level2Label)->toBe('Tổ');
});

it('gives the editor the taxonomy shape its fourth form needs, defaults included', function () {
    $admin = adminShelfTaxonomyFix();
    Bookshelf::factory()->create(['slug' => 'chua-cau-hinh', 'settings' => []]);

    $this->actingAs($admin)
        ->get('/admin/shelves/chua-cau-hinh/edit')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('admin/shelves/edit')
            // A shelf that has never been configured comes back as what the
            // application behaves as — one level, "Tổ", not nested — and not
            // as nulls a form would render as empty boxes.
            ->where('taxonomy.levels', 1)
            ->where('taxonomy.nested', false)
            ->where('taxonomy.level1_label', 'Tổ')
            ->where('taxonomy.level2_label', 'Tổ'));
});

it('404s a signed-in reader on the route this task adds', function () {
    adminShelfTaxonomyFix();
    $shelf = Bookshelf::factory()->create(['slug' => 'khong-phai-cua-ban-co-cau', 'settings' => []]);
    $reader = User::factory()->create(['is_super_admin' => false]);

    $this->actingAs($reader)
        ->patch("/admin/shelves/{$shelf->slug}/taxonomy", adminShelfTaxonomyPayload())
        ->assertNotFound();
});
