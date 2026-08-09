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
  // eslint-disable-next-line no-control-regex
  expect(/^[\x20-\x7e]+$/.test(plain)).toBe(true);
  // …and the real name is carried by RFC 6266's parameter, intact.
  const encoded = /filename\*=UTF-8''(\S+)$/.exec(header)?.[1] ?? "";
  expect(decodeURIComponent(encoded)).toBe("Sách — Tủ sách Đồng Tháp.csv");
});
