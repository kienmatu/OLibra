<?php

use App\Support\Exports\Csv;

it('the BOM is the three bytes EF BB BF, asserted as bytes', function () {
    // Bytes, not string equality against "\u{FEFF}" — a byte assertion is
    // what catches an accidental UTF-16 write (the reference's reasoning).
    expect(strlen(Csv::BOM))->toBe(3)
        ->and(bin2hex(Csv::BOM))->toBe('efbbbf');
});

it('neutralises all four formula leaders with a visible apostrophe', function () {
    foreach (['=SUM(1+1)', '+84 gọi em', '- sách bị ướt', '@a'] as $cell) {
        expect(Csv::neutralise($cell))->toBe("'".$cell);
    }
});

it('neutralises a leader hidden behind leading whitespace — Excel strips before deciding', function () {
    foreach (["\t=HYPERLINK(1)", "\r=1", ' =1', "\n=1"] as $cell) {
        expect(Csv::neutralise($cell))->toBe("'".$cell)
            // The cell itself is NEVER altered — trimming here would
            // silently rewrite a value the file is an exact copy of.
            ->and(substr(Csv::neutralise($cell), 1))->toBe($cell);
    }
});

it('protects a leading-zero all-digit cell — every Vietnamese phone number', function () {
    expect(Csv::neutralise('0912345678'))->toBe("'0912345678")
        // Anchored: a cell BEGINNING with a space is not the all-digits
        // cell this rule is about, and 84912… has no zero to lose.
        ->and(Csv::neutralise(' 0912345678'))->toBe(' 0912345678')
        ->and(Csv::neutralise('84912345678'))->toBe('84912345678')
        ->and(Csv::neutralise('0'))->toBe('0');   // /^0\d+$/ needs a second digit
});

it('leaves ordinary Vietnamese text, empty and whitespace-only cells untouched', function () {
    foreach (['Dế Mèn Phiêu Lưu Ký', '', '   ', 'Tổ 1 · Giáo họ Mân Côi'] as $cell) {
        expect(Csv::neutralise($cell))->toBe($cell);
    }
});

it('quotes per RFC 4180: delimiter, quote or newline; embedded quotes doubled', function () {
    expect(Csv::quote('Hoàng, Tử Bé'))->toBe('"Hoàng, Tử Bé"')
        ->and(Csv::quote('nói "to"'))->toBe('"nói ""to"""')
        ->and(Csv::quote("hai\ndòng"))->toBe("\"hai\ndòng\"")
        // NOT quote-everything: a quoted numeric column imports as text.
        ->and(Csv::quote('2016'))->toBe('2016');
});

it('a line is neutralised, quoted, comma-joined and CRLF-terminated', function () {
    expect(Csv::line(['Tên sách', '=B1', 'a,b']))
        ->toBe("Tên sách,'=B1,\"a,b\"\r\n");
});

it('neutralisation runs BEFORE quoting, so a quoted cell cannot smuggle a leader', function () {
    // '=1,2' needs both: the apostrophe first, then the quotes around the
    // comma-carrying result.
    expect(Csv::line(['=1,2']))->toBe("\"'=1,2\"\r\n");
});
