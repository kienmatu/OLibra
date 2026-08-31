<?php

declare(strict_types=1);

namespace App\Support\Qr;

use BaconQrCode\Common\ErrorCorrectionLevel;
use BaconQrCode\Encoder\Encoder;
use BaconQrCode\Encoder\QrCode;
use RuntimeException;

/**
 * The printable QR label sheet, as PDF bytes.
 *
 * Ported from `old_next/src/lib/qr-labels.ts`, whose geometry and reasoning
 * this docblock restates. The library is different — TCPDF here, `pdf-lib`
 * plus `@pdf-lib/fontkit` there — but every millimetre below is the
 * reference's, unchanged.
 *
 * **The output is paper, glued to books.** That is what makes this class
 * unlike the rest of the port: a defect here is not seen on a screen and
 * fixed, it is discovered on four hundred stickers. Two failures in
 * particular are silent — a font that drops the stacked marks in
 * `Dế Mèn Phiêu Lưu Ký` still produces a structurally valid PDF, and a grid
 * that is 39mm too tall still renders, just off the bottom of the page.
 * `LabelSheetTest` exists for exactly those two.
 *
 * **Sized to what A4 and US Letter share, not to A4.** Letter is
 * 215.9 × 279.4mm — wider than A4 and, decisively, 17.6mm shorter. A sheet
 * that must print correctly on either has 210 × 279.4mm to work with, and
 * 12mm of margin leaves 186 × 255.4mm. Laying the grid inside that box on an
 * A4 page means nothing falls off the paper whichever the parish loaded, and
 * no volunteer has to know which they loaded. Portability costs a row: 21
 * labels per page rather than the 24 a Letter-blind layout would fit, so a
 * 400-copy shelf is 20 pages instead of 17. Avery L7159 pre-cut stock was
 * measured and rejected — 63.5 × 33.9mm in 3 columns of 8 is 190.5 × 271.2mm,
 * both outside the shared box, and a die-cut sheet cannot be made
 * paper-size-portable by drawing it smaller because the perforations do not
 * move.
 *
 * **Auto page-break is off.** Left on, TCPDF would insert a page the moment a
 * drawing operation crossed its break margin and silently reflow the grid —
 * the same class of failure as the geometry bug above, and just as invisible
 * in review.
 *
 * **The human-readable code prints under every QR and is never decorative.**
 * A cracked lens, a denied camera permission, a flat battery and a borrowed
 * phone are all ordinary; typing `DT-0142` has to stay a complete path.
 */
final class LabelSheet
{
    /** Labels across. */
    public const COLS = 3;

    /** Rows down — 7, not 8, because of the Letter height above. */
    public const ROWS = 7;

    /** Labels per page. */
    public const PER_PAGE = self::COLS * self::ROWS;

    private const PAGE_W = 210.0;

    private const PAGE_H = 297.0;

    /** The height A4 and Letter share. */
    private const SAFE_H = 279.4;

    private const LABEL_W = 58.0;

    private const LABEL_H = 34.0;

    private const GAP_X = 4.0;

    /** Row pitch. Deliberately not `LABEL_H`: the gap between rows is 1mm. */
    private const CELL_Y = 35.0;

    /** The QR's own square, and the label's internal padding. */
    private const QR_SIDE = 25.0;

    private const PAD = 3.0;

    /** Between the symbol's right edge and the text column. */
    private const TEXT_GAP = 3.0;

    /**
     * The text column beside the symbol — 24mm.
     *
     * Public because `LabelSheetTest` measures the drawn title against it.
     * The honest assertion for "no glyph crosses the label's right edge" is a
     * width, and a width needs the number it is compared to.
     */
    public const TEXT_W = self::LABEL_W - (self::PAD + self::QR_SIDE + self::TEXT_GAP) - self::PAD;

    private const TITLE_SIZE = 6.8;

    private const CODE_SIZE = 12.0;

    /** At most two title lines fit beside a 25mm symbol. */
    private const TITLE_LINES = 2;

