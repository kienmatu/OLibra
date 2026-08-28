<?php

use App\Models\Bookshelf;
use App\Models\ParishUnit;
use App\Queries\ParishContextQuery;
use Tests\Support\TenantHarness;

it('reads the bound shelf\'s taxonomy and every unit, soft-deleted included', function () {
    $shelf = Bookshelf::factory()->create([
        'slug' => 'dong-thap',
        'settings' => ['parish_taxonomy' => ['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']],
    ]);
    $parent = ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Thánh Tâm']);
    ParishUnit::factory()->for($shelf)->create(['level' => 2, 'parent_id' => $parent->id, 'name' => 'Tổ 3']);
    ParishUnit::factory()->for($shelf)->create(['level' => 1, 'name' => 'Giáo họ Cũ'])->delete();

    TenantHarness::actAs($shelf);
    $context = app(ParishContextQuery::class)->run();

    expect($context['taxonomy']->level1Label)->toBe('Giáo họ')
        ->and($context['taxonomy']->nested)->toBeTrue()
        ->and($context['units'])->toHaveCount(3)
        ->and(collect($context['units'])->firstWhere('name', 'Giáo họ Cũ')['deletedAt'])->not->toBeNull();
});

it('a shelf with no taxonomy configured gets the default, and another shelf\'s units never appear', function () {
    $shelves = TenantHarness::twoCollidingShelves();

    TenantHarness::actAs($shelves['a']);
    $context = app(ParishContextQuery::class)->run();

    // The harness seeds one colliding 'Giáo họ Trung Tâm' per shelf; the
    // bound shelf sees exactly its own one.
    expect($context['taxonomy']->levels)->toBe(1)
        ->and($context['taxonomy']->level1Label)->toBe('Tổ')
        ->and($context['units'])->toHaveCount(1);
});
