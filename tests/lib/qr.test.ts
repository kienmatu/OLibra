import { describe, expect, it } from "vitest";
import {
  payloadFor,
  QR_PREFIX,
  tokenFor,
  uuidFromPayload,
} from "../../src/lib/qr";

const UUID = "892219cc-85e8-4d78-af28-5a66e0fc7cc4";

describe("tokenFor", () => {
  it("encodes a uuid as 22 base64url characters", () => {
    const token = tokenFor(UUID);
    expect(token).toHaveLength(22);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("refuses something that is not a uuid", () => {
    expect(() => tokenFor("DT-0142")).toThrow(TypeError);
  });
});

describe("payloadFor", () => {
  it("prefixes the token and stays 27 bytes", () => {
    const payload = payloadFor(UUID);
    expect(payload.startsWith(QR_PREFIX)).toBe(true);
    expect(payload).toHaveLength(27);
  });

  /**
   * The number that decides the error-correction level. 27 bytes fit QR
   * version 3 at ECC Q (capacity 32); the 36 bytes of `uuid` text do not, and
   * would have forced ECC M. If this ever exceeds 32, the symbol silently
   * drops a correction level or grows a version — on paper already glued to
   * books.
   */
  it("never exceeds the 32-byte budget of version 3 at ECC Q", () => {
    for (let i = 0; i < 256; i++) {
      const uuid = `${i.toString(16).padStart(8, "0")}-85e8-4d78-af28-5a66e0fc7cc4`;
      expect(payloadFor(uuid).length).toBeLessThanOrEqual(32);
    }
  });
});

describe("uuidFromPayload", () => {
  it("round-trips a payload back to its uuid", () => {
    expect(uuidFromPayload(payloadFor(UUID))).toBe(UUID);
  });

  it("accepts an uppercase source uuid and answers in lowercase", () => {
    expect(uuidFromPayload(payloadFor(UUID.toUpperCase()))).toBe(UUID);
  });

  it("round-trips every byte value", () => {
    const uuid = "00112233-4455-6677-8899-aabbccddeeff";
    expect(uuidFromPayload(payloadFor(uuid))).toBe(uuid);
  });

  it.each([
    ["a missing prefix", "892219cc85e84d78af285a66e0fc7cc4"],
    ["a future format", "OLB2:iSIZzIXoTXivKFpm4Px8xA"],
    ["a lowercase prefix", "olb1:iSIZzIXoTXivKFpm4Px8xA"],
    ["a short token", "OLB1:iSIZzIXoTXivKFpm4Px8x"],
    ["a long token", "OLB1:iSIZzIXoTXivKFpm4Px8xAA"],
    ["non-base64url characters", "OLB1:iSIZzIXoTXivKFpm4Px8x+"],
    ["an empty payload", ""],
    ["the prefix alone", "OLB1:"],
    ["a shopping barcode", "8935001820109"],
    ["a url", "https://example.com/tu-sach/dong-thap"],
  ])("refuses %s", (_label, payload) => {
    expect(uuidFromPayload(payload)).toBeNull();
  });
});
