import { expect, test } from "vitest";

/**
 * G6: the suite runs in `Asia/Ho_Chi_Minh`.
 *
 * These assert the *behaviour* rather than the zone's name. `Asia/Ho_Chi_Minh`
 * is a tz-database link to the older `Asia/Saigon`, and ICU resolves it back to
 * the canonical name — so `resolvedOptions().timeZone` returns "Asia/Saigon"
 * even when TZ is set correctly. Pinning the string would fail for a reason
 * that has nothing to do with whether dates land on the right day.
 */

test("the suite runs at UTC+7", () => {
  // Vietnam has no daylight saving, so this holds year-round. If it ever does
  // not, that is a tz-data change worth being told about loudly.
  const january = new Date("2026-01-15T00:00:00Z").getTimezoneOffset();
  const july = new Date("2026-07-15T00:00:00Z").getTimezoneOffset();
  expect(january).toBe(-420);
  expect(july).toBe(-420);
});

test("a late-evening UTC instant is already the next local day", () => {
  // The case every due-date rule turns on. 23:30Z on the 7th is 06:30 on the
  // 8th in Ho Chi Minh City — and a volunteer at the shelf after evening mass
  // is inside that window, which is why naïve UTC date maths is wrong here for
  // seven hours a day.
  const formatted = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date("2026-08-07T23:30:00Z"));
  expect(formatted).toBe("2026-08-08");
});
