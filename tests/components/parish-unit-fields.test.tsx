import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ParishUnitFields } from "../../src/components/parish-unit-fields";
import { defaultTaxonomy } from "../../src/domain/members/parish-taxonomy";

/**
 * QA remediation branch's final review. The empty state a shelf with no
 * parish units renders (`Tủ sách chưa khai báo giáo họ nào.`) used to say
 * "Quản lý thêm ở mục Cơ cấu giáo xứ" to every manager filling in
 * `nguoi-doc/moi` — but `co-cau`'s own `canEdit = viewer.role ===
 * "super_admin"` means an ordinary manager who follows that link lands on a
 * page where all twelve write controls are suppressed. The empty state
 * appeared on every fresh install, for every manager, at exactly the moment
 * they hit the gap it was pointing at.
 *
 * `canManageUnits` is what fixes it: `false` (the default, matching a
 * manager who is not a super admin) gets a sentence naming who *can* add a
 * unit rather than inviting the reader to; `true` (only passed when the
 * caller already knows the viewer is `super_admin`) keeps the original,
 * accurate invitation. Both still link to `co-cau` — the read-only page is
 * correct and stays, only the claim of agency changes.
 */
const EMPTY_TAXONOMY = defaultTaxonomy();

test("a manager who cannot edit units is not invited to", () => {
  const html = renderToStaticMarkup(
    <ParishUnitFields
      idPrefix="t"
      taxonomy={EMPTY_TAXONOMY}
      units={[]}
      manageHref="/tu-sach/x/quan-ly/co-cau"
      canManageUnits={false}
    />,
  );
  expect(html).toContain("Chỉ quản trị viên hệ thống mới thêm được");
  expect(html).not.toContain("Quản lý thêm ở mục");
  // Still links to the read-only page — the invitation's wording changes,
  // not the page's availability.
  expect(html).toContain('href="/tu-sach/x/quan-ly/co-cau"');
});

test("a super admin keeps the original, accurate invitation", () => {
  const html = renderToStaticMarkup(
    <ParishUnitFields
      idPrefix="t"
      taxonomy={EMPTY_TAXONOMY}
      units={[]}
      manageHref="/tu-sach/x/quan-ly/co-cau"
      canManageUnits={true}
    />,
  );
  expect(html).toContain("Quản lý thêm ở mục");
  expect(html).not.toContain("Chỉ quản trị viên hệ thống mới thêm được");
  expect(html).toContain('href="/tu-sach/x/quan-ly/co-cau"');
});

test("no manageHref (a guest filling /dang-ky) gets neither sentence, default canManageUnits or not", () => {
  const html = renderToStaticMarkup(
    <ParishUnitFields idPrefix="t" taxonomy={EMPTY_TAXONOMY} units={[]} />,
  );
  expect(html).not.toContain("Quản lý thêm ở mục");
  expect(html).not.toContain("Chỉ quản trị viên hệ thống mới thêm được");
  expect(html).toContain("Tủ sách chưa khai báo giáo họ nào.");
});
