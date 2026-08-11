import { afterAll, beforeAll, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { systemClock } from "../../src/domain/kernel/clock";
import { setPasswordVerifier } from "../../src/domain/kernel/crypto";
import { migrate } from "../../src/db/migrate";
import { AVATAR_MAX_BYTES } from "../../src/lib/avatar";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeShelf, makeUser } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { startTestServer, type TestServer } from "../support/http";

/**
 * The avatar upload through **Next's own request handler**, over real HTTP.
 *
 * ── Why this file exists, when `avatar-actions.test.ts` already covers the
 * avatar end to end ─────────────────────────────────────────────────────────
 *
 * Because that file calls `proposeAvatarAction(formData)` as a function, and a
 * server action reached that way has already skipped everything the framework
 * does to a request body. Next applies a body-size limit of its own before the
 * action is invoked — `defaultBodySizeLimit = '1 MB'` in
 * `next/dist/server/app-render/action-handler.js` — and nothing in this project
 * configured it, so for a long time the number the profile screen states (2 MB,
 * `AVATAR_MAX_BYTES`, and OPS §4.3's `file_too_large`: "Ảnh vượt quá 2 MB.")
 * was not the number that decided.
 *
 * Measured over HTTP before `next.config.ts` set `serverActions.bodySizeLimit`:
 * a 1.6 MB multipart POST to the profile page's avatar form came back as a 500
 * carrying `Body exceeded 1 MB limit.` (`E394`) with no Vietnamese, no `?loi=`
 * and no application code run at all. A volunteer photographing a child on a
 * phone produces a 1.4 MB JPEG as a matter of course; every one of them landed
 * in that band, on a screen that says the limit is 2 MB. The whole suite was
 * green throughout, because the whole suite called the function.
 *
 * So this file is deliberately the expensive kind of test — it boots a dev
 * server. `tests/lib/registration-over-http.test.ts` is the other one, for the
 * equivalent reason one Turbopack layer over: a module wired correctly in one
 * server-build layer and not another, which only a real request can observe.
 * This file exists to hold one boundary that cannot be observed from inside
 * the process, and it is written so that *moving either number* makes it fail
 * rather than merely making it stale: the assertions are about which of the
 * two limits answered, not about the numbers.
 *
 * ── What it does not need ───────────────────────────────────────────────────
 *
 * No object store, and — until U5 — no database. Both refusals below are raised
 * by `storeProposedAvatar` before it touches either: the content-type check and
 * the size check are the first two statements, so the only thing under test is
 * the path from the socket to those two lines.
 *
 * **The GET that scrapes the action id is a different matter now.** This file
 * used to say it needed nothing, because the profile page rendered from
 * `@/lib/fixtures` and served anybody. U5 wired it to `loadPage` and
 * `getMyProfile`, so a request with no session is redirected to sign in and
 * carries no form at all — which is how this test failed, with `no avatar form
 * with a server-action id on the page`, on a change that had nothing to do with
 * body limits.
 *
 * So it signs in, the same way `scripts/check-links.mjs` does: a shelf and a
 * member written directly, then `signIn` against the real `sessions` table, and
 * the cookie on both the GET and the POST. That is a cost this test did not have
 * and now does. It is the honest one — the alternative is scraping the id from
 * some other page, which would mean this test's subject drifts to whatever page
 * happens to still be public.
 */

/**
 * A port nothing else in this project uses: `bun run dev` takes 3000, compose
 * publishes the app on `APP_PORT` (3001 in `.env.example`), and CI's `links`
 * job crawls 3000. Fixed rather than random so a leaked process is findable.
 *
 * The spawn-and-wait machinery this test used to own directly — draining the
 * child's output, telling "never started listening" apart from "another dev
 * server already owns this project directory", restoring `tsconfig.json`
 * afterwards — now lives in `tests/support/http.ts`, once
 * `tests/lib/registration-over-http.test.ts` needed the identical sequence a
 * second time. That file carries the reasoning for each piece of it; nothing
 * below repeats it.
 */
const PORT = 3097;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROFILE = "/tu-sach/dong-thap/ho-so";

let server: TestServer;
/** The signed-in reader's session cookie, for every request below. */
let cookie: string;

beforeAll(async () => {
  // A shelf at the slug `PROFILE` names, and one reader of it who can sign in.
  // Written directly rather than through `registerMembership`, because what is
  // under test is a body limit and not a registration — and because the seeded
  // demo data would be a much larger dependency for one session.
  await migrate(sql);
  await resetDatabase();
  setPasswordVerifier(verifyPassword);
  const shelf = await makeShelf(sql, { slug: "dong-thap" });
  const user = await makeUser(sql, { fullName: "Giuse Trần Minh" });
  await sql`
    update users
       set username = 'anh-doc', password_hash = ${await hashPassword("olibra-dev")}
     where id = ${user.id}
  `;
  await sql`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (${shelf.id}, ${user.id}, 'reader', 'active')
  `;
  const { token } = await signIn(sql, {
    username: "anh-doc",
    password: "olibra-dev",
    clock: systemClock,
  });
  cookie = `${SESSION_COOKIE}=${token}`;

  server = await startTestServer(PORT);
}, 70_000);

