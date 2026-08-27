import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password";

test("a correct password verifies", async () => {
  const hash = await hashPassword("con-meo-nho");
  expect(await verifyPassword("con-meo-nho", hash)).toBe(true);
});

test("a wrong password does not", async () => {
  const hash = await hashPassword("con-meo-nho");
  expect(await verifyPassword("con-meo-to", hash)).toBe(false);
});

test("the same password hashes differently each time", async () => {
  // Salted. Two children with the same simple password must not have
  // identical rows — that would leak the fact to anyone who reads the table.
  expect(await hashPassword("1234")).not.toBe(await hashPassword("1234"));
});

test("verification of a malformed hash returns false rather than throwing", async () => {
  // A corrupt row must produce a failed sign-in, not a 500.
  expect(await verifyPassword("x", "not-a-hash")).toBe(false);
});
