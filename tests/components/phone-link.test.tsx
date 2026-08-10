import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PhoneLink } from "../../src/components/ui/phone-link";

/**
 * QA remediation Task 18. `khong-phai-so` was accepted into "Số điện thoại"
 * before this task added `assertPhone` to every write path, and rendered here
 * as `<a href="tel:khong-phai-so">` on the approval card, the reader profile
 * and the overdue list — a tap target that looks exactly as real as a working
 * one and dials nothing. `PhoneLink` now checks `isValidPhone`
 * (`src/domain/members/policy.ts`) itself rather than trusting every caller to
 * have validated first, since a row written before the guard existed, or
 * written directly against the database, can still reach it.
 */

function render(props: Parameters<typeof PhoneLink>[0]) {
  return renderToStaticMarkup(<PhoneLink {...props} />);
}

test("a real phone number renders a tel: link", () => {
  const html = render({ phone: "0912 345 678" });
  expect(html).toContain('href="tel:0912345678"');
  expect(html).toContain("0912 345 678");
});

test("a value that does not parse renders no tel: link, but is not hidden", () => {
  const html = render({ phone: "khong-phai-so" });
  expect(html).not.toContain("tel:");
  expect(html).not.toContain("<a ");
  // The bad value is still visible — a manager reading the row should see
  // that the number on file is wrong, not a blank cell.
  expect(html).toContain("khong-phai-so");
});

test("a +84-prefixed number still renders a tel: link", () => {
  const html = render({ phone: "+84912345678" });
  expect(html).toContain('href="tel:+84912345678"');
});