afterAll(async () => {
  await closeAll();
  await server?.close();
});

/**
 * The `$ACTION_ID_…` of the form that carries the file input.
 *
 * A no-JS form bound to a server action renders that hidden field, and it is
 * how a real browser POST identifies the action — which is the whole point of
 * going through HTTP here. The page has three action-bound forms (the header's
 * sign-out renders twice), so it is found by looking at the one containing
 * `name="anh"` rather than by position, which would silently start testing the
 * sign-out form the day the header changes.
 */
async function avatarActionId(): Promise<string> {
  const html = await fetch(`${ORIGIN}${PROFILE}`, {
    headers: { cookie },
  }).then((r) => r.text());
  const form = html
    .split("<form")
    .find((chunk) => chunk.includes('name="anh"') && chunk.includes("$ACTION_ID_"));
  const id = form?.match(/\$ACTION_ID_[0-9a-f]+/)?.[0];
  if (!id) throw new Error("no avatar form with a server-action id on the page");
  return id;
}

interface Posted {
  status: number;
  location: string | null;
  /** The refusal code the action put in `?loi=`, or null. */
  refusal: string | null;
  body: string;
}

/**
 * Posts a multipart body of exactly `bytes` bytes of file content, the way the
 * profile page's own form does.
 *
 * `redirect: "manual"` because the answer this file is interested in *is* the
 * redirect: a 303 to `?loi=…` means the application decided, and anything else
 * means something in front of it did.
 */
async function postPhotograph(bytes: number, type: string): Promise<Posted> {
  const form = new FormData();
  form.append(await avatarActionId(), "");
  form.append("tu-sach", "dong-thap");
  form.append("anh", new File([new Uint8Array(bytes)], "anh", { type }));

  const res = await fetch(`${ORIGIN}${PROFILE}`, {
    method: "POST",
    body: form,
    headers: { origin: ORIGIN, cookie },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  return {
    status: res.status,
    location,
    refusal: new URLSearchParams(location?.split("?")[1] ?? "").get("loi"),
    body: await res.text(),
  };
}

test("a photograph in the 1–2 MB band reaches application code", async () => {
  // The regression. 1.6 MB is between Next's default limit and this
  // application's own, which is where every phone photograph of a child lands,
  // and where the framework used to answer with an untranslated 500 before the
  // action ran.
  //
  // Posted as `application/pdf` on purpose: it makes the application's verdict
  // *deterministic without an object store*, because `storeProposedAvatar`
  // checks the content type first and refuses before it reads a byte or reaches
  // MinIO. What is under test is not the content type — `avatar-actions.test.ts`
  // covers that — but that a body this size gets as far as the code that
  // decides. `invalid_image` is proof that it did; `Body exceeded` would be
  // proof that it did not.
  const posted = await postPhotograph(1_600_000, "application/pdf");

  expect(posted.body).not.toContain("Body exceeded");
  expect(posted.status).toBe(303);
  expect(posted.refusal).toBe("invalid_image");
}, 60_000);

test("the domain's own 2 MB rule is the one that refuses an oversize photograph", async () => {
  // One byte over `AVATAR_MAX_BYTES`, as an image this time, so the only thing
  // left to refuse it is the size check — and the refusal has to be
  // `file_too_large`, whose sentence a reader can act on ("Ảnh vượt quá 2 MB."),
  // rather than the framework's.
  //
  // This is the assertion that fails if `serverActions.bodySizeLimit` is
  // lowered to the domain's own number, or removed: a multipart body is bigger
  // than the file inside it, so a framework limit set *at* 2 MB refuses this
  // request before the domain can, and the sentence disappears again in a
  // narrower band.
  const posted = await postPhotograph(AVATAR_MAX_BYTES + 1, "image/png");

  expect(posted.body).not.toContain("Body exceeded");
  expect(posted.status).toBe(303);
  expect(posted.refusal).toBe("file_too_large");
}, 60_000);

test("the framework limit is still a backstop for a body nobody should buffer", async () => {
  // The other half of the trade, asserted so that "raise the limit" is not read
  // as "remove it". Well over `bodySizeLimit`, so Next refuses it while the
  // bytes are still streaming and no redirect is issued — the request never
  // becomes this application's problem.
  const posted = await postPhotograph(5 * 1024 * 1024, "image/png");

  expect(posted.refusal).toBeNull();
  expect(posted.status).not.toBe(303);
}, 60_000);
