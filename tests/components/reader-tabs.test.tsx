import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ReaderTabs } from "../../src/components/shell/reader-tabs";

/**
 * Task 8 (2026-08-10 QA remediation). `ReaderTabs` used to take an explicit
 * `active` prop, and three of its five callers passed the wrong key —
 * `/toi/tang-sach`, `/toi/lich-su` and `/toi/thong-bao` all said
 * `"trang-cua-toi"`, so "Trang của tôi" carried `aria-current="page"` and the
 * terracotta underline while the tab for the page actually being viewed sat
 * inert. Only `/toi/ho-so` had it right. A prop every caller must remember to
 * set correctly is the bug; this test pins the replacement, where the
 * component derives its own active tab from `pathname` instead.
 *
 * `toEqual([label])` rather than `toContain(label)` is deliberate: it fails
 * both when the wrong tab is marked active *and* when two tabs are marked
 * active at once (a `startsWith` match would do the latter, since
 * `/ho-so` is a prefix of `/ho-so/lich-su`).
 */
const CASES = [
  ["/tu-sach/x/ho-so", "Hồ sơ"],
  ["/tu-sach/x/ho-so/tong-quan", "Trang của tôi"],
  ["/tu-sach/x/ho-so/lich-su", "Lịch sử mượn"],
  ["/tu-sach/x/ho-so/tang-sach", "Tặng sách"],
  ["/tu-sach/x/ho-so/thong-bao", "Thông báo"],
] as const;

test.each(CASES)("%s marks exactly %s active", (pathname, label) => {
  const html = renderToStaticMarkup(
    <ReaderTabs shelfSlug="x" pathname={pathname} />,
  );
  const active = [...html.matchAll(/aria-current="page"[^>]*>([^<]+)</g)].map(
    (m) => m[1],
  );
  expect(active).toEqual([label]);
});
