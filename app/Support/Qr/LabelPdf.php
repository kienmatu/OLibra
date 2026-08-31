<?php

declare(strict_types=1);

namespace App\Support\Qr;

use TCPDF;

/**
 * TCPDF with its own advertisement turned off.
 *
 * TCPDF 6.11.4 draws `Powered by TCPDF (www.tcpdf.org)` into the **content**
 * of the last page — not a header or a footer, so `setPrintHeader(false)` and
 * `setPrintFooter(false)` do not touch it. `TCPDF::Close()` (tcpdf.php:3059)
 * gates it on `$tcpdflink`, which is `protected` (tcpdf.php:1855) and is set
 * back to `true` by the constructor (tcpdf.php:2003) with no public setter.
 * Clearing it therefore needs a subclass, and this is that subclass.
 *
 * It draws at 1pt in the sheet margin, so leaving it would not have been a
 * print defect. Two things make it worth removing anyway: it is an English
 * URL on a Vietnamese parish's label sheet, and it forces a second font
 * (`helvetica`, tcpdf.php:3068) into a document that otherwise embeds one
 * subset of Lexend and nothing else.
 *
 * Suppressed here means the extracted text of a sheet is only the sheet's own
 * text — but `LabelSheetTest`'s diacritic assertion still uses `toContain`
 * rather than equality, because a test that depends on the text layer holding
 * nothing else would break on any later addition to the label.
 */
final class LabelPdf extends TCPDF
{
    /**
     * @param  string  $orientation  page orientation, e.g. `'P'`
     * @param  string  $unit  user unit, e.g. `'mm'`
     * @param  string  $format  page format, e.g. `'A4'`
     */
    public function __construct(string $orientation, string $unit, string $format)
    {
        parent::__construct($orientation, $unit, $format, true, 'UTF-8');

        $this->tcpdflink = false;
    }
}
