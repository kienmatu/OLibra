import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { FilterChips } from "../../src/components/ui/filter-chips";

/**
 * Task 14 (2026-08-10 QA remediation). `FilterChips` is the reader list's own
 * chip, extracted so `/quan-ly/thong-bao` and `/quan-ly/binh-luan` get the
 * real thing instead of an inert `<span>` that looked the same. The two rules
 * worth pinning are the ones the QA sweep named explicitly: exactly one chip
 * carries the active styling and `aria-current="page"` (P3-4 — missing on
 * every one of `Chip`'s nine call sites before this task, `nguoi-doc`
 * included), and a chip's count, when given, renders through the locale
 * rather than as a bare number.
 *
 * `toEqual([...])` rather than `toContain`, matching `reader-tabs.test.tsx`
 * and `public-header.test.tsx`'s own reasoning: it fails on *both* directions
 * a shared active-state rule can break — the wrong chip lit up, or two chips
 * lit up at once (`nguoi-doc`'s status and unit rows have shipped one bug of
 * each shape already on this branch, neither of which any test could see,
 * which is why this file exists rather than trusting the reference
 * implementation by eye).
 */
function render(chips: Parameters<typeof FilterChips>[0]["chips"]) {
  return renderToStaticMarkup(<FilterChips chips={chips} />);
}

/** Every `aria-current="page"` anchor's own text, in document order. */
function currentChips(html: string): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)];
  return anchors
    .filter((m) => m[0].includes('aria-current="page"'))
    .map((m) => m[0].replace(/<[^>]*>/g, "").trim());
}

test("exactly one chip is aria-current, and it is the active one", () => {
  const html = render([
    { label: "Tất cả", href: "/x?trang-thai=", active: false },
    { label: "Đang hiện", href: "/x?trang-thai=dang-hien", active: true },
    { label: "Nháp", href: "/x?trang-thai=nhap", active: false },
  ]);
  expect(currentChips(html)).toEqual(["Đang hiện"]);
});

test("no chip is aria-current when none is active", () => {
  const html = render([
    { label: "Chờ duyệt", href: "/x?trang-thai=cho-duyet", active: false },
    { label: "Đã duyệt", href: "/x?trang-thai=da-duyet", active: false },
  ]);
  expect(currentChips(html)).toEqual([]);
});

test("the active chip carries the terracotta classes, inactive ones do not", () => {
  const html = render([
    { label: "Tất cả", href: "/x", active: true },
    { label: "Nháp", href: "/x?trang-thai=nhap", active: false },
  ]);
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);
  expect(anchors[0]).toContain(
    "border-terracotta bg-surface font-semibold text-terracotta-ink",
  );
  expect(anchors[1]).not.toContain("border-terracotta");
});

test("a count renders through the locale; an absent one renders no parentheses", () => {
  const html = render([
    { label: "Tất cả", href: "/x", active: true, count: 1234 },
    { label: "Tất cả đơn vị", href: "/y", active: false },
  ]);
  // SDD §6.6: even a count goes through `Intl.NumberFormat("vi-VN")`, which
  // groups thousands with a period rather than a comma.
  expect(html).toContain("Tất cả (1.234)");
  expect(html).not.toContain("Tất cả đơn vị (");
});