    /**
     * The generated TCPDF font definitions, committed under `resources/fonts/`.
     *
     * `TCPDF_FONTS::addTTFfont()` is **not** called at render time. It writes
     * three artefacts per face (`.php`, `.z`, `.ctg.z`) and, with its
     * `$outpath` argument omitted, writes them into `K_PATH_FONTS` — i.e.
     * `vendor/tecnickcom/tcpdf/fonts/`, which is gitignored, so
     * `composer install --no-dev` on the host would recreate the tree without
     * them. The artefacts are generated once and committed instead, and this
     * class only ever reads them. Regenerate with:
     *
     * ```
     * php -r 'require "vendor/autoload.php";
     *   foreach (["Lexend-Regular", "Lexend-SemiBold"] as $f) {
     *     var_dump(TCPDF_FONTS::addTTFfont(
     *       getcwd()."/resources/fonts/$f.ttf", "TrueTypeUnicode", "", 96,
     *       getcwd()."/resources/fonts/tcpdf/"));
     *   }'
     * ```
     *
     * `$outpath` must be absolute: TCPDF opens it through
     * `TCPDF_STATIC::fopenLocal()`, which prefixes `file://`, and a relative
     * path becomes an unsupported remote URL.
     */
    private const FONT_REGULAR = 'lexend';

    private const FONT_SEMIBOLD = 'lexendsemib';

    /**
     * The sheet for these rows.
     *
     * Built in memory and never written anywhere, so there is no temporary
     * file to clean up and no cache to invalidate.
     *
     * An empty set yields a valid one-page document rather than an exception:
     * this is a renderer, not a guard. The refusal for an empty selection
     * belongs to `MarkCopiesPrinted` (`copy_selection_empty`), and a renderer
     * that also refused would give one rule two homes.
     *
     * @param  list<array{copyId: string, code: string, title: string}>  $rows
     *                                                                          the shape `CopiesForLabelsQuery::run()` returns, minus `printCount`
     * @return string raw PDF bytes
     */
    public function render(array $rows): string
    {
        $pdf = self::document();

        $pages = max(1, (int) ceil(count($rows) / self::PER_PAGE));

        for ($page = 0; $page < $pages; $page++) {
            $pdf->AddPage();

            foreach (array_slice($rows, $page * self::PER_PAGE, self::PER_PAGE) as $slot => $row) {
                $this->drawLabel($pdf, $row, ...$this->cell($slot));
            }
        }

        return (string) $pdf->Output('', 'S');
    }

    /**
     * The widths, in mm, of the title lines this sheet would draw.
     *
     * Exists for `LabelSheetTest`. The failure it guards is not visible in a
     * document's text layer — an over-wide line is drawn in full, and what it
     * damages is the *neighbouring* label, whose text sits in the same layer
     * and would make a `toContain` assertion pass for the wrong reason. Width
     * against `TEXT_W` is the honest question: does any glyph cross the
     * label's right edge.
     *
     * @return list<float>
     */
    public static function titleLineWidths(string $title): array
    {
        $pdf = self::document();
        $pdf->AddPage();
        $pdf->SetFont(self::FONT_REGULAR, '', self::TITLE_SIZE);

        return array_map(
            static fn (string $line): float => (float) $pdf->GetStringWidth($line),
            (new self)->wrap($pdf, $title, self::TEXT_W),
        );
    }

    /**
     * An empty, configured document with both faces registered.
     *
     * Margins, cell padding and cell margins are all zeroed and auto
     * page-break is off, so every coordinate below is the page's own
     * millimetres and nothing reflows the grid.
     */
    private static function document(): LabelPdf
    {
        $pdf = new LabelPdf('P', 'mm', 'A4');
        $pdf->setPrintHeader(false);
        $pdf->setPrintFooter(false);
        $pdf->setAutoPageBreak(false);
        $pdf->setMargins(0, 0, 0);
        $pdf->setCellPaddings(0, 0, 0, 0);
        $pdf->setCellMargins(0, 0, 0, 0);
        $pdf->setCreator('OLibra');
        $pdf->setTitle('Nhãn QR');

        $pdf->AddFont(self::FONT_REGULAR, '', self::fontPath(self::FONT_REGULAR));
        $pdf->AddFont(self::FONT_SEMIBOLD, '', self::fontPath(self::FONT_SEMIBOLD));

        return $pdf;
    }

