import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { AvatarProposal } from "../../src/components/avatar-proposal";

/**
 * No jsdom is configured (`vitest.config.ts` sets no `environment`), so these
 * render to a static string — the same limitation
 * `tests/components/phone-confirm-dialog.test.tsx` records. What can be
 * asserted is the first paint, which is exactly the paint that has to work
 * with JavaScript unavailable. The preview swap, the pill and the disabling
 * cannot be simulated here and ride on review.
 */

const noop = async () => {};

function html(props: Partial<Parameters<typeof AvatarProposal>[0]> = {}) {
  return renderToStaticMarkup(
    <AvatarProposal
      action={noop}
      slug="dong-thap"
      currentAvatarUrl={null}
      initial="L"
      {...props}
    />,
  );
}

test("the circle shows the photograph when there is one", () => {
  const markup = html({ currentAvatarUrl: "https://anh.example.org/a.webp" });
  expect(markup).toContain("https://anh.example.org/a.webp");
});

test("the circle shows the initial when there is none", () => {
  const markup = html();
  expect(markup).not.toContain("<img");
  expect(markup).toContain("L");
});

test("the copy states the limit and that the photograph will be cropped", () => {
  const markup = html();
  expect(markup).toContain("5 MB");
  expect(markup).toContain("cắt vuông");
});

test("the submit button is not disabled on first paint", () => {
  // With JavaScript unavailable the island never mounts and the form submits
  // as it always would. A `disabled` attribute in the server-rendered markup
  // would make the no-JavaScript path dead rather than merely plainer.
  const button = html().match(/<button\b[^>]*>/)?.[0];
  expect(button, "no <button> found").toBeDefined();
  expect(button?.replace(/\sclass="[^"]*"/, "")).not.toMatch(
    /\bdisabled(?:\s|>|=)/,
  );
});

test("accept does not list HEIC", () => {
  // Load-bearing, and the opposite of what it looks like. iOS Safari
  // transcodes HEIC to JPEG on upload *because* this attribute omits it;
  // listing HEIC tells iOS to send the original, which sharp's prebuilt
  // binaries cannot decode. Pinned so a well-meant widening fails here with
  // the reason attached.
  const accept = html().match(/accept="([^"]*)"/)?.[1] ?? "";
  expect(accept).not.toContain("heic");
  expect(accept).not.toContain("heif");
  expect(accept).toContain("image/jpeg");
});
