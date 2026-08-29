<?php

declare(strict_types=1);

namespace App\Support\Exports;

/**
 * CSV for a volunteer opening it in Excel on Windows — port of
 * old_next/src/lib/csv.ts, whose docblocks carry the measurements. The
 * audience is the whole specification: the export exists as INSURANCE
 * (OPS §2), and insurance that reads as garbage — mojibake, #NAME?, a
 * phone column missing its first digit — is not insurance.
 *
 * Every neutralisation is VISIBLE (a leading apostrophe the volunteer
 * can see and remove), never an invisible character and never a trim:
 * the cell's own bytes are sacred; only the question "what does a
 * spreadsheet think this starts with" looks at a stripped copy.
 */
final class Csv
{
    /** EF BB BF. Double-clicked Excel decodes with the ANSI code page unless this opens the file. */
    public const string BOM = "\u{FEFF}";

    /**
     * The four characters Excel/LibreOffice treat as a formula leader.
     * `-` and `+` are also the duller, likelier case: a note written as
     * "- sách bị ướt" renders #NAME? without this.
     */
    private const array FORMULA_LEADERS = ['=', '+', '-', '@'];

    /**
     * Excel strips these before deciding whether a cell is a formula.
     *
     * ASCII whitespace plus U+00A0 (NBSP) and U+200B (ZWSP) — the reference's
     * own docblock (old_next/src/lib/csv.ts) records testing and dismissing
     * only a fullwidth equals and a Unicode minus; it never considered a
     * non-breaking or zero-width space ahead of a formula leader, and
     * neither did this port until CsvTest's NBSP/ZWSP cases. Whether Excel's
     * own CSV importer strips these before ITS formula detection is
     * UNVERIFIED here and in the reference — nobody has watched a real
     * Excel import a cell shaped like "\u{00A0}=1". Widening the strip is
     * strictly safer regardless: a cell neutralised unnecessarily only
     * gains a leading apostrophe, so the strip is widened on that argument
     * alone, not on a confirmed fact about Excel's behaviour. Do not read
     * this guard as proof Excel needs it.
     */
    private const string LEADING_SPACE = "/^[\t\r\n \x{00A0}\x{200B}]+/u";

    public static function neutralise(string $cell): string
    {
        if ($cell === '') {
            return $cell;
        }
        $leader = substr((string) preg_replace(self::LEADING_SPACE, '', $cell), 0, 1);
        if (in_array($leader, self::FORMULA_LEADERS, true)) {
            return "'".$cell;
        }
        // All-digits starting 0 — every Vietnamese phone number — imports
        // as a NUMBER and loses the zero from the file's contents, not
        // merely its display. Anchored on the raw cell on purpose.
        if (preg_match('/^0\d+$/', $cell) === 1) {
            return "'".$cell;
        }

        return $cell;
    }

    /** RFC 4180: quote when the field contains a delimiter, a quote or a newline. */
    public static function quote(string $cell): string
    {
        if (preg_match('/[",\r\n]/', $cell) === 1) {
            return '"'.str_replace('"', '""', $cell).'"';
        }

        return $cell;
    }

    /**
     * One row as bytes-on-the-wire: CRLF because RFC 4180 says so and
     * Excel itself writes it, and the trailing CRLF closes the last field.
     * Headers go through this too — an exemption granted because "these
     * ones are safe" is the exemption that outlives its reason.
     *
     * @param  list<string>  $cells
     */
    public static function line(array $cells): string
    {
        return implode(',', array_map(
            fn (string $cell) => self::quote(self::neutralise($cell)),
            $cells,
        ))."\r\n";
    }
}
