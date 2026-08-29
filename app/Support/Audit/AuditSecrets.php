<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Exceptions\RuleViolated;
use JsonSerializable;

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

    /** @param array<array-key, mixed> $bag */
    private static function walk(array $bag, int $depth): void
    {
        if ($depth > 6) {
            return; // a payload this deep is not a diff; nothing shipped nests past 2
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
     * Reduces an object VALUE to the array the walk can descend into — the
     * same shape the 'array' cast's json_encode() will actually persist,
     * not merely what get_object_vars() can see.
     *
     * Two object shapes need different treatment, and confusing them is
     * the gap: a PLAIN object (no JsonSerializable) is serialized by
     * json_encode() using ONLY its public properties — the exact rule
     * get_object_vars() already applies from outside the class, so the two
     * agree and a private/protected field on a plain object is genuinely
     * safe here, not merely unseen.
     *
     * A JsonSerializable object is not: json_encode() calls jsonSerialize()
     * instead of reading properties at all, so it reaches private and
     * protected state get_object_vars() cannot. Every Eloquent Model
     * implements JsonSerializable — an attribute set through the magic
     * __set lives in the model's PROTECTED $attributes array, invisible to
     * get_object_vars(), but Model::jsonSerialize() (via toArray()) puts
     * it straight back into whatever this walk is trying to protect. A
     * get_object_vars-only walk (the plan review's first fix, for the
     * is_array-only bypass) verified against a real
     * `new App\Models\User` with a raw `session_id` attribute: it walked
     * to an empty array and let the model through. Calling jsonSerialize()
     * first closes that.
     *
     * Bounded to 4 hops so a JsonSerializable that hands back another
     * JsonSerializable cannot recurse without limit; nothing shipped
     * nests objects that deep.
     */
    private static function toWalkable(mixed $value): mixed
    {
        for ($hops = 0; is_object($value) && $hops < 4; $hops++) {
            $value = $value instanceof JsonSerializable
                ? $value->jsonSerialize()
                : get_object_vars($value);
        }

        return $value;
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
