import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { startTestServer, type TestServer } from "../support/http";

/**
 * Registration through **Next's own request handler**, over real HTTP.
 *
 * The defect this file exists for: `src/instrumentation.ts` called
 * `setPasswordHasher` and the value never reached the server action, because
 * Turbopack bundles `src/domain/members/registration.ts` (now
 * `src/domain/kernel/crypto.ts`) once per layer and a module-level `let` is
 * per-instance — instrumentation runs in the `node` layer, the server action
 * runs in the `react-server` layer, and wiring one never wires the other.
 * `POST /dang-ky` with a username and password returned 500 for every reader
 * who supplied one.
 *
 * **Every unit test was green regardless**, and that is exactly why this file
 * has to go through HTTP rather than call `registerMembershipAction`
 * directly. `tests/architecture/the-password-hasher-is-wired.test.ts` used to
 * assert `instrumentation.ts`'s *source text* mentioned `setPasswordHasher(` —
 * true the whole time the product was broken, because the assertion never
 * crossed the layer boundary the bug lives in. Calling the action function in
 * the vitest process does not cross it either: the suite's own setup wires
 * the port before any test runs, so a direct call would pass whether or not
 * the request path wires itself. A real request to a real `next dev` process
 * is the one thing that reproduces the two-instances-of-one-module problem —
 * see `tests/support/http.ts` for the harness this shares with
 * `tests/lib/avatar-over-http.test.ts`, the first file that needed it.
 */

/** A port nothing else in this project uses; see `tests/support/http.ts`. */
const PORT = 3098;
const REGISTER = "/dang-ky?tu-sach=dong-thap";

let server: TestServer;

beforeAll(async () => {
  await migrate(sql);
  await resetDatabase();
  // The shelf `/dang-ky?tu-sach=dong-thap` names. Written directly rather
  // than through `registerMembership` — that command is the thing under
  // test — and the seeded demo data would be a much larger dependency for
  // one request.
  await makeShelf(sql, { slug: "dong-thap" });
  server = await startTestServer(PORT);
}, 120_000);

afterAll(async () => {
  await closeAll();
  await server?.close();
});

/**
 * The `$ACTION_ID_…` of `/dang-ky`'s registration form.
 *
 * A no-JS form bound to a server action renders that hidden field, and it is
 * how a real browser POST identifies the action — the whole point of going
 * through HTTP here. Found by looking at the one form containing
 * `name="ho-ten"` rather than by position, the same way
 * `avatar-over-http.test.ts`'s `avatarActionId` avoids depending on which
 * form happens to render first.
 */
async function registrationActionId(): Promise<string> {
  const html = await fetch(`${server.origin}${REGISTER}`).then((r) => r.text());
  const form = html
    .split("<form")
    .find(
      (chunk) => chunk.includes('name="ho-ten"') && chunk.includes("$ACTION_ID_"),
    );
  const id = form?.match(/\$ACTION_ID_[0-9a-f]+/)?.[0];
  if (!id)
    throw new Error("no registration form with a server-action id on the page");
  return id;
}

interface RegistrationFields {
  shelf: string;
  username?: string;
  password?: string;
  fullName: string;
  dateOfBirth: string;
  fatherName: string;
  motherName: string;
  phone: string;
}

/**
 * Posts the registration form the way the real page does, field name for
 * field name (`src/app/dang-ky/page.tsx`, `src/app/dang-ky/actions.ts`).
 *
 * **`nhap-lai-mat-khau` is always sent alongside `password`, matching it —
 * this is the detail that makes the test exercise the actual defect.** The
 * confirm field is a second `<input>` inside the same `<form>`, always
 * present in the request body a real browser sends, not merely included when
 * the visitor bothers to fill it in twice. `credentialsFrom`
 * (`src/domain/members/registration.ts`) treats an *absent* confirm field as
 * `null`, which fails `passwords_dont_match` — a 303, not a 500 — before
 * `hasher(password)` is ever reached. A POST that omitted the field would
 * report a false positive: it would never call the code this file exists to
 * prove is wired, and would pass identically whether or not that code
 * worked.
 */
async function postRegistration(fields: RegistrationFields): Promise<Response> {
  const form = new FormData();
  form.append(await registrationActionId(), "");
  form.append("tu-sach", fields.shelf);
  if (fields.username !== undefined) form.append("ten-dang-nhap", fields.username);
  if (fields.password !== undefined) {
    form.append("mat-khau", fields.password);
    form.append("nhap-lai-mat-khau", fields.password);
  }
  form.append("ho-ten", fields.fullName);
  form.append("ngay-sinh", fields.dateOfBirth);
  form.append("ten-cha", fields.fatherName);
  form.append("ten-me", fields.motherName);
  form.append("dien-thoai", fields.phone);

  return fetch(`${server.origin}${REGISTER}`, {
    method: "POST",
    body: form,
    headers: { origin: server.origin },
    // The answer this file cares about *is* the redirect (a 303 to `?loi=…`
    // is the application deciding); anything else means something upstream
    // of application code decided instead — a bare 500, in this defect's case.
    redirect: "manual",
  });
}

test("registering with a username and password does not 500", async () => {
  const res = await postRegistration({
    shelf: "dong-thap",
    username: "qa.http.probe",
    password: "matkhau123",
    fullName: "QA Probe",
    dateOfBirth: "2014-01-01",
    fatherName: "QA Cha",
    motherName: "QA Me",
    phone: "0900000000",
  });

  expect(res.status, await res.text()).not.toBe(500);
}, 30_000);
