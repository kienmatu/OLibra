import { expect, test } from "vitest";
import { fixedClock, systemClock } from "../../../src/domain/kernel/clock";

test("today() is a date in Asia/Ho_Chi_Minh, not UTC", () => {
  // 2026-08-07T23:30Z is already 2026-08-08 in Ho Chi Minh City (UTC+7).
  // A naive toISOString().slice(0,10) returns 2026-08-07 and is wrong for
  // seven hours every day — which is exactly when a volunteer is at the
  // shelf after evening mass.
  const clock = fixedClock("2026-08-07T23:30:00Z");
  expect(clock.today()).toBe("2026-08-08");
});

test("today() does not roll over early", () => {
  const clock = fixedClock("2026-08-07T16:00:00Z"); // 23:00 local, same day
  expect(clock.today()).toBe("2026-08-07");
});

test("fixedClock returns the instant it was given", () => {
  const clock = fixedClock("2026-08-07T12:00:00Z");
  expect(clock.now().toISOString()).toBe("2026-08-07T12:00:00.000Z");
});

test("systemClock's today() is the Ho Chi Minh City date, not the naive UTC one", () => {
  // A regex shape check (`/^\d{4}-\d{2}-\d{2}$/`) passes against the exact
  // bug this clock exists to prevent: `new Date().toISOString().slice(0, 10)`
  // also produces a well-formed YYYY-MM-DD string, just the wrong one for
  // seven hours a day. Assert against an independently timezone-formatted
  // `now()` instead, so a regression back to the naive UTC implementation
  // fails this test near the UTC/Asia-Ho_Chi_Minh day boundary.
  const hoChiMinhDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(systemClock.now());

  expect(systemClock.today()).toBe(hoChiMinhDate);
});
