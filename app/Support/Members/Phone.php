<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;

/**
 * QA remediation T18's phone rule, ported whole: 9–11 digits after
 * stripping spaces, dots and dashes, optionally +84-prefixed — the shape
 * read off the seed and the live dev database, not assumed. `khong-phai-so`
 * typed into a phone box must be a sentence, never a tel: link to nowhere.
 *
 * Every caller is responsible for its own blank check first: null means
 * "no phone on file", not "an invalid one" — Registration refuses a blank
 * phone only when no reason accompanies it (thieu-so-dien-thoai), and calls
 * assert() only once it has decided the phone is not blank.
 */
final class Phone
{
    /**
     * The HTML pattern mirror — a generous approximation (pattern cannot
     * express "strip separators, then count"), a hint that saves a round
     * trip; assert() is what decides.
     */
    public const string PATTERN = '[+0-9][0-9 .-]{7,13}';

    public static function isValid(string $phone): bool
    {
        $stripped = preg_replace('/[\s.\-]/u', '', trim($phone)) ?? '';

        return preg_match('/^(\+84)?\d{9,11}$/', $stripped) === 1;
    }

    public static function assert(string $phone): void
    {
        if (! self::isValid($phone)) {
            throw new RuleViolated('phone_invalid');
        }
    }
}
