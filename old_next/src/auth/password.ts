import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id, at the library defaults.
 *
 * Not Bun.password, despite Bun being the production runtime: the build and
 * the test suite run on Node (G9), and a hash function that only exists in one
 * of the three is a hash function the tests cannot exercise.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    // A malformed or truncated hash is a failed sign-in, not a server error.
    return false;
  }
}
