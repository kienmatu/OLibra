/**
 * Dates, rendered for a Vietnamese reader.
 *
 * SDD §6.6: "Dates and numbers are formatted through the locale, never with
 * hand-written format strings." `cho-muon/page.tsx` already routes its copy
 * counts through one `Intl.NumberFormat` for that reason; these are the same
 * rule applied to the four date shapes the lending screens need. Adding a
 * second locale stays a translation task rather than a hunt through JSX for
 * `slice(8, 10) + "/" + slice(5, 7)`.
 *
 * **The output differs from `src/lib/fixtures.ts`, and that is the point.**
 * The fixtures carry pre-computed display strings — `dueOn: "Chúa nhật 20/08"`
 * (`fixtures.ts:1040`; lines 1022-1033 are the `Loan` *type*, which is where
 * U1 §3.5 pointed and where this comment pointed after it) — that the database
 * does not store. U1 §3.5 settles the shape: the locale's, because the
 * alternative is a hand-maintained weekday table that only this project would
 * own.
 *
 * **One word is overridden, and only one.** `vi-VN` renders Sunday as "Chủ
 * Nhật". Everywhere else in this codebase — nine sites across the dashboard,
 * the announcements, the statistics summary and the reader's own page — it is
 * "Chúa nhật", the Catholic usage, in a parish system whose shelves open after
 * Sunday mass. Shipping both meant the confirm screen and the dashboard it
 * redirects to disagreed inside one session, over the one word this
 * application says most often. Going through the locale is still right (SDD
 * §6.6): `formatToParts` gives the weekday as its own part, so the substitution
 * is one word in one place rather than a format string, and every other
 * weekday, the separators, the digit order and a second locale later all
 * remain `Intl`'s. This file is consequently the only one in `src/` allowed to
 * contain the string "Chủ Nhật", and `tests/lib/dates.test.ts` enforces both
 * halves of that.
 *
 * **Two timezones, deliberately, and the distinction is not cosmetic.**
 *
 * - `due_on` and `acquired_on` are `date` columns (BR §5.4 — a book is due at
 *   the end of a day, not at 14:23 on it). Postgres hands them over as
 *   `YYYY-MM-DD`, a calendar date with no instant behind it, so `formatDate`
 *   reads it back in UTC. Formatting it in `Asia/Ho_Chi_Minh` instead would
 *   parse midnight UTC and render it as 07:00 the same morning — harmless
 *   today, and a day early for any timezone west of UTC, which is the shape of
 *   bug that survives every test run in Vietnam.
 * - `lent_at`, `returned_at` and `assessed_at` are instants. `formatInstant`
 *   renders them in `Asia/Ho_Chi_Minh`, the application timezone §4 of the
 *   requirements fixes regardless of where the process runs — the same
 *   timezone `clock.today()` uses to decide what "today" means.
 */

/** §4 of the requirements. The same constant `domain/kernel/clock.ts` fixes. */
const TIMEZONE = "Asia/Ho_Chi_Minh";

const DATE = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_WITH_WEEKDAY = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const INSTANT = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A `date` column — `YYYY-MM-DD` — as "20/08/2026". */
export function formatDate(isoDate: string): string {
  return DATE.format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * `vi-VN`'s Sunday, and this project's.
 *
 * The only entry, and the bar for a second one is a disagreement as visible as
 * this one was — not a preference. See the header for why the substitution
 * happens on a `formatToParts` part rather than in a format string.
 */
const SUNDAY = { locale: "Chủ Nhật", parish: "Chúa nhật" };

/**
 * A `date` column with its weekday — "Thứ Năm, 20/08/2026", "Chúa nhật,
 * 23/08/2026".
 *
 * The weekday earns its place on a due date and nowhere else: a shelf that
 * opens on Sundays is telling a child which Sunday to come back on, which is
 * the whole reason BR §16.3's confirmation shows a due date at all — and it is
 * also why the one weekday this application says most often has to be the word
 * the parish uses for it.
 */
export function formatDueDate(isoDate: string): string {
  return DATE_WITH_WEEKDAY.formatToParts(new Date(`${isoDate}T00:00:00Z`))
    .map((part) =>
      part.type === "weekday" && part.value === SUNDAY.locale
        ? SUNDAY.parish
        : part.value,
    )
    .join("");
}

/** A `timestamptz` — the instant rendered in the shelf's own timezone. */
export function formatInstant(instant: string | Date): string {
  return INSTANT.format(new Date(instant));
}

/**
 * The clock time of an instant — "14:32" — in the application timezone.
 *
 * `hourCycle: "h23"` rather than `hour12: false`: the two are not the same, and
 * the difference shows up once a day. `hour12: false` selects the `h24` cycle in
 * several locales, which renders midnight as **24:00** and the hour after it as
 * 24:05 — so an audit entry written at five past midnight would read "lúc 24:05
 * ngày 03/08" while belonging to the fourth. `h23` is the 00–23 cycle a
 * Vietnamese reader expects.
 */
const TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * An instant as its two halves — `{ time: "14:32", date: "03/08/2026" }`.
 *
 * **Two parts rather than one string, and that is the whole reason this exists**
 * (P1 §3.1). BR §14's sentence is "…lúc 14:32 ngày 03/08", and every word of
 * that sentence — "lúc", "ngày" — belongs to `domain/kernel/audit-actions.ts`,
 * where the rest of the audit wording lives for the reason `errors.ts:11-16`
 * gives. Every *number* in it belongs to `Intl`, here, for SDD §6.6's. Returning
 * a pre-glued "14:32 ngày 03/08/2026" would have put a Vietnamese word in this
 * file; taking a `Date` in the domain would have put a formatter there. The pair
 * is what lets both rules hold at once.
 *
 * The year is included where BR §14's example omits it. An audit trail is read
 * months and years after the fact — that is what it is *for* — and "03/08" is
 * ambiguous the moment a shelf has two Augusts of history.
 */
export function formatInstantParts(instant: string | Date): {
  time: string;
  date: string;
} {
  const at = new Date(instant);
  return { time: TIME.format(at), date: INSTANT.format(at) };
}

/**
 * A year, which is a number and is not a quantity.
 *
 * `books.published_year` is an `integer`, so the obvious thing is the page's
 * own `Intl.NumberFormat("vi-VN")` — and that is wrong in a way no type-checker
 * can see and no unit test of the *query* would notice. `vi-VN` groups
 * thousands with a full stop, so `format(2016)` is **"2.016"**, and the book
 * page shipped a browser session reading "Năm xuất bản 2.016" under every
 * title on the shelf. Found by walking the page, which is why U2's brief says
 * to verify in a browser rather than a type-checker.
 *
 * `useGrouping: false` rather than `String(year)`: SDD §6.6's rule is that
 * numbers go *through* the locale, and a bare `String()` opts out of it
 * entirely — correct today only because `vi` uses Western digits, and wrong
 * again the first time somebody adds a locale that does not. What a year needs
 * is the locale's digits without its grouping, which is one option on the same
 * formatter.
 *
 * It lives here rather than in the page for the reason this whole module
 * exists: the alternative is each of the four or five screens that show a year
 * making the same call and one of them making it differently. `tests/lib/
 * dates.test.ts` pins the separator, which is the part that was wrong.
 */
const YEAR = new Intl.NumberFormat("vi-VN", { useGrouping: false });

export function formatYear(year: number): string {
  return YEAR.format(year);
}
