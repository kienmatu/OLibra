import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  formatDate,
  formatDueDate,
  formatInstant,
  formatYear,
} from "../../src/lib/dates";
import { filesUnder } from "../support/source-text";

/**
 * SDD §6.6 — "dates and numbers are formatted through the locale, never with
 * hand-written format strings" — and the one word this project says over the
 * locale's shoulder.
 */

test("a due date carries its weekday, in Vietnamese, from the locale", () => {
  // 20/08/2026 is a Thursday. Nothing about it is overridden: every weekday but
  // one is `Intl`'s, and a test that only ever looked at Sundays would pass
  // against a `formatDueDate` that had quietly become a format string.
  expect(formatDueDate("2026-08-20")).toBe("Thứ Năm, 20/08/2026");
});

test("Sunday is the parish's word, not the locale's", () => {
  // The disagreement this closes: the confirm screen rendered `vi-VN`'s "Chủ
  // Nhật, 23/08/2026" and redirected to a dashboard saying "Chúa nhật", inside
  // one session. "Chúa nhật" is the Catholic usage and this is a parish system,
  // so the codebase's existing nine sites win and the locale is corrected in
  // exactly one word.
  expect(formatDueDate("2026-08-23")).toBe("Chúa nhật, 23/08/2026");
  expect(formatDueDate("2026-08-30")).toBe("Chúa nhật, 30/08/2026");
});

test("a date column is read as a calendar date, not as an instant", () => {
  // `formatDate` parses `YYYY-MM-DD` at midnight UTC and formats in UTC. Read
  // in `Asia/Ho_Chi_Minh` it would render 07:00 the same morning — harmless in
  // Vietnam and a day early anywhere west of UTC, which is the shape of bug
  // that survives every test run taken locally.
  expect(formatDate("2026-08-20")).toBe("20/08/2026");
  expect(formatDate("2026-01-01")).toBe("01/01/2026");
});

test("an instant is read in the shelf's own timezone", () => {
  // 2026-08-20T18:30:00Z is 01:30 on the 21st in `Asia/Ho_Chi_Minh` (UTC+7),
  // which is the whole reason these two functions are not one function.
  expect(formatInstant("2026-08-20T18:30:00Z")).toBe("21/08/2026");
});

test("a year is not a quantity, so it carries no thousands separator", () => {
  // Found in a browser, not by a type-checker, which is why U2's brief insists
  // on the browser: the book page ran `books.published_year` through the same
  // `Intl.NumberFormat("vi-VN")` it uses for copy counts, and `vi-VN` groups
  // thousands with a full stop — so "Năm xuất bản 2.016" appeared under every
  // title on the shelf. Every year a real book carries is four digits, so the
  // defect is invisible in any locale that does not group, and unmissable in
  // this one.
  expect(formatYear(2016)).toBe("2016");
  expect(formatYear(1998)).toBe("1998");
  // Asserted as "not the grouped form" as well as "the right string", so a
  // `formatYear` rewritten with a different separator cannot pass by accident.
  expect(formatYear(2016)).not.toContain(".");
  expect(formatYear(2016)).not.toContain(",");
});

test('only `dates.ts` knows the locale spells Sunday "Chủ Nhật"', () => {
  // The guard on the decision rather than on the formatter. Both words being
  // present somewhere in `src/` is exactly the state that shipped — a confirm
  // screen and the dashboard it redirects to disagreeing — and the fix is only
  // durable if a second site cannot quietly reintroduce it.
  //
  // `src/lib/dates.ts` is the declared exemption: it is the one file that has
  // to hold both spellings, because holding both is what it does.
  const offenders = filesUnder("src")
    .filter((f) => f !== "src/lib/dates.ts")
    .filter((f) => /Chủ\s+[Nn]hật/.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(process.cwd() + "/", ""));

  expect(offenders).toEqual([]);
});
