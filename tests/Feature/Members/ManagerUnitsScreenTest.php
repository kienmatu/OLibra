<?php

use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\User;
use App\Support\Audit\AuditSentences;
use App\Support\TenantContext;
use Inertia\Testing\AssertableInertia;

/**
 * Phase 3b-ii Task 5: `shelves/{shelf}/manage/units` — BR §5.6's parish
 * units, the rows a reader picks from at registration.
 *
 * FIVE RULES CARRY THIS FILE, and each has a test that fails when the rule
 * is removed rather than one that merely passes while it holds:
 *
 * 1. **The editing tree renders only for a super administrator.** Both
 *    directions, and in two layers: the server half asserts the `canEdit`
 *    prop, and the half that matters — that the COMPONENT switches on it —
 *    is a comment-stripped source read, because a comment saying
 *    `// canEdit switches the tree` satisfies a naive grep. The reference
 *    shipped this screen with the forms visible to everyone and corrected
 *    it before merge; this repo has produced the same defect three times.
 * 2. **A duplicate name is a refusal, not a 500.** The unique is over a
 *    generated `name_scope_key` no validator can see, so an uncaught
 *    collision is a raw errno 1062. WATCHED FAILING: with the catch removed
 *    from `CreateParishUnit`, the duplicate test reddens on a QueryException
 *    escaping instead of a session error.
 * 3. **Deleting a level-1 unit writes one audit row per DELETED ROW**, the
 *    children marked `cascaded` — a single row would hide that four
 *    sub-units went with the click (spec D6).
 * 4. **Reorder groups by the real `parent_id`.** WATCHED FAILING, on the
 *    mutation the task named: with the flat branch of the screen rewritten
 *    to `siblings={level2}`, the `nested`-off test below reddens on its
 *    source read; restored by a targeted edit, green. The redness comes
 *    from the SOURCE half and not from the two HTTP posts, and that is the
 *    finding rather than an accident — a hand-written post proves the
 *    server's rule and can say nothing about which group the screen builds,
 *    which is where the reference's own review found this defect.
 * 5. **A partial sibling list is refused**, because `[C, A]` over three
 *    units ties the ranks and silently restores name ordering.
 *
 * `$model->fresh()` DOES NOT RETURN NULL FOR A SOFT-DELETED ROW — Task 3
 * measured it, and an assertion written that way passes vacuously. Every
 * read-back below goes through `ParishUnit::query()->find($id)`, which
 * respects the scope.
 *
 * Grep first: `grep -rn "^function unitsFix" tests/`.
 *
 * @return array{Bookshelf, User, User} shelf, super admin, manager
 */
