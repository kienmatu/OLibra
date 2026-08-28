<?php

declare(strict_types=1);

namespace App\Support\Members;

use Collator;

/**
 * The pure unit rules of parish-taxonomy.ts, over plain array rows:
 * array{id: string, level: int, parentId: ?string, name: string,
 * sortOrder: int, deletedAt: ?string}. Framework-free so the same logic
 * backs a picker prop and the command that must not trust the picker.
 */
final class ParishUnits
{
    /**
     * Live units of a level, ordered sortOrder then Vietnamese name —
     * never a number parsed out of the name ("Tổ 10" before "Tổ 2" is the
     * carelessness sort_order exists to prevent).
     *
     * $parentId three-state, matching the reference's undefined/null/id:
     * false (default) = no parent filter; null = parent is null; an id =
     * that unit's children.
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     * @return list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>
     */
    public static function options(array $units, int $level, string|null|false $parentId = false): array
    {
        $collator = new Collator('vi');

        $filtered = array_values(array_filter(
            $units,
            fn (array $u) => $u['deletedAt'] === null
                && $u['level'] === $level
                && ($parentId === false || $u['parentId'] === $parentId),
        ));

        usort($filtered, fn (array $a, array $b) => $a['sortOrder'] <=> $b['sortOrder']
            ?: ($collator->compare($a['name'], $b['name']) ?: 0));

        return $filtered;
    }

    /**
     * BR §5.6's selection rule — null when valid, else the refusal code.
     * Deleted units still count as "exists" (a membership pointing at a
     * retired unit is history); the nesting check runs only when levels===2
     * AND nested (a leftover flag on a one-level shelf is ignored).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function validateSelection(ParishTaxonomy $taxonomy, array $units, ?string $l1, ?string $l2): ?string
    {
        $find = fn (?string $id): ?array => $id === null
            ? null
            : (collect($units)->firstWhere('id', $id) ?: null);

        if ($l1 !== null) {
            $unit = $find($l1);
            if ($unit === null || $unit['level'] !== 1) {
                return 'parish_unit_l1_not_found';
            }
        }

        if ($l2 !== null) {
            $unit = $find($l2);
            if ($unit === null || $unit['level'] !== 2) {
                return 'parish_unit_l2_not_found';
            }
        }

        if ($taxonomy->levels === 2 && $taxonomy->nested && $l1 !== null && $l2 !== null) {
            $l2Unit = $find($l2);
            if ($l2Unit !== null && $l2Unit['parentId'] !== $l1) {
                return 'parish_unit_l2_not_in_l1';
            }
        }

        return null;
    }

    /**
     * "Tổ 3 · Giáo họ Thánh Tâm", smaller unit first, "" when nothing set.
     * Looks up regardless of deletedAt; the level-2 half is suppressed when
     * the shelf runs one level (the value itself stays stored untouched).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function describeSelection(ParishTaxonomy $taxonomy, array $units, ?string $l1, ?string $l2): string
    {
        $parts = [];

        if ($taxonomy->levels === 2 && $l2 !== null) {
            $unit = collect($units)->firstWhere('id', $l2);
            if ($unit !== null) {
                $parts[] = $unit['name'];
            }
        }

        if ($l1 !== null) {
            $unit = collect($units)->firstWhere('id', $l1);
            if ($unit !== null) {
                $parts[] = $unit['name'];
            }
        }

        return implode(' · ', $parts);
    }

    /**
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function unitName(array $units, ?string $id): string
    {
        if ($id === null) {
            return 'Chưa có';
        }

        $unit = collect($units)->firstWhere('id', $id);

        return $unit['name'] ?? 'Chưa có';
    }

    /**
     * Whether a level-2 field should render at all — "no field, or a
     * usable one": when nested, a level-2 unit only counts under a LIVE
     * level-1 parent (a soft-deleted parent's orphaned children would
     * otherwise report a field that renders no options).
     *
     * @param  list<array{id: string, level: int, parentId: ?string, name: string, sortOrder: int, deletedAt: ?string}>  $units
     */
    public static function hasVisibleLevel2(ParishTaxonomy $taxonomy, array $units): bool
    {
        if ($taxonomy->levels !== 2) {
            return false;
        }

        if (! $taxonomy->nested) {
            return self::options($units, 2) !== [];
        }

        foreach (self::options($units, 1) as $parent) {
            if (self::options($units, 2, $parent['id']) !== []) {
                return true;
            }
        }

        return false;
    }
}
