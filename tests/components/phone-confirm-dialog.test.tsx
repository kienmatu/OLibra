import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PhoneConfirmDialog } from "../../src/components/phone-confirm-dialog";

/**
 * Fix round 1 (PO feedback round 1, Task 8). The review found: the dialog's
 * cancel button (`type="submit"` inside its own `<form method="dialog">`)
 * shares that form with a `<Textarea required>`, and a browser runs
 * interactive constraint validation *before* branching on `method="dialog"`
 * — so clicking "Quay lại nhập số" while the textarea is empty, which is the
 * state the dialog opens in every time, fired the native validation bubble
 * instead of closing.
 *
 * No jsdom/testing-library is configured in this suite (`vitest.config.ts`
 * has no `environment` set, and `tests/components/*.test.tsx` render to a
 * static string rather than simulate interaction — `parish-unit-fields
 * .test.tsx` is the existing pattern this follows). So there is no way to
 * simulate the click itself here; this is a static assertion that the fix
 * — dropping HTML `required` from the dialog's own textarea, so its own
 * cancel button never faces a blocked constraint validation — is actually
 * in the markup, plus the properties around it that make the fix correct
 * rather than merely absent.
 */

function html() {
  return renderToStaticMarkup(<PhoneConfirmDialog formId="mau-form" />);
}

test("the dialog's own reason textarea carries no HTML required", () => {
  const markup = html();
  const textarea = markup.match(/<textarea\b[^>]*>/)?.[0];
  expect(textarea, "no <textarea> found in the dialog").toBeDefined();
  expect(textarea).not.toMatch(/\brequired\b/);
});

/**
 * The `disabled` *attribute*, never Tailwind's `disabled:pointer-events-none`
 * class name — that substring also contains the word "disabled" followed by
 * a non-word character, which a bare `\bdisabled\b` regex over the whole tag
 * (`class` attribute included) would match regardless of whether the real
 * attribute is present. Stripping `class="…"` first is what makes this check
 * about the attribute rather than about the styling.
 */
function hasDisabledAttribute(buttonTag: string): boolean {
  return /\bdisabled(?:\s|>|=)/.test(buttonTag.replace(/\sclass="[^"]*"/, ""));
}

test("the confirm button is disabled on first render — the real gate the textarea's required used to duplicate", () => {
  // The dialog always opens with its own reason state reset to "", so the
  // confirm button — the button that actually matters, "Vẫn tiếp tục không
  // có số điện thoại" — must start disabled regardless of the textarea's own
  // (now absent) constraint.
  const markup = html();
  const confirmIndex = markup.indexOf("Vẫn tiếp tục không có số điện thoại");
  expect(confirmIndex).toBeGreaterThan(-1);
  const buttonStart = markup.lastIndexOf("<button", confirmIndex);
  const buttonTag = markup.slice(buttonStart, markup.indexOf(">", buttonStart) + 1);
  expect(hasDisabledAttribute(buttonTag)).toBe(true);
});

test('the cancel button is a plain, unblocked submit inside the dialog\'s own method="dialog" form', () => {
  const markup = html();
  const cancelIndex = markup.indexOf("Quay lại nhập số");
  expect(cancelIndex).toBeGreaterThan(-1);
  const buttonStart = markup.lastIndexOf("<button", cancelIndex);
  const buttonTag = markup.slice(buttonStart, markup.indexOf(">", buttonStart) + 1);
  // Never disabled, and carries no `formnovalidate` — with `required` gone
  // from the only field in this form, neither is needed for the click to
  // reach `method="dialog"`'s own close behaviour.
  expect(hasDisabledAttribute(buttonTag)).toBe(false);
  expect(markup).toContain('method="dialog"');
});

test("byte-exact copy, unchanged by this fix round", () => {
  const markup = html();
  expect(markup).toContain("Chưa có số điện thoại");
  expect(markup).toContain(
    "Tủ sách sẽ không có cách nào liên lạc với người này. Hãy cho biết vì sao chưa có số điện thoại.",
  );
  expect(markup).toContain("Lý do");
  expect(markup).toContain("Vẫn tiếp tục không có số điện thoại");
  expect(markup).toContain("Quay lại nhập số");
});
