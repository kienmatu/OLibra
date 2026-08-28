<?php

use App\Support\Members\ParishTaxonomy;
use App\Support\Members\ParishUnits;

function ptUnit(string $id, int $level, ?string $parentId = null, string $name = 'Tổ 1', int $sort = 0, ?string $deletedAt = null): array
{
    return ['id' => $id, 'level' => $level, 'parentId' => $parentId, 'name' => $name, 'sortOrder' => $sort, 'deletedAt' => $deletedAt];
}

it('defaults to one level labelled Tổ, not nested', function () {
    $t = ParishTaxonomy::default();

    expect($t->levels)->toBe(1)
        ->and($t->nested)->toBeFalse()
        ->and($t->level1Label)->toBe('Tổ');
});

it('reads settings defensively, falling back per-field', function () {
    $t = ParishTaxonomy::fromSettings(['levels' => 2, 'nested' => true, 'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ']);
    expect($t->levels)->toBe(2)->and($t->nested)->toBeTrue()
        ->and($t->level1Label)->toBe('Giáo họ')->and($t->level2Label)->toBe('Tổ');

    // levels 3, a blank label, a non-array — each falls back rather than
    // throwing: a registration must not fail on a malformed settings blob.
    expect(ParishTaxonomy::fromSettings(['levels' => 3])->levels)->toBe(1)
        ->and(ParishTaxonomy::fromSettings(['level1_label' => '  '])->level1Label)->toBe('Tổ')
        ->and(ParishTaxonomy::fromSettings('junk')->levels)->toBe(1)
        ->and(ParishTaxonomy::fromSettings(null)->levels)->toBe(1);
});

it('options orders by sortOrder then Vietnamese name, and never offers a deleted unit', function () {
    $units = [
        ptUnit('b', 1, null, 'Tổ 2', 1),
        ptUnit('a', 1, null, 'Tổ 1', 0),
        ptUnit('gone', 1, null, 'Tổ 0', 0, '2026-01-01T00:00:00Z'),
        // Same sortOrder as 'a': the name decides, in vi collation.
        ptUnit('d', 1, null, 'Tổ Đức Mẹ', 0),
    ];

    expect(array_column(ParishUnits::options($units, 1), 'id'))->toBe(['a', 'd', 'b']);
});

it('options distinguishes no-parent-filter, parent-is-null, and children-of', function () {
    $units = [
        ptUnit('p', 1, null, 'Giáo họ'),
        ptUnit('c1', 2, 'p', 'Tổ 1'),
        ptUnit('c2', 2, null, 'Tổ lẻ'),
    ];

    expect(array_column(ParishUnits::options($units, 2), 'id'))->toBe(['c1', 'c2'])
        ->and(array_column(ParishUnits::options($units, 2, null), 'id'))->toBe(['c2'])
        ->and(array_column(ParishUnits::options($units, 2, 'p'), 'id'))->toBe(['c1']);
});

it('validateSelection enforces existence, level, and nesting — and only nesting when nested', function () {
    $nested = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $flat = new ParishTaxonomy(2, false, 'Giáo họ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('p2', 1), ptUnit('c1', 2, 'p1')];

    expect(ParishUnits::validateSelection($nested, $units, null, null))->toBeNull()
        ->and(ParishUnits::validateSelection($nested, $units, 'p1', 'c1'))->toBeNull()
        ->and(ParishUnits::validateSelection($nested, $units, 'missing', null))->toBe('parish_unit_l1_not_found')
        // A level-2 id in the level-1 slot is not-found, not borrowed.
        ->and(ParishUnits::validateSelection($nested, $units, 'c1', null))->toBe('parish_unit_l1_not_found')
        ->and(ParishUnits::validateSelection($nested, $units, 'p1', 'missing'))->toBe('parish_unit_l2_not_found')
        ->and(ParishUnits::validateSelection($nested, $units, 'p2', 'c1'))->toBe('parish_unit_l2_not_in_l1')
        // Not nested: no relationship checked at all.
        ->and(ParishUnits::validateSelection($flat, $units, 'p2', 'c1'))->toBeNull();
});

it('a deleted unit still validates — a recorded parish is history, not an error', function () {
    $t = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('c1', 2, 'p1', 'Tổ 1', 0, '2026-01-01T00:00:00Z')];

    expect(ParishUnits::validateSelection($t, $units, 'p1', 'c1'))->toBeNull();
});

it('nested=true while levels=1 is ignored, not an error', function () {
    // Design §3.2: dropping to one level keeps `nested` for a later return;
    // a leftover l2 selection must not be checked against a level that no
    // longer renders.
    $t = new ParishTaxonomy(1, true, 'Tổ', 'Tổ');
    $units = [ptUnit('p1', 1), ptUnit('c1', 2, 'p2-gone')];

    expect(ParishUnits::validateSelection($t, $units, 'p1', 'c1'))->toBeNull();
});

it('describeSelection writes smaller unit first with the shelf\'s own separator, and suppresses level 2 at one level', function () {
    $two = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $one = new ParishTaxonomy(1, false, 'Tổ', 'Tổ');
    $units = [ptUnit('p1', 1, null, 'Giáo họ Thánh Tâm'), ptUnit('c1', 2, 'p1', 'Tổ 3')];

    expect(ParishUnits::describeSelection($two, $units, 'p1', 'c1'))->toBe('Tổ 3 · Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($two, $units, 'p1', null))->toBe('Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($one, $units, 'p1', 'c1'))->toBe('Giáo họ Thánh Tâm')
        ->and(ParishUnits::describeSelection($two, $units, null, null))->toBe('');
});

it('unitName answers Chưa có for nothing, and looks up deleted units too', function () {
    $units = [ptUnit('gone', 1, null, 'Tổ Cũ', 0, '2026-01-01T00:00:00Z')];

    expect(ParishUnits::unitName($units, null))->toBe('Chưa có')
        ->and(ParishUnits::unitName($units, 'missing'))->toBe('Chưa có')
        ->and(ParishUnits::unitName($units, 'gone'))->toBe('Tổ Cũ');
});

it('hasVisibleLevel2 requires a live parent when nested', function () {
    $nested = new ParishTaxonomy(2, true, 'Giáo họ', 'Tổ');
    $orphaned = [
        ptUnit('p1', 1, null, 'Giáo họ', 0, '2026-01-01T00:00:00Z'),
        ptUnit('c1', 2, 'p1'),
    ];
    $live = [ptUnit('p1', 1), ptUnit('c1', 2, 'p1')];

    expect(ParishUnits::hasVisibleLevel2($nested, $orphaned))->toBeFalse()
        ->and(ParishUnits::hasVisibleLevel2($nested, $live))->toBeTrue()
        ->and(ParishUnits::hasVisibleLevel2(ParishTaxonomy::default(), $live))->toBeFalse();
});