function unitsFix(string $slug = 'dong-thap-units', array $taxonomy = ['levels' => 2, 'nested' => true]): array
{
    app(TenantContext::class)->actSystemWide();

    $shelf = Bookshelf::factory()->create([
        'slug' => $slug,
        'settings' => ['parish_taxonomy' => $taxonomy + ['level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);

    // No membership for the super admin, deliberately: Gate::before grants
    // every act-as-* ability to one, which is how they reach a
    // `role:manager` route at all — the fact this screen's canEdit switch
    // depends on.
    $admin = User::factory()->superAdmin()->create(['full_name' => 'Trần Quản Trị']);

    $manager = User::factory()->create(['full_name' => 'Maria Nguyễn Quản Lý']);
    Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    return [$shelf, $admin, $manager];
}

/** A live unit of $shelf, written with the tenant already widened. */
function unitsRow(Bookshelf $shelf, int $level, string $name, ?string $parentId = null, int $sortOrder = 0): ParishUnit
{
    return ParishUnit::factory()->for($shelf)->create([
        'level' => $level,
        'parent_id' => $parentId,
        'name' => $name,
        'sort_order' => $sortOrder,
    ]);
}

it('renders the tree in the picker\'s own order, and the shape as text', function () {
    [$shelf, $admin] = unitsFix();

    // sort_order first, then the Vietnamese-collated name — never a number
    // parsed out of the name, which is the whole reason sort_order exists.
    $b = unitsRow($shelf, 1, 'Giáo họ B', null, 2);
    $a = unitsRow($shelf, 1, 'Giáo họ A', null, 1);
    unitsRow($shelf, 2, 'Tổ 2', $a->id, 1);
    unitsRow($shelf, 2, 'Tổ 10', $a->id, 2);
    // Retired, and therefore absent: this screen offers what a picker
    // offers, and ParishContextQuery deliberately carries the deleted rows
    // for describeSelection's benefit rather than for this one's.
    unitsRow($shelf, 1, 'Giáo họ Đã Xoá', null, 3)->delete();

    $this->actingAs($admin)
        ->get("/shelves/{$shelf->slug}/manage/units")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('manage/units')
            ->where('taxonomy.levels', 2)
            ->where('taxonomy.nested', true)
            ->where('taxonomy.level1Label', 'Giáo họ')
            ->where('taxonomy.level2Label', 'Tổ')
            ->has('level1', 2)
            ->where('level1.0.name', 'Giáo họ A')
            ->where('level1.1.name', 'Giáo họ B')
            ->has('level2', 2)
            // "Tổ 2" before "Tổ 10" because sort_order says so, not because
            // anything parsed the digits.
            ->where('level2.0.name', 'Tổ 2')
            ->where('level2.1.name', 'Tổ 10')
            ->where('level2.0.parentId', $a->id)
            ->where('canEdit', true));

    expect($b->id)->not->toBe($a->id);
});

it('canEdit is true for a super admin and false for the shelf\'s own manager', function () {
    [$shelf, $admin, $manager] = unitsFix('dong-thap-units-gate');
    unitsRow($shelf, 1, 'Giáo họ A');

    // BOTH DIRECTIONS. A prop that were hard-coded true would pass the
    // first assertion and fail the second; one hard-coded false, the
    // reverse. Neither alone says anything.
    $this->actingAs($admin)
        ->get("/shelves/{$shelf->slug}/manage/units")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('canEdit', true));

    $this->actingAs($manager)
        ->get("/shelves/{$shelf->slug}/manage/units")
        ->assertInertia(fn (AssertableInertia $page) => $page->where('canEdit', false));
});

it('the component actually switches its controls on canEdit', function () {
    // THE HALF THAT MATTERS, and no server test can see it: the assertions
    // above were both green while the page ignored the prop entirely and
    // rendered every form to everybody — which is exactly the defect the
    // reference shipped and corrected before merge.
    //
    // COMMENT-STRIPPED (tests/Pest.php's screenSource, the admin
    // render-feedback file's own helper), because this page explains the
    // switch in a docblock that names `canEdit` five times: a grep over the
    // raw file is satisfied by the prose alone.
    $source = screenSource('manage/units.tsx');

    expect($source)
        // The prop is taken off the page props at all…
        ->toContain('canEdit')
        // …and every one of the four controls is behind it. Asserted as the
        // guard expression rather than a count, so moving a control or
        // renaming a component keeps this honest while deleting the guard
        // does not.
        ->and(substr_count($source, 'canEdit ?'))->toBeGreaterThanOrEqual(4)
        // The read-only tail a manager gets instead — the reference's own
        // sentence, drawn under a section somebody can read and not change.
        ->and($source)->toContain('superAdminOnly')
        // The page-level refusal bag: validation_failed (a duplicate name, a
        // stale reorder list) and parish_unit_l1_not_found both land here
        // already translated, under a local name so the forms' own bags stay
        // separate from it.
        ->and($source)->toContain('errors: pageErrors')
        ->and($source)->toContain('pageErrors.rule');
});

it('creates a unit, audits it with named keys, and never dumps the model', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-create');
    $parent = unitsRow($shelf, 1, 'Giáo họ A');

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units", [
            'level' => 2, 'parent_id' => $parent->id, 'name' => '  Tổ 1  ',
        ])
        ->assertRedirect("/shelves/{$shelf->slug}/manage/units")
        ->assertSessionHas('success', __('rules.parish_unit_created_flash'));

    app(TenantContext::class)->actSystemWide();

    $unit = ParishUnit::query()->where('name', 'Tổ 1')->sole();
    expect((int) $unit->level)->toBe(2)
        ->and($unit->parent_id)->toBe($parent->id)
        ->and((int) $unit->sort_order)->toBe(0);

    $row = AuditLog::query()->where('action', 'parish_unit.created')->sole();

    // The payload names its four keys and holds nothing else. A
    // ->record(…, $unit->toArray()) would carry name_scope_key and throw
    // audit_forbidden_field before the row was ever written — AuditSecrets
    // forbids the token `key`, matched whole within snake splits — so this
    // assertion is about SHAPE, and the absence of that throw above is the
    // other half.
    expect(array_keys((array) $row->after))
        ->toEqualCanonicalizing(['level', 'parent_id', 'name', 'sort_order'])
        ->and($row->before)->toBeNull()
        ->and($row->bookshelf_id)->toBe($shelf->id);
});

