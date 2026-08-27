import { expect, test } from "vitest";
import { SESSION_COOKIE, cookieOptions } from "../../src/lib/session-cookie";

test("the session cookie is not readable from JavaScript", () => {
  expect(cookieOptions().httpOnly).toBe(true);
});

test("the session cookie is same-site and secure in production", () => {
  const prod = cookieOptions("production");
  expect(prod.secure).toBe(true);
  expect(prod.sameSite).toBe("lax");
});

test("the cookie is not marked secure in development", () => {
  // Otherwise nobody can sign in over plain http on localhost, and the first
  // thing anyone does is disable the flag entirely.
  expect(cookieOptions("development").secure).toBe(false);
});

test("the cookie name does not advertise the framework", () => {
  expect(SESSION_COOKIE).toBe("olibra_session");
});
