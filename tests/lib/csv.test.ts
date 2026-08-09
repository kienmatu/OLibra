import { expect, test } from "vitest";
import {
  attachmentHeader,
  CSV_CONTENT_TYPE,
  toCsv,
  toCsvBytes,
} from "../../src/lib/csv";

/**
 * P1 §3.3's two traps, plus the ordinary ones.
 *
 * "Neither is hypothetical and neither is caught by 'the CSV parses'" — so
 * nothing below asserts that a parser accepts the output. Each test asserts the
 * specific thing a spreadsheet does that a parser does not.
 */

function decode(bytes: Uint8Array): string {
  // `ignoreBOM` so the mark stays in the decoded string and can be asserted on
  // — the default strips it, which would make the byte assertions below the
  // only place it is visible.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

test("the file begins with the three bytes Excel needs, EF BB BF", () => {
  // The assertion is on **bytes**, not on the string. "﻿" is one
  // JavaScript character, and a string comparison would pass just as happily
  // against a file written as UTF-16 — which is a different set of bytes and a
  // different failure.
  const bytes = toCsvBytes(["Tên"], [["Đặng Thị Kim Chi"]]);
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
});

test("a Vietnamese name survives as UTF-8 after the mark", () => {
  const bytes = toCsvBytes(["Họ và tên"], [["Đặng Thị Kim Chi"]]);
  const text = decode(bytes);
  expect(text).toContain("Đặng Thị Kim Chi");
  expect(text).toContain("Họ và tên");

  // And the bytes really are UTF-8: `Đ` is U+0110, two bytes, `C4 90`. Decoding
  // the same bytes as Windows-1252 — which is what Excel does without the mark
  // — is the mojibake §3.3 describes, and this is that claim made concrete
  // rather than repeated.
  expect([...bytes].join(",")).toContain([0xc4, 0x90].join(","));
  const asAnsi = new TextDecoder("windows-1252").decode(bytes.slice(3));
  expect(asAnsi).not.toContain("Đặng");
  expect(asAnsi).toContain("Ä");
});

test("a title beginning with = does not become a formula", () => {
  // §3.3's own example, and the acceptance criterion: "A title beginning `=`
  // does not become a formula."
  const text = toCsv(["Tên sách"], [['=HYPERLINK("http://x","Bấm")']]);
  const cell = text.split("\r\n")[1];

  // The payload is still readable — nothing is deleted — but the cell no longer
  // *starts* with `=`, which is the only thing Excel looks at.
  expect(cell.startsWith("=")).toBe(false);
  expect(cell.startsWith('"=')).toBe(false);
  expect(text).toContain("HYPERLINK");
  expect(cell).toContain("'=HYPERLINK");
});

test("all four formula leaders are neutralised, including a dash in a note", () => {
  // `-` is the one that will actually happen: a manager writing "- sách bị ướt"
  // as a void reason gets `#NAME?` where their sentence should be.
  for (const lead of ["=", "+", "-", "@"]) {
    const text = toCsv(["Lý do"], [[`${lead}sách bị ướt`]]);
    const cell = text.split("\r\n")[1];
    expect(cell.startsWith(lead), lead).toBe(false);
    expect(cell, lead).toBe(`'${lead}sách bị ướt`);
  }
});

test("whitespace before a formula leader does not get it past the rule", () => {
  // The three bypasses a reviewer constructed against `neutralise`, and the
  // reason they are a test rather than a paragraph. A spreadsheet strips a
  // leading tab, carriage return or space before it decides what the cell *is*,
  // so `\t=HYPERLINK(…)` is evaluated while `cell[0] === "\t"` is not one of
  // `FORMULA_LEADERS` — the prefix was never applied.
  //
  // None of the three is reachable today, and that is exactly why this is
  // pinned here: every free-text field that reaches a CSV is `.trim()`ed before
  // storage by a *different module* (see `neutralise`'s docstring for the five),
  // and one untrimmed write path re-opens all three at once. This test does not
  // depend on that property.
  for (const space of ["\t", "\r", " ", "  \t "]) {
    const text = toCsv(["Lý do"], [[`${space}=SUM(1+1)`]]);
    const cell = text.split("\r\n")[1];
    // The payload is untouched — the whitespace is still there, exactly as
    // stored, for the same reason the apostrophe is visible rather than a
    // silent rewrite. What changed is what the *first* character is.
    expect(cell.replace(/^"|"$/g, ""), JSON.stringify(space)).toBe(
      `'${space}=SUM(1+1)`,
    );
  }

  // And the other two the reviewer tried are correctly left alone: U+2212 (a
  // minus sign) and U+FF1D (a fullwidth equals) are not formula leaders in
  // Excel or LibreOffice, so prefixing them would be mangling an ordinary
  // Vietnamese cell for nothing.
  for (const lead of ["−", "＝"]) {
    expect(toCsv(["a"], [[`${lead}5`]]).split("\r\n")[1]).toBe(`${lead}5`);
  }
});

test("a header is a cell and gets the same rule", () => {
  expect(toCsv(["=Tên"], [])).toContain("'=Tên");
});

test("a phone number keeps its leading zero", () => {
  // Not a formula and not §3.3's, but the same audience and the same argument:
  // Excel imports `0912345678` as the number 912345678, and the digit is gone
  // from the file's contents rather than from its display. A readers export
  // whose phone numbers have each lost their first digit is worse than
  // mojibake, because mojibake announces itself.
  const text = toCsv(["Điện thoại"], [["0912345678"]]);
  expect(text.split("\r\n")[1]).toBe("'0912345678");

  // A number that does not begin with a zero is left alone: this rule is about
  // one specific thing Excel does, not about quoting numbers in general.
  expect(toCsv(["Số bản"], [["12"]]).split("\r\n")[1]).toBe("12");
  // And neither is a date, which begins with a digit but is not all digits.
  expect(toCsv(["Ngày sinh"], [["2015-04-02"]]).split("\r\n")[1]).toBe(
    "2015-04-02",
  );
});

test("commas, quotes and newlines round-trip by RFC 4180's rule", () => {
  const text = toCsv(
    ["a", "b", "c"],
    [["Dế Mèn, tập 1", 'Tô Hoài nói "xin chào"', "dòng một\ndòng hai"]],
  );
  const body = text.slice(1); // past the BOM

  expect(body).toBe(
    "a,b,c\r\n" +
      '"Dế Mèn, tập 1","Tô Hoài nói ""xin chào""","dòng một\ndòng hai"\r\n',
  );

  // A field with none of the three is not quoted — the file is meant to be
  // worked on after it is opened, and a quoted numeric column imports as text.
  expect(toCsv(["a"], [["12"]]).slice(1)).toBe("a\r\n12\r\n");
});

test("a carriage return inside a free-text reason is quoted too", () => {
  // A textarea on Windows submits CRLF, so `\r` reaches a reason column on its
  // own. Quoting only on `\n` would emit a bare CR that splits the row for a
  // strict reader.
  const text = toCsv(["Lý do"], [["một\r\nhai"]]);
  expect(text.slice(1)).toBe('Lý do\r\n"một\r\nhai"\r\n');
});

test("a lone carriage return, with no line feed after it, is quoted", () => {
  // **The test above does not exercise the `\r` branch and the one below is why
  // this one exists.** `"một\r\nhai"` contains a `\n`, so the predicate's `\n`
  // alternative alone satisfies it: deleting `\r` from `/[",\r\n]/` in
  // `src/lib/csv.ts` left all 22 tests across this file and
  // `tests/domain/shelf/exports.test.ts` green — measured, by deleting it. The
  // guard was decoration.
  //
  // A lone CR is what an old Mac-era paste and several mobile keyboards submit,
  // and it is what the predicate's comment is explicitly about. Unquoted, it is
  // a bare CR in the middle of a field, and a strict RFC 4180 reader — Excel's
  // own import among them — takes it as a row terminator: the rest of the
  // reason becomes a new row with one column, and every column after it in the
  // real row shifts left by one.
  const text = toCsv(["Lý do"], [["một\rhai"]]);
  expect(text.slice(1)).toBe('Lý do\r\n"một\rhai"\r\n');
});

test("every row ends with CRLF, the last one included", () => {
  const text = toCsv(["a"], [["1"], ["2"]]);
  expect(text.slice(1)).toBe("a\r\n1\r\n2\r\n");
  expect(text.endsWith("\r\n")).toBe(true);
});

test("an empty export is a header row and nothing else", () => {
  // Not an empty file: a spreadsheet opening zero bytes shows nothing at all,
  // and a volunteer cannot tell that from a failed download.
  const bytes = toCsvBytes(["Tên sách", "Tác giả"], []);
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(decode(bytes).slice(1)).toBe("Tên sách,Tác giả\r\n");
});

test("the headers say UTF-8 twice, and the filename survives both ways", () => {
  expect(CSV_CONTENT_TYPE).toBe("text/csv; charset=utf-8");

  const header = attachmentHeader(
    "sach-dong-thap.csv",
    "Sách — Tủ sách Đồng Tháp.csv",
  );
  // The plain parameter is ASCII: `Response` in Node throws on a header value
  // outside ISO-8859-1, so a raw Vietnamese name here is a 500, not a nicety.
  const plain = /filename="([^"]+)"/.exec(header)?.[1] ?? "";
  expect(/^[\x20-\x7e]+$/.test(plain)).toBe(true);
  // …and the real name is carried by RFC 6266's parameter, intact.
  const encoded = /filename\*=UTF-8''(\S+)$/.exec(header)?.[1] ?? "";
  expect(decodeURIComponent(encoded)).toBe("Sách — Tủ sách Đồng Tháp.csv");
});