it('a duplicate live name is a refusal, not a raw 1062', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-dup');
    unitsRow($shelf, 1, 'Giáo họ A');

    // Same shelf, same level, same (null) parent, same name — the exact
    // tuple parish_units_name_unique_in_scope hashes. No Form Request rule
    // could see this: the scope includes parent_id and the soft-delete
    // partition.
    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units", ['level' => 1, 'name' => 'Giáo họ A'])
        ->assertSessionHasErrors(['rule' => __('rules.validation_failed')]);

    app(TenantContext::class)->actSystemWide();
    expect(ParishUnit::query()->where('name', 'Giáo họ A')->count())->toBe(1);
});

it('a soft-deleted unit frees its name for reuse', function () {
    // The other side of the same constraint: name_scope_key is NULL when
    // deleted_at is set, which is the whole point of the generated column.
    [$shelf, $admin] = unitsFix('dong-thap-units-freed');
    unitsRow($shelf, 1, 'Giáo họ A')->delete();

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units", ['level' => 1, 'name' => 'Giáo họ A'])
        ->assertSessionHasNoErrors();
});

it('a parent that is not a live level-1 unit is parish_unit_l1_not_found', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-parent');
    $retired = unitsRow($shelf, 1, 'Giáo họ Cũ');
    $retired->delete();

    // A retired parent, refused: adding a child to a unit that has stopped
    // being offered creates precisely the orphan hasVisibleLevel2 defends
    // against.
    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units", [
            'level' => 2, 'parent_id' => $retired->id, 'name' => 'Tổ 1',
        ])
        ->assertSessionHasErrors(['rule' => __('rules.parish_unit_l1_not_found')]);

    // And a level-2 unit offered as a parent — the case the table's own
    // CHECK constraint does NOT catch, which is why the command checks it.
    $level1 = unitsRow($shelf, 1, 'Giáo họ A');
    $level2 = unitsRow($shelf, 2, 'Tổ 1', $level1->id);

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units", [
            'level' => 2, 'parent_id' => $level2->id, 'name' => 'Tổ 2',
        ])
        ->assertSessionHasErrors(['rule' => __('rules.parish_unit_l1_not_found')]);
});

it('renames a unit and writes both names, leaving sort_order and parent alone', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-rename');
    $parent = unitsRow($shelf, 1, 'Giáo họ A');
    $unit = unitsRow($shelf, 2, 'Tổ 1', $parent->id, 7);

    $this->actingAs($admin)
        ->patch("/shelves/{$shelf->slug}/manage/units/{$unit->id}", ['name' => 'Tổ Một'])
        ->assertSessionHas('success', __('rules.parish_unit_renamed_flash'));

    app(TenantContext::class)->actSystemWide();

    $after = ParishUnit::query()->find($unit->id);
    expect($after?->name)->toBe('Tổ Một')
        // A whole-row rewrite would discard a concurrent reorder committed
        // between this command's read and its write.
        ->and((int) $after?->sort_order)->toBe(7)
        ->and($after?->parent_id)->toBe($parent->id);

    $row = AuditLog::query()->where('action', 'parish_unit.renamed')->sole();
    expect($row->before)->toBe(['name' => 'Tổ 1'])
        ->and($row->after)->toBe(['name' => 'Tổ Một']);
});

