import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { SiteFooter } from "../../src/components/shell/site-footer";

/**
 * U6 §6. The footer rendered on four pages and was hardcoded to a wordmark,
 * two links and a copyright line — while a super admin filled in a contact
 * name, telephone number and hours at `/quan-tri/cai-dat` that exactly one
 * page in the application ever displayed.
 *
 * **`contact` is a prop, and that is the design rather than a convenience.**
 * A footer that read the database itself would be in the import closure of
 * every page that renders it, and
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` walks
 * those closures transitively — so `/loi`, which must render when the database
 * is the thing that failed, would be dragged into needing a database. The
 * `null` case below is that page, and it is a correctness case, not a
 * fallback.
 *
 * The empty-contact case is a fresh installation: `system_settings` has a row
 * with three nulls in it long before an administrator fills them in, and a
 * heading over three blank lines is worse than no heading.
 */
const HEADING = "Liên hệ ban quản trị";

test("SiteFooter shows the administrator's contact when there is one", () => {
  const html = renderToStaticMarkup(
    <SiteFooter
      contact={{
        name: "Giuse Trần Quốc Anh",
        phone: "0912345678",
        hours: "Thứ Hai đến Thứ Sáu, 8h–17h",
      }}
    />,
  );

  expect(html).toContain(HEADING);
  expect(html).toContain("Giuse Trần Quốc Anh");
  expect(html).toContain("Thứ Hai đến Thứ Sáu, 8h–17h");
  // Through `PhoneLink`, never as plain text (AGENTS.md's shared-components
  // table) — so the number a parish rings is tappable on the phone they are
  // holding.
  expect(html).toContain('href="tel:0912345678"');
});

test("SiteFooter renders no contact block for a page that did not ask", () => {
  const html = renderToStaticMarkup(<SiteFooter contact={null} />);

  expect(html).not.toContain(HEADING);
  // Still a footer: the links and the copyright are what it always was.
  expect(html).toContain("Tìm tủ sách");
  expect(html).toContain("Liên hệ");
  expect(html).toContain("OLibra");
});

test("SiteFooter renders no contact block on a fresh installation", () => {
  const html = renderToStaticMarkup(
    <SiteFooter contact={{ name: null, phone: null, hours: null }} />,
  );

  expect(html).not.toContain(HEADING);
});

// — the shelf's own address, post-review fix wave item 8 —

test("SiteFooter shows the shelf's address when a signed-in member is looking", () => {
  const html = renderToStaticMarkup(
    <SiteFooter
      contact={null}
      shelfAddress={{
        location: "Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú",
        address: "12 Nguyễn Huệ, Phường Bến Nghé",
      }}
    />,
  );

  expect(html).toContain("Địa chỉ tủ sách");
  expect(html).toContain("Nhà xứ Đồng Tháp, ấp Tân Hoà, xã Tân Phú");
  expect(html).toContain("12 Nguyễn Huệ, Phường Bến Nghé");
});

test("SiteFooter renders no address block on a front-door page, which never passes the prop", () => {
  // Every one of the six front-door routes (`/`, `/tu-sach`, `/lien-he`,
  // `/dang-nhap`, `/dang-ky`, `/loi`) calls `<SiteFooter contact={...} />`
  // with no `shelfAddress` at all — there is no shelf on any of them. This is
  // that call, and it must render exactly what it always did.
  const html = renderToStaticMarkup(<SiteFooter contact={null} />);

  expect(html).not.toContain("Địa chỉ tủ sách");
});

test("SiteFooter renders no address block for a shelf page whose viewer is not a member", () => {
  // `readShelfAddressForFooter` (`src/lib/shelf.ts`) answers `null` rather
  // than throwing for a guest or a non-member, and this is the footer's own
  // half of that: `null` and "did not ask" must look identical on the page.
  const html = renderToStaticMarkup(
    <SiteFooter contact={null} shelfAddress={null} />,
  );

  expect(html).not.toContain("Địa chỉ tủ sách");
});

test("SiteFooter renders no address block for a shelf that has filled in neither field", () => {
  const html = renderToStaticMarkup(
    <SiteFooter contact={null} shelfAddress={{ location: null, address: null }} />,
  );

  expect(html).not.toContain("Địa chỉ tủ sách");
});

test("SiteFooter shows the shelf's address and the administrator's contact together", () => {
  // The two blocks are independent — a shelf page for a signed-in member
  // renders both, side by side, neither one crowding the other out.
  const html = renderToStaticMarkup(
    <SiteFooter
      contact={{ name: "Giuse Trần Quốc Anh", phone: "0912345678", hours: null }}
      shelfAddress={{ location: "Nhà xứ Đồng Tháp", address: null }}
    />,
  );

  expect(html).toContain("Liên hệ ban quản trị");
  expect(html).toContain("Địa chỉ tủ sách");
  expect(html).toContain("Nhà xứ Đồng Tháp");
});

test("SiteFooter shows a contact with a name and no telephone", () => {
  // Both columns are nullable and an administrator may fill in one of them.
  // The block appears, and there is simply no number in it — not an empty
  // `tel:` link, which is a control that cannot be operated.
  const html = renderToStaticMarkup(
    <SiteFooter
      contact={{ name: "Giuse Trần Quốc Anh", phone: null, hours: null }}
    />,
  );

  expect(html).toContain(HEADING);
  expect(html).toContain("Giuse Trần Quốc Anh");
  expect(html).not.toContain("tel:");
});