    /**
     * The QR symbol for a copy's UUID.
     *
     * Error correction is **Q**: a quarter of the printed symbol may be
     * scuffed, torn or jam-smeared and still decode, which is the budget a
     * label glued to a book a seven-year-old carries home in the rain needs.
     * The 27-byte payload fits version 3 at Q's 32-byte ceiling — that is the
     * reason `LabelPayload` encodes 16 raw bytes rather than 36 characters of
     * UUID text, and `LabelSheetTest` asserts the version so a change that
     * pushed it to version 4 cannot silently shrink each module inside the
     * same 25mm square.
     *
     * Public and static because that assertion needs the symbol without a
     * PDF, not because anything else calls it.
     */
    public static function symbolFor(string $uuid): QrCode
    {
        return Encoder::encode(LabelPayload::encode($uuid), ErrorCorrectionLevel::Q());
    }

    /**
     * Where a slot's label sits on its page, in mm from the page's top-left.
     *
     * Separated from the drawing so the geometry is arithmetic rather than
     * something only a PDF can answer, and this is not fastidiousness: the
     * reference's first draft used one cell pitch for both axes and put 336mm
     * of rows on a 297mm page — invisible in review, silent at run time, and
     * detectable only as labels missing from paper somebody had already
     * printed.
     *
     * @return array{float, float}
     */
    private function cell(int $slot): array
    {
        $marginX = (self::PAGE_W - (self::COLS * self::LABEL_W + (self::COLS - 1) * self::GAP_X)) / 2;
        $marginY = (self::PAGE_H - self::SAFE_H) / 2
            + (self::SAFE_H - self::ROWS * self::CELL_Y) / 2;

        return [
            $marginX + ($slot % self::COLS) * (self::LABEL_W + self::GAP_X),
            $marginY + intdiv($slot, self::COLS) * self::CELL_Y,
        ];
    }

    /**
     * One label: hairline box, symbol, code, wrapped title.
     *
     * @param  array{copyId: string, code: string, title: string}  $row
     */
    private function drawLabel(LabelPdf $pdf, array $row, float $x, float $y): void
    {
        // A cut guide, not a border: light enough to disappear against the
        // scissors line rather than frame the sticker.
        $pdf->SetDrawColor(204, 199, 191);
        $pdf->SetLineWidth(0.15);
        $pdf->Rect($x, $y, self::LABEL_W, self::LABEL_H);

        $this->drawQr(
            $pdf,
            $row['copyId'],
            $x + self::PAD,
            $y + (self::LABEL_H - self::QR_SIDE) / 2,
        );

        $textX = $x + self::PAD + self::QR_SIDE + self::TEXT_GAP;

        $pdf->SetTextColor(26, 23, 20);

        $pdf->SetFont(self::FONT_SEMIBOLD, '', self::CODE_SIZE);
        $pdf->Text($textX, $y + 6.5, $this->fit($pdf, $row['code'], self::TEXT_W));

        $pdf->SetFont(self::FONT_REGULAR, '', self::TITLE_SIZE);

        foreach ($this->wrap($pdf, $row['title'], self::TEXT_W) as $n => $line) {
            $pdf->Text($textX, $y + 13.5 + $n * 3.4, $line);
        }
    }

    /**
     * The symbol as filled rectangles, run-length-merging each row.
     *
     * No raster and therefore no DPI: the symbol is as sharp as the printer
     * is, not as sharp as whatever resolution we guessed at. It also keeps
     * `ext-gd` and `ext-imagick` out of the requirements — only
     * `bacon/bacon-qr-code`'s PNG renderer needs those, and the production
     * host is unverified. Merging horizontal runs keeps a full page in the
     * low thousands of rectangles rather than roughly three times that.
     */
    private function drawQr(LabelPdf $pdf, string $uuid, float $x, float $y): void
    {
        $matrix = self::symbolFor($uuid)->getMatrix();
        $size = $matrix->getWidth();
        $module = self::QR_SIDE / $size;

        $pdf->SetFillColor(0, 0, 0);

        for ($rowIndex = 0; $rowIndex < $size; $rowIndex++) {
            $run = 0;

            for ($col = 0; $col <= $size; $col++) {
                if ($col < $size && $matrix->get($col, $rowIndex) === 1) {
                    $run++;

                    continue;
                }

                if ($run > 0) {
                    $pdf->Rect(
                        $x + ($col - $run) * $module,
                        $y + $rowIndex * $module,
                        $run * $module,
                        $module,
                        'F',
                    );
                    $run = 0;
                }
            }
        }
    }