it('deleting a level-1 unit cascades to its live children and audits one row per deleted row', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-delete');
    $parent = unitsRow($shelf, 1, 'Giáo họ A');
    $childOne = unitsRow($shelf, 2, 'Tổ 1', $parent->id);
    $childTwo = unitsRow($shelf, 2, 'Tổ 2', $parent->id);
    // Another parent's child, untouched: the cascade is this unit's own.
    $other = unitsRow($shelf, 1, 'Giáo họ B');
    $otherChild = unitsRow($shelf, 2, 'Tổ 3', $other->id);

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/{$parent->id}/delete")
        ->assertSessionHas('success', __('rules.parish_unit_deleted_flash'));

    app(TenantContext::class)->actSystemWide();

    // Read back through the query, NEVER through fresh(): fresh() does not
    // return null for a soft-deleted row, so an assertion written that way
    // passes whether or not anything was deleted.
    expect(ParishUnit::query()->find($parent->id))->toBeNull()
        ->and(ParishUnit::query()->find($childOne->id))->toBeNull()
        ->and(ParishUnit::query()->find($childTwo->id))->toBeNull()
        ->and(ParishUnit::query()->find($otherChild->id))->not->toBeNull();

    // Spec D6: THREE rows, not one. One row saying "deleted a unit" would
    // hide that two sub-units went with the click.
    $rows = AuditLog::query()->where('action', 'parish_unit.deleted')->get();
    expect($rows)->toHaveCount(3);

    $byEntity = $rows->keyBy('entity_id');
    expect($byEntity[$parent->id]->after['cascaded'])->toBeFalse()
        ->and($byEntity[$childOne->id]->after['cascaded'])->toBeTrue()
        ->and($byEntity[$childTwo->id]->after['cascaded'])->toBeTrue()
        // Every row carries the same instant, which is what makes "these
        // went together" readable off the log.
        ->and($byEntity[$childOne->id]->after['deleted_at'])
        ->toBe($byEntity[$parent->id]->after['deleted_at'])
        ->and($byEntity[$parent->id]->before)->toBe(['name' => 'Giáo họ A', 'deleted_at' => null]);
});

it('reordering groups by the real parent_id, on a shelf whose nesting is switched off', function () {
    // THE FALSIFICATION THIS TASK WAS REQUIRED TO RUN, and the shelf shape
    // it needs: `nested` is FALSE while the level-2 units still carry the
    // parent_id they were created with, because UpdateParishTaxonomy never
    // rewrites a unit row. The screen therefore renders them as one flat
    // list, and the group it must post is each unit's REAL sibling set.
    //
    // Grouping by the flat display list instead posts [Tổ 1, Tổ 2, Tổ 3]
    // as one group; ReorderParishUnits' "share one level and one parent"
    // check refuses it, and every click on a shelf shaped like this
    // answers validation_failed. That is the reference's own review
    // finding, on its seeded shelf.
    [$shelf, $admin] = unitsFix('dong-thap-units-flat', ['levels' => 2, 'nested' => false]);
    $a = unitsRow($shelf, 1, 'Giáo họ A');
    $b = unitsRow($shelf, 1, 'Giáo họ B');
    $one = unitsRow($shelf, 2, 'Tổ 1', $a->id, 1);
    $two = unitsRow($shelf, 2, 'Tổ 2', $a->id, 2);
    // A third level-2 unit that shares the flat LIST and not the parent.
    $three = unitsRow($shelf, 2, 'Tổ 3', $b->id, 1);

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", [
            'unit_ids' => [$two->id, $one->id],
        ])
        ->assertSessionHasNoErrors()
        ->assertSessionHas('success', __('rules.parish_unit_reordered_flash'));

    app(TenantContext::class)->actSystemWide();

    expect((int) ParishUnit::query()->find($two->id)?->sort_order)->toBe(1)
        ->and((int) ParishUnit::query()->find($one->id)?->sort_order)->toBe(2)
        ->and((int) ParishUnit::query()->find($three->id)?->sort_order)->toBe(1);

    // The mutation this test exists to catch, stated as its own assertion:
    // the flat display list is NOT a sibling group, and posting it is
    // refused.
    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", [
            'unit_ids' => [$one->id, $two->id, $three->id],
        ])
        ->assertSessionHasErrors(['rule' => __('rules.validation_failed')]);

    // AND THE HALF NO SERVER TEST CAN SEE. The two assertions above prove
    // the SERVER's rule; neither can tell whether the screen builds the
    // right group, because the posts above are hand-written. The defect
    // this whole test is named for lives in the component — the reference's
    // review found it there, on a shelf shaped exactly like this fixture —
    // so the flat branch's grouping is pinned by a comment-stripped source
    // read (tests/Pest.php's screenSource; the page explains this rule in a
    // docblock that names `parentId`, and a grep over the raw file would be
    // satisfied by the prose alone).
    //
    // THE ASSERTION IS THE PROP WIRING, NOT THE EXPRESSION. Asserting
    // `level2ByParent.get(unit.parentId)` alone was the first version and it
    // was WORTHLESS: the loop three hundred lines above that BUILDS the map
    // contains that same call, so the needle was satisfied with the flat
    // branch rewritten to `siblings={level2}` — measured, it stayed green.
    // Naming the `siblings=` prop is what ties the group to the control that
    // posts it. The nested branch reads `.get(unit.id)` — a PARENT's
    // children — so this needle also cannot be satisfied by that one.
    //
    // Whitespace stripped before matching, so the assertion survives Biome
    // deciding to wrap the attribute: what is pinned is which expression
    // reaches the prop, never how it is laid out.
    $source = preg_replace('/\s+/', '', screenSource('manage/units.tsx'));

    expect($source)->toContain('siblings={level2ByParent.get(unit.parentId)??[unit]}');
});

