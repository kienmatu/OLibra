import { expect, test } from "vitest";
import { DomainError, NotWired } from "../../../src/domain/kernel/errors";
import { hashFor, verifyFor } from "../../../src/domain/members/registration";

/**
 * Deliberately the only file under `tests/domain/members` that never calls
 * `setPasswordHasher`/`setPasswordVerifier`. Every other file wires both in
 * its own `beforeAll`, which is exactly why this needs a file of its own: a
 * shared module registry would mean whichever file happened to run first
 * wires the default away for everyone else (vitest gives each test file its
 * own module graph, so this reliably observes the *default* — the same
 * default a forgotten boot-time `setPasswordHasher()` call would leave in
 * production).
 *
 * No database needed — `hashFor`/`verifyFor` are pure closures over
 * module-scope state, no I/O.
 */

test("an unwired hasher throws a coded NotWired, not a bare Error", async () => {
  try {
    await hashFor("matkhau123");
    expect.unreachable("hashFor should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(NotWired);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as NotWired).code).toBe("password_hasher_not_wired");
    expect((err as NotWired).message).toBe(
      "Hệ thống chưa sẵn sàng để tạo mật khẩu, vui lòng thử lại sau.",
    );
  }
});

test("an unwired verifier throws a coded NotWired, distinct from the hasher's code", async () => {
  try {
    await verifyFor("matkhau123", "$argon2id$some-stored-hash");
    expect.unreachable("verifyFor should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(NotWired);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as NotWired).code).toBe("password_verifier_not_wired");
  }
});