    /** Truncate with an ellipsis to fit `$maxW` mm at the current font. */
    private function fit(LabelPdf $pdf, string $text, float $maxW): string
    {
        if ((float) $pdf->GetStringWidth($text) <= $maxW) {
            return $text;
        }

        return $this->ellipsise($pdf, $text, $maxW);
    }

    /**
     * Append an ellipsis, shortening until it fits.
     *
     * Separate from `fit()` because the caller sometimes knows text was lost
     * when the last line is not itself too wide — a title cut off after two
     * full lines. `Cho Tôi Xin Một Vé / Đi Tuổi Thơ Và Một` reads as a whole
     * title and is not one; `Đi Tuổi Thơ Và…` at least tells the reader to go
     * look the copy up.
     */
    private function ellipsise(LabelPdf $pdf, string $text, float $maxW): string
    {
        while (mb_strlen($text) > 1 && (float) $pdf->GetStringWidth($text.'…') > $maxW) {
            $text = mb_substr($text, 0, -1);
        }

        return rtrim($text).'…';
    }

    /**
     * Wrap to at most `TITLE_LINES`, ellipsing only the last.
     *
     * Titles wrap rather than truncate: `Totto-chan Bên Cửa Sổ` does not fit
     * one line at this size, and a label reading `Totto-chan Bên Cửa…` has
     * failed at the one job its text half has.
     *
     * @return list<string>
     */
    private function wrap(LabelPdf $pdf, string $text, float $maxW): array
    {
        $lines = [];
        $line = '';
        $dropped = false;

        foreach (explode(' ', $text) as $word) {
            $next = $line === '' ? $word : $line.' '.$word;

            if ((float) $pdf->GetStringWidth($next) <= $maxW) {
                $line = $next;

                continue;
            }

            if ($line !== '') {
                $lines[] = $line;
            }

            $line = $word;

            if (count($lines) === self::TITLE_LINES) {
                // Words remain and there is no third line for them.
                $dropped = true;

                break;
            }
        }

        if ($line !== '' && count($lines) < self::TITLE_LINES) {
            $lines[] = $line;
        }

        if ($lines === []) {
            return [];
        }

        // Whenever there is a last line, not only when the wrap filled both:
        // a single word with no spaces in it — Vietnamese titles are written
        // with spaces, but nothing in the database enforces that — produces
        // ONE line, and gating truncation on a full two lines would draw it
        // unclipped. Measured: `Khôngcódấucáchtrongtiêuđềnàyđâubạnnhé` is
        // 51.67mm in a 24mm column, i.e. 24.7mm past the label's right edge,
        // through the 4mm gutter and across the neighbouring sticker's 25mm
        // symbol. The reference has the same hole
        // (`old_next/src/lib/qr-labels.ts`, its own `wrap()`); it is not
        // ported.
        $last = count($lines) - 1;

        $lines[$last] = $dropped
            ? $this->ellipsise($pdf, $lines[$last], $maxW)
            : $this->fit($pdf, $lines[$last], $maxW);

        return $lines;
    }

    /**
     * The absolute path of a committed font definition.
     *
     * Absolute, because `TCPDF::AddFont()` takes the directory from
     * `dirname($fontfile)` and hands it back to
     * `TCPDF_FONTS::getFontFullPath()` when it later goes looking for the
     * `.z` and `.ctg.z` beside it (tcpdf.php:4352, :8948, :9165); a relative
     * path would resolve against the working directory of whatever process
     * happens to be rendering.
     *
     * The explicit failure matters more than it looks. Without it a missing
     * artefact reaches `TCPDF::Error('Could not include font definition
     * file')`, which says nothing about how to produce one.
     */
    private static function fontPath(string $font): string
    {
        $path = resource_path('fonts/tcpdf/'.$font.'.php');

        if (! is_file($path)) {
            throw new RuntimeException(
                "missing TCPDF font definition: {$path} — regenerate with TCPDF_FONTS::addTTFfont(), see LabelSheet::FONT_REGULAR",
            );
        }

        return $path;
    }
}