it('a partial sibling list is refused rather than silently tying the ranks', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-partial');
    $a = unitsRow($shelf, 1, 'Giáo họ A', null, 1);
    $b = unitsRow($shelf, 1, 'Giáo họ B', null, 2);
    $c = unitsRow($shelf, 1, 'Giáo họ C', null, 3);

    // [C, A] over three units yields C=1, A=2, B=2 — a tie, and
    // ParishUnits::options breaks ties by name, so the shelf silently falls
    // back to name ordering: the very thing sort_order exists to escape,
    // arrived at by a command reporting success.
    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", ['unit_ids' => [$c->id, $a->id]])
        ->assertSessionHasErrors(['rule' => __('rules.validation_failed')]);

    app(TenantContext::class)->actSystemWide();
    expect((int) ParishUnit::query()->find($a->id)?->sort_order)->toBe(1)
        ->and((int) ParishUnit::query()->find($b->id)?->sort_order)->toBe(2)
        ->and((int) ParishUnit::query()->find($c->id)?->sort_order)->toBe(3);
});

it('a reorder that moves nothing writes no audit row at all', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-noop');
    $a = unitsRow($shelf, 1, 'Giáo họ A', null, 1);
    $b = unitsRow($shelf, 1, 'Giáo họ B', null, 2);

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", ['unit_ids' => [$a->id, $b->id]])
        ->assertSessionHasNoErrors();

    app(TenantContext::class)->actSystemWide();
    // An entry claiming a change nobody made is what empty_proposal exists
    // to prevent elsewhere; dragging a row and dropping it back is not an
    // error, and it is not news either.
    expect(AuditLog::query()->where('action', 'parish_unit.reordered')->count())->toBe(0);
});

it('an id in the reorder list that names no live unit is a not-found refusal', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-missing');
    $a = unitsRow($shelf, 1, 'Giáo họ A', null, 1);

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", [
            'unit_ids' => [$a->id, '00000000-0000-4000-8000-000000000000'],
        ])
        ->assertSessionHasErrors(['rule' => __('rules.parish_unit_l1_not_found')]);
});

it('a manager sees the screen and is refused every write on it', function () {
    // The other half of rule 1: the screen hides the controls, and the
    // server refuses them anyway. 404 rather than 403 — every Form Request
    // under manage/ answers a denial that way (BR §5.4), and
    // ParishUnitPolicy's denyAsNotFound() agrees with them.
    [$shelf, , $manager] = unitsFix('dong-thap-units-manager');
    $unit = unitsRow($shelf, 1, 'Giáo họ A');

    $this->actingAs($manager)->get("/shelves/{$shelf->slug}/manage/units")->assertOk();

    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/units", ['level' => 1, 'name' => 'Giáo họ B'])
        ->assertNotFound();
    $this->actingAs($manager)
        ->patch("/shelves/{$shelf->slug}/manage/units/{$unit->id}", ['name' => 'Giáo họ C'])
        ->assertNotFound();
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/units/{$unit->id}/delete")
        ->assertNotFound();
    $this->actingAs($manager)
        ->post("/shelves/{$shelf->slug}/manage/units/reorder", ['unit_ids' => [$unit->id]])
        ->assertNotFound();

    app(TenantContext::class)->actSystemWide();
    expect(ParishUnit::query()->find($unit->id)?->name)->toBe('Giáo họ A')
        ->and(ParishUnit::query()->count())->toBe(1);
});

