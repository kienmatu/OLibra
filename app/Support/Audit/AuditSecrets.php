<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Exceptions\RuleViolated;

/**
 * BR §14: "Passwords and session tokens are never captured." The
 * reference enforced it as a walk over every payload before insert
 * (old_next/src/domain/kernel/audit.ts) after a live audit found three
 * gaps its first list missed (api_key-shaped columns, salt, otp); this
 * is that walk, ported the day the log becomes a rendered and exported
 * surface. Tokens are matched whole within snake/camel splits — 'key'
 * catches api_key and never monkey; DATABASE.md records avatar_object
 * being NAMED around this exact list.
 *
 * The refusal deliberately names neither the field nor the value: the
 * point is that neither belongs anywhere a log line might surface it.
 */
final class AuditSecrets
{
    private const array FORBIDDEN = [
        'password', 'hash', 'pwd', 'token', 'session', 'secret',
        'khau', 'key', 'salt', 'otp',
        // 'khau': mat_khau splits to [mat, khau]; 'mat' alone is too
        // common a Vietnamese syllable to forbid, 'khau' in a column name
        // occurs only in mat_khau. The reference matched the joined form;
        // token-splitting here needs the second half.
    ];

    /** Metadata ABOUT a secret, never the secret — BR §2's own permitted record shape. */
    private const array ALLOWED = [
        'password_changed_at', 'password_set_at', 'has_password', 'session_count',
    ];

    /**
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     */
    public static function assertNoSecrets(?array $before, ?array $after): void
    {
        foreach ([$before, $after] as $bag) {
            if ($bag !== null) {
                self::walk($bag, 0);
            }
        }
    }

    /**
     * @param  array<array-key, mixed>  $bag
     *
     * The reference throws past this depth (audit.ts's own bound); the
     * first port of this walk instead returned quietly, which is a
     * fail-OPEN guard standing in front of a fail-CLOSED one — a payload
     * seven arrays deep, or a five-hop object chain (now folded into this
     * same array depth by toWalkable() below), sailed through the guard
     * while json_encode() still persisted whatever forbidden key was
     * waiting at the bottom. Refusing matches the reference and matches
     * every other bound this file documents: depth 6 and the ALLOWED list
     * are both "nothing shipped nests this deep/needs this" claims, and a
     * claim that turns out wrong should stop the write, not silently keep
     * only the shallow six levels safe.
     */
    private static function walk(array $bag, int $depth): void
    {
        if ($depth > 6) {
            throw new RuleViolated('audit_nesting_too_deep');
        }
        foreach ($bag as $key => $value) {
            if (is_string($key) && self::isForbiddenKey($key)) {
                throw new RuleViolated('audit_forbidden_field');
            }
            $value = self::toWalkable($value);
            if (is_array($value)) {
                self::walk($value, $depth + 1);
            }
        }
    }

    /**
     * Reduces an object VALUE to the array the walk can descend into — by
     * asking the actual serializer what it will do, rather than
     * reimplementing its rules one special case at a time.
     *
     * The first fix here called jsonSerialize() for a JsonSerializable and
     * get_object_vars() otherwise, reasoning from PHP's *documented*
     * json_encode() rules. That missed a THIRD rule that isn't in the
     * interface at all: json_encode()'s C implementation hard-codes
     * ArrayObject and ArrayIterator as special cases and serialises their
     * internal storage directly — they don't implement JsonSerializable,
     * so the walk fell through to get_object_vars(), which sees `[]`
     * because their storage is private to the engine, not a public
     * property. `json_encode(new ArrayObject(['password_hash' => 'x']))`
     * emits `{"password_hash":"x"}` while the old toWalkable() emitted
     * `[]` and let it through. Enumerating that as a fourth case would
     * only be this same bug with a due date: the encoder is free to grow a
     * fifth special case tomorrow.
     *
     * So this asks json_encode() itself, once, and decodes the answer:
     * whatever produces the row's actual persisted JSON also decides what
     * the walk inspects, by construction, for every case the encoder
     * knows about — documented interface, hard-coded special case, or a
     * future one neither of us has seen yet. It also replaces the old
     * 4-hop object cap: json_encode() recurses through an entire nested
     * object graph in one native call, so the walk's own array-depth cap
     * below is now the ONLY depth boundary in this file, not a second one
     * with a different failure mode.
     */
    private static function toWalkable(mixed $value): mixed
    {
        if (! is_object($value)) {
            return $value;
        }

        $encoded = json_encode($value);
        if ($encoded === false) {
            // Encoding failed (e.g. a circular reference) — the row could
            // never have been persisted as-is either, so refuse the same
            // way an over-deep payload does rather than pass a value the
            // walk could not actually inspect.
            throw new RuleViolated('audit_nesting_too_deep');
        }

        $decoded = json_decode($encoded, true);

        return is_array($decoded) ? $decoded : [];
    }

    private static function isForbiddenKey(string $key): bool
    {
        if (in_array(strtolower($key), self::ALLOWED, true)) {
            return false;
        }
        // snake_case and camelCase both split to whole tokens: api_key →
        // [api, key]; passwordHash → [password, hash]; monkey → [monkey].
        $tokens = preg_split('/[_\W]+|(?<=[a-z0-9])(?=[A-Z])/', $key, -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return array_intersect(array_map(strtolower(...), $tokens), self::FORBIDDEN) !== [];
    }
}
