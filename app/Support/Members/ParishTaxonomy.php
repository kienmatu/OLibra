<?php

declare(strict_types=1);

namespace App\Support\Members;

/**
 * How a parish subdivides its people, configurable per shelf (BR §5.6) —
 * the PHP form of parish-taxonomy.ts's ParishTaxonomy plus
 * parish-context.ts's defensive toTaxonomy(). The stored shape under
 * bookshelves.settings['parish_taxonomy'] is snake_case (levels, nested,
 * level1_label, level2_label); this class is the one place that spelling
 * is translated.
 */
final readonly class ParishTaxonomy
{
    public function __construct(
        public int $levels,
        public bool $nested,
        public string $level1Label,
        public string $level2Label,
    ) {}

    /** One level, "Tổ", not nested — what a brand-new shelf gets. */
    public static function default(): self
    {
        return new self(1, false, 'Tổ', 'Tổ');
    }

    /**
     * Defensive per-field fallback: settings is free-form JSON with no
     * constraint behind it, and a registration must not fail because the
     * blob is malformed (BR §5.6).
     */
    public static function fromSettings(mixed $raw): self
    {
        $fallback = self::default();

        if (! is_array($raw) && ! $raw instanceof \ArrayAccess) {
            return $fallback;
        }

        $label = function (mixed $v, string $or): string {
            return is_string($v) && trim($v) !== '' ? $v : $or;
        };

        return new self(
            ($raw['levels'] ?? null) === 2 ? 2 : 1,
            ($raw['nested'] ?? null) === true,
            $label($raw['level1_label'] ?? null, $fallback->level1Label),
            $label($raw['level2_label'] ?? null, $fallback->level2Label),
        );
    }
}
