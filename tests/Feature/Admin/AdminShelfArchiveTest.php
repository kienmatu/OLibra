<?php

use App\Enums\BookshelfStatus;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Task 6: `/admin/shelves/{bookshelf}/archive` and `/unarchive` — spec D4's
 * explicit admin path, over HTTP.
 *
 * WHAT THIS FILE DOES NOT ASSERT, and the omission is the decision rather
 * than an oversight: that an archived shelf's own routes stop resolving.
 * They do not. Spec D4 keeps the `ResolveTenant` filter for 3b-ii, because
 * closing it changes the entry condition of every tenant-bound route in the
 * application and the behaviour that makes it safe to close — un-archiving —
 * is what this task builds. An archived shelf therefore still serves its
 * routes here, exactly as it did before (`docs/known-gaps.md:4306-4338`), and
 * a test asserting otherwise would be asserting 3b-ii.
 *
 * THE STATE RULE IS PINNED IN BookshelfPolicyTest, through `Gate::inspect()`,
 * and is deliberately not re-asserted from a second angle here. What this
 * file adds is that the routes REACH that policy: the refusal block below
 * archives twice and reads the second answer, which is the Gate's own 404
 * arriving through `Gate::authorize` rather than the middleware's.
 *
 * Grep first: `grep -rn "^function adminShelfArchiveFix" tests/`.
 *
 * @return array{User, Bookshelf}
 */
function adminShelfArchiveFix(string $slug, BookshelfStatus $status = BookshelfStatus::Active): array
{
    // The /admin group binds no tenant, and the factory runs outside a
    // request — the same reason every other admin fixture widens first.
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => $slug,
        'name' => 'Tủ sách '.$slug,
        'settings' => [],
        'status' => $status,
    ]);

    return [User::factory()->create(['is_super_admin' => true]), $shelf];
}

it('archives a shelf and writes bookshelf.archived naming it', function () {
    [$admin, $shelf] = adminShelfArchiveFix('ngung-hoat-dong');

    $this->actingAs($admin)
        ->post("/admin/shelves/{$shelf->slug}/archive")
        ->assertRedirect('/admin/shelves');

    expect($shelf->fresh()->status)->toBe(BookshelfStatus::Archived);

    $row = AuditLog::query()->where('action', 'bookshelf.archived')->sole();

    // The shelf id on the row, not a null: this port files the lifecycle
    // against the shelf even though the reference files it globally —
    // ArchiveBookshelf's docblock carries the reason. `before` has to hold
    // the name, because that is where the sentence reads it from.
    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->entity_type)->toBe('bookshelf')
        ->and($row->entity_id)->toBe($shelf->id)
        ->and($row->before['name'])->toBe($shelf->name)
        ->and($row->before['status'])->toBe('active')
        ->and($row->after['status'])->toBe('archived');
});

it('un-archives a shelf and writes bookshelf.unarchived naming it', function () {
    [$admin, $shelf] = adminShelfArchiveFix('mo-lai', BookshelfStatus::Archived);

    $this->actingAs($admin)
        ->post("/admin/shelves/{$shelf->slug}/unarchive")
        ->assertRedirect('/admin/shelves');

    expect($shelf->fresh()->status)->toBe(BookshelfStatus::Active);

    $row = AuditLog::query()->where('action', 'bookshelf.unarchived')->sole();

    expect($row->bookshelf_id)->toBe($shelf->id)
        ->and($row->before['status'])->toBe('archived')
        ->and($row->after['status'])->toBe('active');
});

it('refuses a second archive as a 404 and writes no second row', function () {
    // The policy's state rule arriving through the ROUTE. A command that
    // authorized nothing would archive an archived shelf again here and
    // write a row saying it happened — the no-op audit entry spec D9 names
    // as its worked example.
    [$admin, $shelf] = adminShelfArchiveFix('mot-lan-thoi');

    $this->actingAs($admin)->post("/admin/shelves/{$shelf->slug}/archive");
    $this->actingAs($admin)->post("/admin/shelves/{$shelf->slug}/archive")->assertNotFound();

    expect(AuditLog::query()->where('action', 'bookshelf.archived')->count())->toBe(1);
});

it('refuses un-archiving a shelf that is not archived, as a 404', function () {
    [$admin, $shelf] = adminShelfArchiveFix('dang-hoat-dong');

    $this->actingAs($admin)->post("/admin/shelves/{$shelf->slug}/unarchive")->assertNotFound();

    expect($shelf->fresh()->status)->toBe(BookshelfStatus::Active)
        ->and(AuditLog::query()->where('action', 'bookshelf.unarchived')->count())->toBe(0);
});

it('404s a signed-in reader on both routes this task adds', function () {
    [, $shelf] = adminShelfArchiveFix('khong-phai-cua-ban-6');
    $reader = User::factory()->create(['is_super_admin' => false]);

    // EnsureSuperAdmin answers first and this passes with the policy
    // deleted — as AdminShelfEditorTest's equivalent block says, what it is
    // for is the ROUTES: two new entries that had to be put inside the
    // admin group by hand.
    $this->actingAs($reader)->post("/admin/shelves/{$shelf->slug}/archive")->assertNotFound();
    $this->actingAs($reader)->post("/admin/shelves/{$shelf->slug}/unarchive")->assertNotFound();

    expect($shelf->fresh()->status)->toBe(BookshelfStatus::Active);
});
