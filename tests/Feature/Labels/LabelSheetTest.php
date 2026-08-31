<?php

use App\Support\Qr\LabelSheet;
use Smalot\PdfParser\Parser;

/**
 * Three rows with a title that exercises stacked Vietnamese diacritics.
 *
 * The shape is `CopiesForLabelsQuery::run()`'s row minus `printCount` —
 * `array{copyId: string, code: string, title: string}`.
 *
 * Top-level, because Pest loads every test file into one process; a second
 * definition of this name anywhere in the suite would be a fatal
 * redeclaration. Verified unique with `grep -rn "^function sheetRows" tests/`.
 *
 * @return list<array{copyId: string, code: string, title: string}>
 */
function sheetRows(int $n = 3): array
{
    return collect(range(1, $n))->map(fn (int $i) => [
        'copyId' => sprintf('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e%02d', $i),
        'code' => sprintf('DT-%04d', $i),
        'title' => 'Dế Mèn Phiêu Lưu Ký',
    ])->all();
}

/**
 * Pages in a PDF, counted from the raw bytes.
 *
 * The negative lookahead is load-bearing: `/Type /Pages` is the page TREE
 * node and also matches a naive `/Type /Page` substring count, so a
 * one-page document counts as two without it. Measured on real output.
 *
 * Verified unique with `grep -rn "^function pdfPageCount" tests/`.
 */
function pdfPageCount(string $pdf): int
{
    return preg_match_all('#/Type\s*/Page(?![s])#', $pdf);
}

/**
 * The document's text layer, as `smalot/pdfparser` reads it.
 *
 * This is the strong form of the diacritic assertion — real extraction from
 * the produced bytes, not an inspection of the embedded font subset. It was
 * measured working against TCPDF 6.11.4 output with the Lexend subset before
 * `LabelSheet` was written, so the weaker fallback the brief allowed was not
 * needed and did not ship.
 *
 * Verified unique with `grep -rn "^function extractedText" tests/`.
 */
function extractedText(string $pdf): string
{
    return (new Parser)->parseContent($pdf)->getText();
}

it('produces bytes that are a PDF', function () {
    expect(app(LabelSheet::class)->render(sheetRows()))->toStartWith('%PDF-');
});

it('THE DIACRITIC TEST — the title survives into the document text', function () {
    // The failure this exists for is not a crash. A font subset that drops the
    // stacked marks in "Dế Mèn Phiêu Lưu Ký" still produces a structurally
    // valid PDF; the defect is discovered on paper already glued to books.
    //
    // NORMALISE BEFORE COMPARING. A PDF text layer may be NFD even when it
    // renders perfectly — "ế" as "ê" + U+0301 — and a raw toContain() against
    // this file's NFC literal would then fail against a CORRECT sheet and send
    // an implementer hunting a font bug that is not there. ext-intl is loaded
    // in this container (verified: class_exists('Normalizer') is true).
    //
    // Measured: TCPDF's output for this sheet already extracts as NFC, so the
    // normalise is belt-and-braces rather than load-bearing. It stays because
    // that is a property of one font pipeline, not a guarantee.
    //
    // `toContain`, never equality: the extracted text also holds whatever else
    // is on the page.
    $pdf = app(LabelSheet::class)->render(sheetRows(1));

    // Line breaks collapse to spaces before the comparison. This title does
    // not fit one 24mm line at 6.8pt, so LabelSheet wraps it — correctly; a
    // label reading "Dế Mèn Phiêu…" has failed at the one job its text half
    // has — and the extracted layer therefore holds "Dế Mèn Phiêu Lưu\nKý".
    // Collapsing asserts the glyphs survived without also freezing where the
    // wrap happens to fall.
    $text = (string) preg_replace(
        '/\s+/u',
        ' ',
        Normalizer::normalize(extractedText($pdf), Normalizer::FORM_C),
    );

    expect($text)->toContain('Dế Mèn Phiêu Lưu Ký');
    expect($text)->toContain('DT-0001');
});

it('lays 21 labels to a page and starts a 22nd on page two', function () {
    expect(pdfPageCount(app(LabelSheet::class)->render(sheetRows(21))))->toBe(1);
    expect(pdfPageCount(app(LabelSheet::class)->render(sheetRows(22))))->toBe(2);
});

it('an empty set still produces a valid document rather than throwing', function () {
    // LabelSheet is a renderer, not a guard. The refusal for an empty
    // selection is MarkCopiesPrinted's (copy_selection_empty); a renderer that
    // also refused would give one rule two homes.
    expect(app(LabelSheet::class)->render([]))->toStartWith('%PDF-');
});

it('draws the QR from the module matrix, at ECC Q and version 3', function () {
    // Not a redundant restatement of LabelPayloadTest: what is asserted here
    // is that the 27-byte payload still fits version 3 at level Q, which is
    // the whole reason the payload is base64url rather than UUID text. A
    // change that pushed it to version 4 would silently shrink each module
    // inside the same 25mm square.
    $qr = LabelSheet::symbolFor('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e01');

    expect($qr->getVersion()->getVersionNumber())->toBe(3)
        ->and($qr->getMatrix()->getWidth())->toBe(29);
});

it('ellipses a title too long for two lines instead of cutting it silently', function () {
    // Two full lines that happen to end on a word boundary look like a whole
    // title. The reader of a sticker has no way to tell one from the other,
    // so the ellipsis is the only signal that the copy has a longer name.
    $rows = sheetRows(1);
    $rows[0]['title'] = 'Cho Tôi Xin Một Vé Đi Tuổi Thơ Và Một Cuốn Sách Có Tên Rất Dài';

    $text = extractedText(app(LabelSheet::class)->render($rows));

    expect($text)->toContain('…')
        ->and($text)->not->toContain('Rất Dài');
});

it('draws the symbol as vectors, embedding no image', function () {
    // Only bacon/bacon-qr-code's PNG renderer needs ext-gd or ext-imagick;
    // the module matrix needs neither, and the production host is unverified.
    // A raster would also fix the symbol at whatever DPI we guessed at.
    expect(app(LabelSheet::class)->render(sheetRows(3)))->not->toContain('/Subtype /Image');
});
