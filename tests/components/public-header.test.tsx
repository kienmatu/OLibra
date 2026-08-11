import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  FrontDoorHeader,
  ShelfHeader,
} from "../../src/components/shell/public-header";

/**
 * Task 9 (2026-08-10 QA remediation). `ShelfHeader`'s `links` array had two
 * entries with `key: "thong-bao"` — "Bản tin" (`${base}/thong-bao`) and the
 * reader's own notification bell (`${base}/ho-so/thong-bao`) — because the
 * bell's key was never updated when the `active` union grew a distinct
 * `"thong-bao-cua-toi"` value for it. React logged "Encountered two children
 * with the same key" on every reader page in the real (client-hydrating) app,
 * but that check lives in the client reconciler
 * (`react-dom`'s `ReactChildFiber`), not in `react-dom/server`'s
 * `renderToStaticMarkup`/`renderToString` — spiking a `console.error` spy
 * around either confirmed it never fires here, dup key or not, so this file
 * does not assert on it: a check that cannot fail is worse than no check.
 *
 * `active === link.key` matches by *key*, not by array position, so the
 * duplicate had two distinct, independently-verified visible failures
 * instead: `${base}/thong-bao`'s own page passes `active="thong-bao"` and lit
 * up *both* "Bản tin" and the bell; `${base}/ho-so/thong-bao` already passed
 * the `active` union's other declared value, `active="thong-bao-cua-toi"`,
 * and matched neither link, so the whole top nav went dark there. The
 * `test.each` below renders each real caller's actual `active` prop and
 * checks exactly one label lights up per page — `toEqual([label])`, not
 * `toContain(label)`, because that is what fails on *both* directions of this
 * bug (two active, or zero). Reverting the bell's key back to `"thong-bao"`
 * turns the `/tu-sach/x/thong-bao` case red with `['Bản tin', 'Thông báo']`
 * and the `/tu-sach/x/ho-so/thong-bao` case red with `[]` — see the task 9
 * report for the exact output.
 */
function renderNav(active: Parameters<typeof ShelfHeader>[0]["active"]) {
  return renderToStaticMarkup(
    <ShelfHeader
      shelfName="Thư viện Đồng Tháp"
      shelfSlug="x"
      viewerName="Nguyễn Văn A"
      active={active}
    />,
  );
}

/**
 * Nav-item labels carrying the active styling (`font-semibold
 * text-terracotta-ink`, set only when `active === link.key`). Scoped
 * implicitly to the desktop `<nav>`'s `<Link>`s: `MobileMenu` renders the
 * same five links a second time for the `<details>` menu, but never applies
 * the active class, so it can never produce a false match here.
 */
function activeLabels(html: string): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)];
  return anchors
    .filter((m) => m[0].includes("font-semibold text-terracotta-ink"))
    .map((m) => m[0].replace(/<[^>]*>/g, "").trim());
}

// One row per real `<ShelfHeader active="…">` caller (see the callers list
// in the task 9 report) — the pathname documents which page passes that
// value, not something `ShelfHeader` reads directly, since it takes an
// explicit `active` key rather than deriving one from a URL.
test.each([
  ["/tu-sach/x/danh-muc", "danh-muc", "Danh mục"],
  ["/tu-sach/x/thong-bao", "thong-bao", "Bản tin"],
  ["/tu-sach/x/ho-so/tong-quan", "toi", "Trang của tôi"],
  ["/tu-sach/x/ho-so/thong-bao", "thong-bao-cua-toi", "Thông báo"],
  ["/tu-sach/x/tim-kiem", "tim-kiem", "Tìm kiếm"],
] as const)(
  "%s (active=%s) marks exactly %s active",
  (_pathname, active, label) => {
    const html = renderNav(active);
    expect(activeLabels(html)).toEqual([label]);
  },
);

/**
 * U6 §5. Two headers, two gaps, both reported from the same walkthrough.
 *
 * `FrontDoorHeader` greeted a signed-in reader by name and offered them
 * "Tìm tủ sách" — a directory — with no link to the shelf they actually
 * belong to. `ShelfHeader` had no link to `/` at all, so the site was
 * unreachable from every reader page in the application.
 *
 * The `href` matters as much as the label here, and that is what these assert
 * on: the one-shelf case links *straight to that shelf*, and the several-shelf
 * case links to the portal, which after §4 marks each shelf the reader belongs
 * to. Asserting only that a link labelled "Tủ sách của tôi" exists would pass
 * against a version that always pointed at `/tu-sach`, which is the failure a
 * member of one shelf actually experiences — one more page to get through.
 */
function hrefsFor(html: string, label: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)]
    .filter((m) => m[2].replace(/<[^>]*>/g, "").trim() === label)
    .map((m) => m[1]);
}

const MINE = "Tủ sách của tôi";

test("FrontDoorHeader links a member of one shelf straight to that shelf", () => {
  const html = renderToStaticMarkup(
    <FrontDoorHeader
      viewerName="Nguyễn Văn A"
      isSuperAdmin={false}
      shelves={[{ slug: "dong-thap", name: "Tủ sách Đồng Tháp" }]}
    />,
  );
  // Twice — the desktop `<nav>` and `MobileMenu` render the same `links`
  // array, which is the doubling this component has always relied on.
  expect(hrefsFor(html, MINE)).toEqual([
    "/tu-sach/dong-thap",
    "/tu-sach/dong-thap",
  ]);
});

test("FrontDoorHeader sends a member of several shelves to the portal", () => {
  const html = renderToStaticMarkup(
    <FrontDoorHeader
      viewerName="Nguyễn Văn A"
      isSuperAdmin={false}
      shelves={[
        { slug: "dong-thap", name: "Tủ sách Đồng Tháp" },
        { slug: "vinh-long", name: "Tủ sách Vĩnh Long" },
      ]}
    />,
  );
  expect(hrefsFor(html, MINE)).toEqual(["/tu-sach", "/tu-sach"]);
});

test("FrontDoorHeader offers no shelf link to a super admin, who belongs to none", () => {
  const html = renderToStaticMarkup(
    <FrontDoorHeader viewerName="Trần Quốc Anh" isSuperAdmin shelves={[]} />,
  );
  expect(hrefsFor(html, MINE)).toEqual([]);
  // The link they do get, and the reason Task 6 added it.
  expect(hrefsFor(html, "Quản trị hệ thống")).toEqual(["/quan-tri", "/quan-tri"]);
});

test("FrontDoorHeader offers a stranger sign-in, and no shelf link", () => {
  const html = renderToStaticMarkup(
    <FrontDoorHeader viewerName={null} isSuperAdmin={false} shelves={[]} />,
  );
  expect(hrefsFor(html, MINE)).toEqual([]);
  expect(hrefsFor(html, "Đăng nhập")).toEqual(["/dang-nhap"]);
});

test.each([["Nguyễn Văn A"], [null]] as const)(
  "ShelfHeader links home for viewerName=%s",
  (viewerName) => {
    // Both cases, deliberately: `/dang-nhap` and `/dang-ky` render this header
    // with no viewer, and a visitor looking at a sign-in form is exactly who
    // most needs a way back to the site they arrived from.
    const html = renderToStaticMarkup(
      <ShelfHeader
        shelfName="Thư viện Đồng Tháp"
        shelfSlug="x"
        viewerName={viewerName}
      />,
    );
    expect(hrefsFor(html, "OLibra")).toEqual(["/"]);
  },
);
