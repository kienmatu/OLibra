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
 * (`fixtures.ts:1022-1033`) — that the database does not store. `vi-VN` calls
 * that same day "Thứ Năm, 20/08/2026" when it is a Thursday and "Chủ Nhật"
 * when it is a Sunday, not the Catholic "Chúa nhật" the fixture author typed.
 * U1 §3.5 settles which of the two wins: the locale's, because the alternative
 * is a hand-maintained weekday table that only this project would own.
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
 * A `date` column with its weekday — "Thứ Năm, 20/08/2026".
 *
 * The weekday earns its place on a due date and nowhere else: a shelf that
 * opens on Sundays is telling a child which Sunday to come back on, which is
 * the whole reason BR §16.3's confirmation shows a due date at all.
 */
export function formatDueDate(isoDate: string): string {
  return DATE_WITH_WEEKDAY.format(new Date(`${isoDate}T00:00:00Z`));
}

/** A `timestamptz` — the instant rendered in the shelf's own timezone. */
export function formatInstant(instant: string | Date): string {
  return INSTANT.format(new Date(instant));
}
