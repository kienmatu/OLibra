<?php

declare(strict_types=1);

namespace App\Support\Exports;

/**
 * The domain rows meet the words — port of old_next/src/lib/exports.ts.
 * Dates ISO (02/04/2015 is April in Vietnam and February in a US-locale
 * Excel, silently), numbers bare digits (vi-VN's "2.016" reads as
 * two-point-oh-one-six), null an EMPTY cell (a dash is a value that
 * sorts and filters like one), booleans "Có"/"Không" (TRUE displays in
 * English in a Vietnamese Excel).
 */
final class ExportTables
{
    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function books(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['books_headers'],
            'rows' => array_map(fn (array $r): array => [
                (string) $r['title'],
                self::cell($r['author']),
                self::cell($r['category']),
                self::cell($r['publisher']),
                self::num($r['publishedYear']),
                self::cell($r['isbn']),
                self::num($r['pageCount']),
                $r['isPublished'] ? $w['yes'] : $w['no'],
                (string) $r['copyCode'],
                self::word($w['copy_state'], $r['state']),
                self::word($w['condition'], $r['condition']),
                self::cell($r['acquiredOn']),
                self::cell($r['acquiredFrom']),
            ], $rows),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function readers(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['readers_headers'],
            'rows' => array_map(fn (array $r): array => [
                self::cell($r['saintName']),
                (string) $r['fullName'],
                self::cell($r['dateOfBirth']),
                self::cell($r['fatherName']),
                self::cell($r['motherName']),
                self::cell($r['phone']),
                self::cell($r['email']),
                (string) $r['parishLine'],
                self::word($w['membership_status'], $r['status']),
                self::word($w['role'], $r['role']),
                $r['hasCredentials'] ? $w['yes'] : $w['no'],
                self::cell($r['joinedOn']),
            ], $rows),
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array{headers: list<string>, rows: list<list<string>>}
     */
    public static function loans(array $rows): array
    {
        $w = self::words();

        return [
            'headers' => $w['loans_headers'],
            'rows' => array_map(fn (array $r): array => [
                (string) $r['title'],
                (string) $r['copyCode'],
                (string) $r['borrowerName'],
                self::cell($r['lentOn']),
                self::cell($r['dueOn']),
                self::cell($r['returnedOn']),
                self::word($w['loan_status'], $r['status']),
                self::word($w['condition'], $r['returnCondition']),
                self::cell($r['lentBy']),
                self::cell($r['receivedBy']),
                self::cell($r['note']),
            ], $rows),
        ];
    }

    private static function cell(mixed $value): string
    {
        return $value === null ? '' : (string) $value;
    }

    private static function num(mixed $value): string
    {
        return $value === null ? '' : (string) (int) $value;
    }

    /** @param array<string, string> $map */
    private static function word(array $map, mixed $key): string
    {
        return $key !== null && is_string($key) && array_key_exists($key, $map)
            ? $map[$key] : self::cell($key);
    }

    /** @return array<string, mixed> */
    private static function words(): array
    {
        static $words = null;

        return $words ??= require dirname(__DIR__, 3).'/lang/vi/exports.php';
    }
}
