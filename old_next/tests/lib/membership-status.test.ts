import { expect, test } from "vitest";
import { MEMBERSHIP_STATUSES } from "../../src/domain/members/policy";
import {
  MEMBERSHIP_STATUS,
  STATUS_PARAM,
  statusFromParam,
} from "../../src/lib/membership-status";

/**
 * The readers list's status filter, and the one hazard it shares with every
 * other map this application looks a URL parameter up in.
 */

test("every status the database can hold has a word, an icon and a tone", () => {
  // The `Record` type makes a missing entry a compile error; what it cannot see
  // is an entry left behind for a status the enum no longer has, or a map that
  // has quietly stopped covering the enum because the enum moved.
  expect(Object.keys(MEMBERSHIP_STATUS).sort()).toEqual(
    [...MEMBERSHIP_STATUSES].sort(),
  );
  for (const status of MEMBERSHIP_STATUSES) {
    const entry = MEMBERSHIP_STATUS[status];
    expect(entry.label, status).not.toBe("");
    // BR:604 (§17.1, principle 2): status is never carried by colour alone, so a pill cannot be
    // written without all three. Asserted rather than trusted to the type,
    // because `icon` could be assigned `undefined as unknown as LucideIcon`.
    expect(typeof entry.icon, status).not.toBe("undefined");
    expect(entry.tone, status).not.toBe("");
  }
});

test("every URL value names a real status, and every status is reachable", () => {
  // A filter chip whose value resolves to nothing is a chip that silently shows
  // the unfiltered list; a status with no value is a filter a manager cannot
  // reach at all — which is what happened to `rejected` before this wave, since
  // the fixture list had four states and the enum has five.
  expect(Object.values(STATUS_PARAM).sort()).toEqual(
    [...MEMBERSHIP_STATUSES].sort(),
  );
});

test("a hand-typed parameter resolves to nothing rather than to a function", () => {
  // `Object.hasOwn`, never `in`. `"constructor" in STATUS_PARAM` is `true`, and
  // the lookup then returns a *function* — which `getReadersList` would
  // interpolate into a `::membership_status` cast. This shipped three times as
  // `loi in ERROR_MESSAGES` and was a 500 on three screens; the eight names
  // every object in JavaScript inherits are the whole of the hazard.
  for (const key of [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__proto__",
  ]) {
    expect(statusFromParam(key), key).toBeUndefined();
  }

  expect(statusFromParam(undefined)).toBeUndefined();
  expect(statusFromParam("khong-co")).toBeUndefined();
  expect(statusFromParam("cho-duyet")).toBe("pending");
});
