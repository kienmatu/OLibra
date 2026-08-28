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
        return preg_match('/^(\+84)?\d{9,11}$/', self::stripSeparators($phone)) === 1;
    }

    public static function assert(string $phone): void
    {
        if (! self::isValid($phone)) {
            throw new RuleViolated('phone_invalid');
        }
    }

    /**
     * A canonical form for EQUALITY, not for validity — two spellings of
     * the same phone hash to the same value. Fix round, Task 13: the
     * `register` rate limiter (`AppServiceProvider::boot()`) hashed the
     * raw trimmed phone string as its day-budget key, so
     * `0912345678`, `0912 345 678`, `0912.345.678`, `0912-345-678` and
     * `+84912345678` — every one of them the SAME real phone, and every
     * one of them accepted by isValid() above — each got its own 20/day
     * bucket. Six spellings is a 120/day budget wearing a 20/day label.
     *
     * Shares stripSeparators() with isValid() so the whitespace/dot/hyphen
     * rule cannot drift between "is this shaped like a phone" and "which
     * bucket does it hash to" — but isValid()'s own regex is deliberately
     * left untouched here: it already accepts EITHER spelling (a bare
     * `0`-led number, or a `+84`-led one) via `(\+84)?`, and widening that
     * regex's accepted digit-count range to fold `+84` into `0` at the
     * validity boundary risks accepting shapes it was never meant to
     * (verified by hand, not asserted at review time: a `0`-led number is
     * 9-11 raw digits; a `+84`-led one becomes 10-12 once folded to a
     * leading `0`, a DIFFERENT length band). Only this method, used
     * exclusively for the throttle key (never for validity), converts a
     * leading `+84` to a leading `0`: Vietnam's own +84 mobile
     * country-code convention replaces the domestic leading `0`, so
     * `+84912345678` and `0912345678` are the identical subscriber number
     * once that swap is made — not merely two strings preg_match happens
     * to both accept.
     */
    public static function normalise(string $phone): string
    {
        $stripped = self::stripSeparators($phone);

        return preg_replace('/^\+84/', '0', $stripped) ?? $stripped;
    }

    private static function stripSeparators(string $phone): string
    {
        return preg_replace('/[\s.\-]/u', '', trim($phone)) ?? '';
    }
}
