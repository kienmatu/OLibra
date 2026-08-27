/**
 * Time, as an injectable dependency.
 *
 * Nothing in the domain calls `new Date()`. Overdue status, hold expiry and
 * availability are all computed on read against the current clock (BR §8), so
 * every one of those rules is only testable if the clock can be moved.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
  /**
   * Today's date in `Asia/Ho_Chi_Minh`, as `YYYY-MM-DD`.
   *
   * `due_on` is a date, not a timestamp (BR §5.4) — a book is due at the end
   * of a day, not at 14:23 on it. Comparisons against it must therefore be
   * made in the application timezone, or a loan becomes overdue seven hours
   * early every evening.
   */
  today(): string;
}

const TIMEZONE = "Asia/Ho_Chi_Minh";

/** `en-CA` because it formats as YYYY-MM-DD, which is what we want to store. */
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayIn(instant: Date): string {
  return dateFormatter.format(instant);
}

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => todayIn(new Date()),
};

/** A clock frozen at a given instant. The only clock tests should use. */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  return {
    now: () => new Date(instant),
    today: () => todayIn(instant),
  };
}
