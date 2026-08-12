import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ContactList } from "../../src/components/ui/contact-list";

/**
 * PO feedback round 1, Task 4. Follows `tests/components/phone-link.test.tsx`
 * for how this suite renders a server component — `renderToStaticMarkup`
 * directly, no React Testing Library, since every component under test here
 * is a server component with no client behaviour to simulate.
 */

function render(props: Parameters<typeof ContactList>[0]) {
  return renderToStaticMarkup(<ContactList {...props} />);
}

test("a single contact renders with no disclosure control", () => {
  const html = render({
    contacts: [
      {
        position: 1,
        name: "Maria Nguyễn Thị Lan",
        phone: "0912345678",
        roleLabel: "Người giữ chìa khoá",
      },
    ],
  });
  expect(html).toContain("Maria Nguyễn Thị Lan");
  expect(html).toContain("Người giữ chìa khoá");
  expect(html).not.toContain("<summary");
});

test("two extra contacts sit behind a summary that counts them", () => {
  const html = render({
    contacts: [
      {
        position: 1,
        name: "Maria Nguyễn Thị Lan",
        phone: "0912345678",
        roleLabel: null,
      },
      {
        position: 2,
        name: "Giuse Trần Minh",
        phone: null,
        roleLabel: "Quản lý tủ sách",
      },
      {
        position: 3,
        name: "Têrêsa Lê Ngọc Ánh",
        phone: "0900111222",
        roleLabel: null,
      },
    ],
  });
  expect(html).toContain("Xem thêm 2 người liên hệ");
  expect(html).toContain("Têrêsa Lê Ngọc Ánh");
});

test("one extra contact says one, not two", () => {
  const html = render({
    contacts: [
      { position: 1, name: "Maria Nguyễn Thị Lan", phone: null, roleLabel: null },
      { position: 2, name: "Giuse Trần Minh", phone: null, roleLabel: null },
    ],
  });
  expect(html).toContain("Xem thêm 1 người liên hệ");
});

test("no contacts renders nothing at all", () => {
  expect(render({ contacts: [] })).toBe("");
});