it('a reader cannot reach the screen at all, and meets 404 rather than 403', function () {
    [$shelf] = unitsFix('dong-thap-units-reader');
    $reader = User::factory()->create();
    Membership::factory()->for($shelf)->create([
        'user_id' => $reader->id, 'role' => 'reader', 'status' => 'active',
    ]);

    $this->actingAs($reader)->get("/shelves/{$shelf->slug}/manage/units")->assertNotFound();
});

it('another shelf\'s unit id under this shelf\'s url resolves to nothing', function () {
    // The binding's two layers, measured: Bookshelf::parishUnits() under
    // the outer group's scopeBindings(), and BookshelfScope on ParishUnit.
    [$shelfA, $admin] = unitsFix('dong-thap-units-a');
    [$shelfB] = unitsFix('dong-thap-units-b');

    app(TenantContext::class)->actSystemWide();
    $foreign = unitsRow($shelfB, 1, 'Giáo họ Của Tủ Khác');

    $this->actingAs($admin)
        ->patch("/shelves/{$shelfA->slug}/manage/units/{$foreign->id}", ['name' => 'Đổi'])
        ->assertNotFound();
    $this->actingAs($admin)
        ->post("/shelves/{$shelfA->slug}/manage/units/{$foreign->id}/delete")
        ->assertNotFound();

    app(TenantContext::class)->actSystemWide();
    expect(ParishUnit::query()->find($foreign->id)?->name)->toBe('Giáo họ Của Tủ Khác');
});

it('a retired unit does not resolve, so a second delete is a 404 and not a silent pass', function () {
    [$shelf, $admin] = unitsFix('dong-thap-units-gone');
    $unit = unitsRow($shelf, 1, 'Giáo họ A');
    $unit->delete();

    $this->actingAs($admin)
        ->post("/shelves/{$shelf->slug}/manage/units/{$unit->id}/delete")
        ->assertNotFound();
});

it('the four sentences read as sentences, through the public sentence() frame', function () {
    // AuditSentences::phrase() is PRIVATE — measured by an earlier task —
    // so every assertion here goes through sentence($action, $facts) and
    // its ':actor đã :phrase' frame.
    $facts = fn (?array $before, ?array $after): array => [
        'actor' => 'Trần Quản Trị', 'subject' => null, 'before' => $before, 'after' => $after,
    ];

    expect(AuditSentences::sentence('parish_unit.created', $facts(null, ['name' => 'Tổ 1'])))
        ->toBe('Trần Quản Trị đã thêm đơn vị Tổ 1')
        // The bare twin: a payload is data, and a row that lost its name
        // must still render a sentence rather than an unsubstituted :name.
        ->and(AuditSentences::sentence('parish_unit.created', $facts(null, [])))
        ->toBe('Trần Quản Trị đã thêm một đơn vị')
        ->and(AuditSentences::sentence('parish_unit.renamed', $facts(['name' => 'Tổ 1'], ['name' => 'Tổ Một'])))
        ->toBe('Trần Quản Trị đã đổi tên đơn vị Tổ 1 thành Tổ Một')
        ->and(AuditSentences::sentence('parish_unit.deleted', $facts(['name' => 'Tổ 1'], ['cascaded' => false])))
        ->toBe('Trần Quản Trị đã xoá đơn vị Tổ 1')
        // The cascade tail is where a reader of ONE row learns it was not
        // clicked — the fact `cascaded` rides on the payload to carry.
        ->and(AuditSentences::sentence('parish_unit.deleted', $facts(['name' => 'Tổ 1'], ['cascaded' => true])))
        ->toBe('Trần Quản Trị đã xoá đơn vị Tổ 1 theo đơn vị cấp trên')
        ->and(AuditSentences::sentence('parish_unit.reordered', $facts(['sort_order' => 2], ['sort_order' => 1])))
        ->toBe('Trần Quản Trị đã đổi thứ tự các đơn vị');
});
