import { expect, test } from "vitest";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { fixedClock } from "../../../src/domain/kernel/clock";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import {
  COPY_CONDITIONS,
  copyCodePrefix,
  copyStateTransition,
  formatCopyCode,
  isCopyCondition,
  requireManager,
  requireReader,
  slugifyTitle,
} from "../../../src/domain/catalogue/policy";

const ctxWith = (role: TenantContext["actor"]["role"]): TenantContext => ({
  bookshelfId: "11111111-1111-1111-1111-111111111111",
  actor: { userId: null, membershipId: null, role },
  clock: fixedClock("2026-08-08T10:00:00Z"),
});

test("the transition table is BR §7.1's table, arrow for arrow", () => {
  // Every arrow BR §7.1 draws, and nothing it does not.
  const allowed: [string, string][] = [
    ["available", "held"],
    ["available", "on_loan"],
    ["available", "retired"],
    ["held", "available"],
    ["held", "on_loan"],
    ["on_loan", "available"],
    ["on_loan", "lost"],
    ["lost", "available"],
    ["lost", "retired"],
  ];
  for (const [from, to] of allowed) {
    expect(copyStateTransition(from as never, to as never).allowed).toBe(true);
  }
});

test("Q3: an available copy cannot be reported lost, and says why", () => {
  // The decision this plan records: BR §7.1 draws only on_loan → lost, and
  // widening it later is additive while retracting it is not.
  const t = copyStateTransition("available", "lost");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_not_on_loan");
});

test("a copy on loan cannot be retired, and names the way out", () => {
  // OPS §4.1 RetireCopy: "Hãy nhận trả hoặc báo mất trước."
  const t = copyStateTransition("on_loan", "retired");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_on_loan");
});

test("a held copy cannot be retired either", () => {
  // BR §7.1 draws no held → retired arrow; the reader waiting on the hold is
  // the reason. copy_not_available is the sentence that names both cases:
  // "đang được mượn hoặc đang giữ chỗ".
  const t = copyStateTransition("held", "retired");
  expect(t.allowed).toBe(false);
  expect(t.reason).toBe("copy_not_available");
});

test("the terminal and repeated states each get their own reason", () => {
  expect(copyStateTransition("lost", "lost").reason).toBe("already_lost");
  expect(copyStateTransition("retired", "lost").reason).toBe("already_retired");
  expect(copyStateTransition("retired", "available").reason).toBe(
    "already_retired",
  );
  // MarkCopyFound off anything that is not lost.
  expect(copyStateTransition("available", "available").reason).toBe("not_lost");
  expect(copyStateTransition("on_loan", "available").allowed).toBe(true);
});

test("INV-7: a lost or retired copy cannot be lent or held", () => {
  // The predicate half of the invariant. Its access-path half — that such a
  // copy is absent from copies_borrowable — is Task 4's named test.
  for (const from of ["lost", "retired"] as const) {
    for (const to of ["on_loan", "held"] as const) {
      const t = copyStateTransition(from, to);
      expect(t.allowed).toBe(false);
      expect(t.reason).toBe(from === "lost" ? "already_lost" : "already_retired");
    }
  }
});

test("slugifyTitle reproduces the slugs already in the fixtures", () => {
  // G11: the seed must reproduce src/lib/fixtures.ts exactly, so cataloguing
  // one of these titles through CreateBook must land on the same slug the
  // fixtures already carry. Written out rather than imported: fixtures.ts
  // reaches src/lib/status.ts, which imports lucide-react, and the domain
  // does not pull an icon library into a unit test to check a string.
  expect(slugifyTitle("Dế Mèn Phiêu Lưu Ký")).toBe("de-men-phieu-luu-ky");
  expect(slugifyTitle("Totto-chan Bên Cửa Sổ")).toBe("totto-chan-ben-cua-so");
  expect(slugifyTitle("Kính Vạn Hoa tập 4")).toBe("kinh-van-hoa-tap-4");
  expect(slugifyTitle("Đất Rừng Phương Nam")).toBe("dat-rung-phuong-nam");
  expect(slugifyTitle("Cho Tôi Xin Một Vé Đi Tuổi Thơ")).toBe(
    "cho-toi-xin-mot-ve-di-tuoi-tho",
  );
});

test("copyCodePrefix derives DT from dong-thap, and every other fixture shelf", () => {
  const of = (slug: string) => copyCodePrefix({ slug, settings: null });
  expect(of("dong-thap")).toBe("DT");
  expect(of("can-tho")).toBe("CT");
  expect(of("ben-tre")).toBe("BT");
  expect(of("vinh-long")).toBe("VL");
});

test("a one-word slug still yields two characters, and settings can override", () => {
  expect(copyCodePrefix({ slug: "thanhtam", settings: null })).toBe("TH");
  expect(
    copyCodePrefix({ slug: "dong-thap", settings: { copy_code_prefix: "DTX" } }),
  ).toBe("DTX");
});

test("formatCopyCode pads to four digits and never truncates", () => {
  // Postgres lpad('10000', 4, '0') returns '1000' — it truncates on the
  // right, which would collide the 10,000th copy with the 1,000th. Padding
  // in TypeScript is why this slice does not build codes in SQL.
  expect(formatCopyCode("DT", 215)).toBe("DT-0215");
  expect(formatCopyCode("DT", 1)).toBe("DT-0001");
  expect(formatCopyCode("DT", 10000)).toBe("DT-10000");
});

test("the six conditions are BR §9's flat list, and lost is not among them", () => {
  expect(COPY_CONDITIONS).toEqual([
    "perfect",
    "slightly_worn",
    "worn",
    "torn",
    "missing_pages",
    "written_on",
  ]);
  expect(isCopyCondition("torn")).toBe(true);
  // BR §9: "lost is deliberately absent, because it is a copy state (§7.1)."
  expect(isCopyCondition("lost")).toBe(false);
});

test("the role gates are the security control, not the screen", () => {
  // BR §13.3. requireRole lives in src/auth/guards.ts, which the domain may
  // not import (tests/architecture/boundaries.test.ts). These are the same
  // three lines over the kernel's atLeast.
  expect(() => requireManager(ctxWith("manager"))).not.toThrow();
  expect(() => requireManager(ctxWith("admin"))).not.toThrow();
  expect(() => requireManager(ctxWith("reader"))).toThrow(RuleViolated);
  expect(() => requireReader(ctxWith("reader"))).not.toThrow();
  expect(() => requireReader(ctxWith("guest"))).toThrow(RuleViolated);
});
