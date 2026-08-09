import { expect, test } from "vitest";
import { AUDIT_GROUPS } from "../../src/domain/kernel/audit-actions";
import { AUDIT_GROUP_STYLE, payloadRows } from "../../src/lib/audit-log";
import { formatInstantParts } from "../../src/lib/dates";

test("every audit family has a mark, and the mark is never colour alone", () => {
  // BR §17.1's second principle, and the totality this file owes: the domain
  // guarantees every *action* has a family, so four entries here cover all
  // thirty-three — but only if there really are four. A family added to
  // `AUDIT_GROUPS` with no style is a chip that renders no icon.
  for (const group of Object.keys(AUDIT_GROUPS)) {
    const style = AUDIT_GROUP_STYLE[group as keyof typeof AUDIT_GROUP_STYLE];
    expect(style, group).toBeDefined();
    expect(style.icon, group).toBeTypeOf("object");
    expect(style.ink, group).toMatch(/^text-/);
  }
  expect(Object.keys(AUDIT_GROUP_STYLE).sort()).toEqual(
    Object.keys(AUDIT_GROUPS).sort(),
  );
});

test("the expansion tells 'not recorded' from 'recorded as nothing'", () => {
  // The distinction an investigation depends on. `markCopyFound`'s `before`
  // names only `state`, so every other field of that entry was never written;
  // `proposeAvatarChange`'s `before.avatar_url` is genuinely `null` when the
  // person had no photograph. A renderer that showed both as blank would be a
  // different log.
  const rows = payloadRows(
    { state: "lost", avatar_url: null },
    { state: "available", note: "tìm thấy trong hộp" },
  );

  expect(rows.map((r) => r.field)).toEqual(["avatar_url", "note", "state"]);
  expect(rows[0]).toEqual({ field: "avatar_url", before: "null", after: "—" });
  expect(rows[1]).toEqual({
    field: "note",
    before: "—",
    after: '"tìm thấy trong hộp"',
  });
  expect(rows[2]).toEqual({
    field: "state",
    before: '"lost"',
    after: '"available"',
  });
});

test("an entry with no payload at all expands to nothing, not to a crash", () => {
  // `credentials.set` carries no `before` and no `after` on purpose (BR §2 —
  // "the audit records the act, never the secret"), so this is the shape of a
  // real, shipped entry rather than a defensive case.
  expect(payloadRows(null, null)).toEqual([]);
});

test("an inherited key is not read out of a jsonb payload", () => {
  // `before`/`after` are ordinary objects the driver parsed, so
  // `"constructor" in bag` is `true` for every one of them. `Object.hasOwn` is
  // why this renders the em dash rather than a serialised function.
  const rows = payloadRows({}, { state: "available" });
  expect(rows.map((r) => r.field)).toEqual(["state"]);
  expect(JSON.stringify(rows)).not.toContain("function");
});

test("the time of day is the 00-23 cycle, so five past midnight is not 24:05", () => {
  // `hour12: false` selects `h24` in several locales and renders midnight as
  // 24:00 — an audit entry written at 00:05 on the 3rd would then read
  // "lúc 24:05 ngày 03/08" while being filed under the third. `hourCycle: h23`
  // is the fix and this is the assertion that holds it.
  //
  // 17:05Z on the 2nd is 00:05 on the 3rd in Ho Chi Minh City.
  expect(formatInstantParts("2026-08-02T17:05:00Z")).toEqual({
    time: "00:05",
    date: "03/08/2026",
  });
});

test("Postgres's own spelling of an instant is one of the two this parses", () => {
  // `getAuditLog` selects `a.occurred_at::text`, and what comes back is
  // `2026-08-03 07:32:00+00` — a space where ISO 8601 puts `T`, and a
  // two-digit `+00` where it wants `Z` or `+00:00`. Every other test in this
  // file and in `tests/domain/shelf/audit-log.test.ts` used canonical ISO or
  // hand-supplied parts, so the string the browser actually formats was
  // exercised by nothing.
  //
  // `new Date("2026-08-03 07:32:00+00")` is outside the Date Time String
  // Format the spec pins, which means it falls to each engine's legacy parser.
  // Node and Bun both get it right and this application runs under Bun; that is
  // a fact about two runtimes, not a guarantee, and an audit browser rendering
  // "Invalid Date" on every row is what its absence looks like.
  //
  // The microsecond form is pinned beside it: `occurred_at` is a `timestamptz`
  // stamped from `ctx.clock.now()`, so a row written at a non-round instant
  // comes back with a fractional part, and Postgres omits it only when it is
  // zero. `tests/domain/shelf/audit-log.test.ts` asserts the exact string the
  // shipped query emits, which is what keeps these two fixtures honest.
  for (const stored of [
    "2026-08-03 07:32:00+00",
    "2026-08-03 07:32:00.212345+00",
  ]) {
    expect(formatInstantParts(stored), stored).toEqual({
      time: "14:32",
      date: "03/08/2026",
    });
  }
});

test("the two halves of an instant are the shelf's own timezone, and carry the year", () => {
  // BR §14's example is "lúc 14:32 ngày 03/08". The year is added because an
  // audit trail is read months later and "03/08" is ambiguous the moment a
  // shelf has two Augusts of history.
  expect(formatInstantParts("2026-08-03T07:32:00Z")).toEqual({
    time: "14:32",
    date: "03/08/2026",
  });
});
