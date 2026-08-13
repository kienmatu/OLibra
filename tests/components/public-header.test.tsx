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
/**
 * PO feedback round 1, Task 5 — extended (not duplicated) for the topbar's
 * new `canManage`/`isSuperAdmin` props and its mobile search/avatar-panel
 * markup, rather than growing a second render helper beside this one.
 * `shelfSlug` moved from `"x"` to `"dong-thap"` so the same helper can assert
 * on real hrefs (`/tu-sach/dong-thap/quan-ly`, the search form's `action`)
 * without a caller having to know the slug is otherwise arbitrary.
 */
function renderShelfHeader({
  active,
  viewerName = "Nguyễn Văn A",
  canManage = false,
  isSuperAdmin = false,
}: {
  active?: Parameters<typeof ShelfHeader>[0]["active"];
  viewerName?: string | null;
  canManage?: boolean;
  isSuperAdmin?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <ShelfHeader
      shelfName="Thư viện Đồng Tháp"
      shelfSlug="dong-thap"
      viewerName={viewerName}
      active={active}
      canManage={canManage}
      isSuperAdmin={isSuperAdmin}
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
//
// `/tu-sach/dong-thap/danh-muc` still passes `active="danh-muc"` (PO
// feedback round 1, Task 5), but the nav no longer carries a "Danh mục" link
// — Task 4 gave the shelf home the one catalogue link — so that page now
// lights up nothing, which is the one row below asserting `[]` rather than a
// label.
test.each([
  ["/tu-sach/dong-thap/danh-muc", "danh-muc", []],
  ["/tu-sach/dong-thap/thong-bao", "thong-bao", ["Bản tin"]],
  ["/tu-sach/dong-thap/ho-so/tong-quan", "toi", ["Trang của tôi"]],
  ["/tu-sach/dong-thap/ho-so/thong-bao", "thong-bao-cua-toi", ["Thông báo"]],
  ["/tu-sach/dong-thap/tim-kiem", "tim-kiem", ["Tìm kiếm"]],
] as const)(
  "%s (active=%s) marks exactly %j active",
  (_pathname, active, labels) => {
    const html = renderShelfHeader({ active });
    expect(activeLabels(html)).toEqual(labels);
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

/**
 * PO feedback round 1, Task 5, fix round 1. Scopes an assertion to the mobile
 * `<details>…</details>` panel rather than the whole rendered string.
 *
 * The finding this exists for: `toContain("Quản lý tủ sách")` against the
 * *whole* `html` string passes whether that link is in the desktop `<nav>`,
 * the mobile panel, or both — `ShelfHeader` renders both in one
 * `renderToStaticMarkup` call, so a bug that left the panel empty (shipped in
 * fix round 0) was invisible to an assertion that did not first narrow to the
 * panel's own markup. There is exactly one `<details>` in any `ShelfHeader`
 * render (`MobileMenu` is the only caller of it), so a single non-greedy match
 * is unambiguous.
 */
function mobilePanelHtml(html: string): string {
  const match = html.match(/<details\b[\s\S]*?<\/details>/);
  if (!match) throw new Error("renderShelfHeader produced no mobile panel");
  return match[0];
}

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
        canManage={false}
        isSuperAdmin={false}
      />,
    );

    // **The home link is an icon, so the assertion is on its accessible name.**
    // The mark replaced the word "OLibra" in this header (the product's name
    // competing with the parish's is noise on the one line that has to say
    // which shelf you are looking at), and an icon-only link that announces
    // nothing is the failure mode that swap invites. `hrefsFor` reads text
    // content, which is exactly what the `sr-only` span puts there — an
    // `aria-label` would leave this assertion matching the empty string and
    // passing against a link with no name at all.
    expect(hrefsFor(html, "OLibra — trang chủ")).toEqual(["/"]);
  },
);

/**
 * PO feedback round 1, Task 5: the search box, the avatar panel and the two
 * management links.
 */
test("Danh mục is no longer in the reader nav", () => {
  const html = renderShelfHeader({
    viewerName: "Maria Nguyễn Thị Lan",
    canManage: false,
    isSuperAdmin: false,
  });
  expect(html).not.toContain("Danh mục");
  expect(html).toContain("Bản tin");
  expect(html).toContain("Tìm kiếm");
});

test("a manager gets a link into the manager area", () => {
  const html = renderShelfHeader({
    viewerName: "Giuse Trần Minh",
    canManage: true,
    isSuperAdmin: false,
  });
  expect(html).toContain("Quản lý tủ sách");
  expect(html).toContain("/tu-sach/dong-thap/quan-ly");
  expect(html).not.toContain("Quản trị hệ thống");
});

test("a super admin also gets the system admin link", () => {
  const html = renderShelfHeader({
    viewerName: "Quản trị viên",
    canManage: true,
    isSuperAdmin: true,
  });
  expect(html).toContain("Quản trị hệ thống");
  expect(html).toContain('href="/quan-tri"');
});

test("an ordinary reader gets neither management link", () => {
  const html = renderShelfHeader({
    viewerName: "Anna Phạm Thu Hà",
    canManage: false,
    isSuperAdmin: false,
  });
  expect(html).not.toContain("Quản lý tủ sách");
  expect(html).not.toContain("Quản trị hệ thống");
});

/**
 * Design spec §6: "Both appear in the desktop nav and inside the mobile
 * panel (§7)." Fix round 1 — the three tests above assert against the whole
 * `html` string, which cannot tell "in the desktop nav" from "in the panel
 * too" apart; they passed against fix round 0's shipped bug, where
 * `managementLinks` reached the desktop `<nav>` only. These three narrow to
 * `mobilePanelHtml` specifically, so they fail again if that regresses.
 */
test("a manager's mobile panel also carries the management link", () => {
  const html = renderShelfHeader({
    viewerName: "Giuse Trần Minh",
    canManage: true,
    isSuperAdmin: false,
  });
  const panel = mobilePanelHtml(html);
  expect(panel).toContain("Quản lý tủ sách");
  expect(panel).toContain("/tu-sach/dong-thap/quan-ly");
  expect(panel).not.toContain("Quản trị hệ thống");
});

test("a super admin's mobile panel also carries the system admin link", () => {
  const html = renderShelfHeader({
    viewerName: "Quản trị viên",
    canManage: true,
    isSuperAdmin: true,
  });
  const panel = mobilePanelHtml(html);
  expect(panel).toContain("Quản trị hệ thống");
  expect(panel).toContain('href="/quan-tri"');
});

test("an ordinary reader's mobile panel carries neither management link", () => {
  const html = renderShelfHeader({
    viewerName: "Anna Phạm Thu Hà",
    canManage: false,
    isSuperAdmin: false,
  });
  const panel = mobilePanelHtml(html);
  expect(panel).not.toContain("Quản lý tủ sách");
  expect(panel).not.toContain("Quản trị hệ thống");
});

test("the mobile search form posts into the search page", () => {
  const html = renderShelfHeader({
    viewerName: "Maria Nguyễn Thị Lan",
    canManage: false,
    isSuperAdmin: false,
  });
  expect(html).toContain('action="/tu-sach/dong-thap/tim-kiem"');
  expect(html).toContain('name="q"');
});

/**
 * Fix round 1. The original version of this test asserted
 * `toContain("/ho-so/tong-quan")` and `toContain("Trang của tôi")` against the
 * whole `html` string — and both strings already existed in `ShelfHeader`'s
 * pre-Task-5 `links` array (the plain reader nav link to "Trang của tôi"),
 * which renders into the panel's link list with or without the new profile
 * block. The test passed byte-for-byte against the pre-Task-5 header and
 * proved nothing about the block this task adds.
 *
 * Both the profile block and the plain reader-nav link point at
 * `/ho-so/tong-quan`, so this narrows to the panel and asserts on what is
 * unique to the *block*: the reader's own name appears inside the anchor
 * (the plain nav link never carries a name), and the block carries the
 * avatar circle (`rounded-full`) the plain nav link does not.
 */
test("the mobile panel's profile block names the reader and links to their own page", () => {
  const name = "Maria Nguyễn Thị Lan";
  const html = renderShelfHeader({
    viewerName: name,
    canManage: false,
    isSuperAdmin: false,
  });
  const panel = mobilePanelHtml(html);
  const anchorsToProfile = [
    ...panel.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
  ].filter((m) => m[1] === "/tu-sach/dong-thap/ho-so/tong-quan");

  // Two anchors point here: the profile block itself, first in document
  // order, and the plain "Trang của tôi" reader-nav link below it — both
  // real, both expected, and only the first carries the reader's name.
  expect(anchorsToProfile).toHaveLength(2);
  const [profileBlock, readerNavLink] = anchorsToProfile;

  expect(profileBlock[2]).toContain(name);
  expect(profileBlock[2]).toContain("Trang của tôi");
  // The avatar circle — markup no plain nav link in this panel has.
  expect(profileBlock[0]).toContain("rounded-full");

  // The plain reader-nav link, by contrast, carries no name — confirming the
  // two anchors are genuinely distinct rather than one being a stray extra
  // match of the other.
  expect(readerNavLink[2].replace(/<[^>]*>/g, "").trim()).toBe("Trang của tôi");
  expect(readerNavLink[0]).not.toContain(name);
});

test("a signed-out visitor gets no search box and no panel", () => {
  const html = renderShelfHeader({
    viewerName: null,
    canManage: false,
    isSuperAdmin: false,
  });
  expect(html).not.toContain('name="q"');
  // "no panel", stated in the test's own name, was previously unverified —
  // this render skips `MobileMenu` entirely for `viewerName === null`
  // (`ShelfHeader`'s own `viewerName === null` branch), so there is no
  // `<details>` at all, not merely an empty one.
  expect(html).not.toContain("<details");
  expect(html).toContain("Đăng nhập");
});
