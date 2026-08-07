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

test("systemClock produces a well-formed date", () => {
  expect(systemClock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
