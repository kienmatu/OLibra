/**
 * The payload a printed QR label carries, and the way back from it.
 *
 * **A copy's UUID, not its code.** `book_copies_code_unique` is
 * `unique (bookshelf_id, code) where deleted_at is null`, so `DT-0142` is
 * unique only within one shelf and two parishes in the network can both own
 * one. A sticker is a physical object that travels in a donated box of books;
 * what is printed on it must not depend on already knowing where it came from.
 *
 * **base64url, not the 36-character UUID text, and the reason is error
 * correction rather than size.** QR byte-mode capacity at version 3 is 32 bytes
 * at ECC Q; the 27 bytes here fit, and the 36 of `uuid` text do not. Q means a
 * quarter of the symbol may be scuffed, torn or jam-smeared and still decode —
 * the correct budget for a label glued to a book a seven-year-old carries home
 * in the rain.
 *
 * **`OLB1` is a format version, not decoration.** A scanner that meets an
 * `OLB2:` payload refuses it by name instead of decoding it into a wrong UUID.
 * Rejecting a foreign QR is a side benefit; `resolveCopyById` refuses anything
 * that is not a copy on this shelf regardless of what encoded it.
 *
 * Nothing here touches the database, React or Node's filesystem — it is pure
 * string arithmetic, which is why it is testable without a shelf, and why the
 * browser-side scanner can import the same module the PDF writer uses.
 */

export const QR_PREFIX = "OLB1:";

const HEX32 = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The 16 raw bytes of `uuid`, base64url, unpadded — always 22 characters. */
export function tokenFor(uuid: string): string {
  const hex = uuid.replace(/-/g, "").toLowerCase();
  if (!HEX32.test(hex)) {
    throw new TypeError(`not a uuid: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return base64url(bytes);
}

/** What is printed inside the QR. 27 bytes. */
export function payloadFor(uuid: string): string {
  return QR_PREFIX + tokenFor(uuid);
}

/**
 * A scanned payload back to a lowercase UUID, or `null`.
 *
 * One `null` for every way this can go wrong — wrong prefix, wrong length,
 * characters outside the alphabet, a token that does not decode to sixteen
 * bytes. The caller shows one message and offers the code entry field; telling
 * a volunteer holding a phone *which* of those it was helps nobody.
 */
export function uuidFromPayload(payload: string): string | null {
  if (!payload.startsWith(QR_PREFIX)) return null;
  const token = payload.slice(QR_PREFIX.length);
  if (!TOKEN.test(token)) return null;

  const bytes = fromBase64url(token);
  if (bytes === null || bytes.length !== 16) return null;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Hand-rolled rather than `Buffer.from(...).toString("base64url")`.
 *
 * `Buffer` is Node's, and this module is imported by the scanner, which runs in
 * a browser. `btoa`/`atob` are the browser's and are absent from some server
 * runtimes. Sixteen bytes of base64 is twenty lines; a polyfill or a dependency
 * for it would be more moving parts than the arithmetic.
 */
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += ALPHABET[c & 0b111111];
  }
  return out;
}

/** The inverse. `null` for any character outside the alphabet. */
function fromBase64url(token: string): Uint8Array | null {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of token) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
