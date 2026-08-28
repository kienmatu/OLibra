<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;

/**
 * INV-13's application half: the ONE list of a person's verified details,
 * so the two sanctioned write paths — UpdateReaderProfile now, Phase 3's
 * ApproveProfileChange later — can never disagree about which fields
 * exist. Data, not a chain of ifs (profile-fields.ts's argument, kept).
 *
 * NOT in the list, deliberately: username/password_hash (INV-14's pair,
 * SetReaderCredentials' own act with its own audit rules), is_super_admin
 * (a grant, not a fact about a person), display_name/locale (written by
 * nothing in the domain).
 */
final class ProfileFields
{
    /** @var list<string> the nine columns, spelled as the database spells them */
    public const array FIELDS = [
        'saint_name', 'full_name', 'date_of_birth', 'father_name',
        'mother_name', 'phone', 'phone_missing_reason', 'email', 'avatar_object',
    ];

    /** @var list<string> the four NOT NULL columns — blanking one is a named refusal, not a driver error */
    public const array REQUIRED = ['saint_name', 'full_name', 'father_name', 'mother_name'];

    /**
     * Exactly the allowlisted keys a caller named, blank folded to null,
     * with the three shape rules enforced: a required field cannot blank,
     * a date must be a real Y-m-d day, a non-blank phone must have QA
     * T18's shape.
     *
     * Key presence, not null-vs-value, is what "named" means here: a key
     * absent from $fields is skipped entirely (left out of the returned
     * patch, meaning "leave alone" to every caller), while a key present
     * with any value — including an empty string or an explicit null —
     * is folded and validated. Conflating the two would make an absent
     * key silently wipe a field, or a present blank silently do nothing.
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, ?string>
     */
    public static function normalisePatch(array $fields): array
    {
        $patch = [];

        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $fields)) {
                continue;
            }

            $value = $fields[$field];
            $value = is_string($value) && trim($value) !== '' ? trim($value) : null;

            if ($value === null && in_array($field, self::REQUIRED, true)) {
                throw new RuleViolated('required_fields_missing');
            }

            if ($field === 'date_of_birth' && $value !== null) {
                if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) !== 1
                    || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
                    throw new RuleViolated('validation_failed');
                }
            }

            if ($field === 'phone' && $value !== null) {
                Phone::assert($value);
            }

            $patch[$field] = $value;
        }

        return $patch;
    }

    /**
     * Only the keys whose values actually differ — an audit entry is a
     * claim about what changed, and six identical fields on both sides
     * would make it a lie of emphasis.
     *
     * @param  array<string, ?string>  $before
     * @param  array<string, ?string>  $after
     * @return array{before: array<string, ?string>, after: array<string, ?string>, changed: list<string>}
     */
    public static function diff(array $before, array $after): array
    {
        $changed = [];

        foreach ($after as $field => $value) {
            if (($before[$field] ?? null) !== $value) {
                $changed[] = $field;
            }
        }

        return [
            'before' => array_intersect_key($before, array_flip($changed)),
            'after' => array_intersect_key($after, array_flip($changed)),
            'changed' => $changed,
        ];
    }
}
