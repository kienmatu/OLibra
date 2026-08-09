import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias: `tests/lib/page-data.test.ts`
// imports this module, and Vitest resolves no alias (see any file under
// `src/auth/`, which the suite has always imported the same way).
import { contextFor } from "../auth/guards";
import { pool } from "../db/client";
import { systemClock } from "../domain/kernel/clock";
import { NotFound, RuleViolated } from "../domain/kernel/errors";
import type { TenantContext } from "../domain/kernel/tenant";
import {
  type Command,
  runCommand,
  runPublicQuery,
  runQuery,
  type Tx,
} from "../domain/kernel/unit-of-work";
import { REQUEST_PATH_HEADER, signInPathFor } from "./return-path";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * Session cookie → `TenantContext`, the half `loadPage` and `submitCommand`
 * share.
 *
 * Extracted so the read seam and the write seam cannot drift about *who is
 * asking* — a `submitCommand` that resolved the actor even slightly
 * differently from `loadPage` would let a page render for one identity and
 * write for another, which is the one disagreement neither side could detect.
 */
async function contextForRequest(shelfSlug: string): Promise<TenantContext> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  return contextFor(pool(), {
    token,
    bookshelfSlug: shelfSlug,
    clock: systemClock,
  });
}

/**
 * The sign-in URL for *this* request, carrying the page the visitor was trying
 * to reach.
 *
 * The path comes from `REQUEST_PATH_HEADER`, which `src/middleware.ts` stamps
 * on every request — see `src/lib/return-path.ts` for why the request carries
 * it rather than each page passing its own, and for why the value is validated
 * even though the middleware is the only thing that should have written it.
 *
 * A missing header is not an error: it is what a unit test, or a route the
 * matcher does not cover, looks like. `signInPathFor(null)` is `/dang-nhap`,
 * and `signInAction` then sends a member of exactly one shelf to that shelf
 * (`landingShelfFor`), so the degraded path still lands most people where they
 * were going.
 */
async function signInPathForRequest(): Promise<string> {
  const hdrs = await headers();
  return signInPathFor(hdrs.get(REQUEST_PATH_HEADER));
}

/**
 * How a page reads from the database. One function, because forty-six of them
 * are going to do it and the sequence must not be reassembled by hand each
 * time.
 *
 * The sequence is: session cookie → `TenantContext` (`contextFor`) →
 * `runQuery`. Getting any step of it subtly wrong is not a broken page, it is
 * a page that renders somebody else's shelf, so the interesting property here
 * is that a caller cannot express a read that skipped a step. `read` receives
 * a `Tx` that is already inside a read-only transaction with
 * `olibra.bookshelf_id` set and `role olibra_app` assumed; there is no
 * parameter for saying "not this time".
 *
 * **Why `src/lib/` and not `src/domain/`.** This calls `cookies()`, and
 * `tests/architecture/boundaries.test.ts` forbids anything under `src/domain`
 * importing `next/*` (G1 / SDD §3.1 — the domain must stay movable to a
 * separate service). The dependency runs surface → domain and never the other
 * way, which is also why the `TenantContext` is built here and handed *to* the
 * domain rather than resolved inside it.
 *
 * **The pool, not a connection of its own.** `pool()` (`src/db/client.ts`) is
 * a single `postgres.js` pool for the process, never `end()`ed. A page render
 * that opened and closed one would pay a TCP handshake and a Postgres backend
 * fork for every request, on a long-lived Bun server that has no reason to.
 *
 * **Two refusals are translated, into three answers, and nothing else is
 * caught.**
 *
 * - `NotFound("shelf_not_found")` — `contextFor` throws it for a slug that
 *   resolves to no active shelf. A typo'd URL is a 404, which is what a 404
 *   is for. It is caught around `contextForRequest` alone, because it is
 *   thrown *before* there is a tenant: there is no context to ask a question
 *   of, and nothing below has run.
 * - `RuleViolated("not_permitted")` — thrown by `requireManager` /
 *   `requireReader` / `requireIdentifiedActor` inside the query, i.e. by the
 *   domain, which is the only place that decides *permission*. The page
 *   decides *visibility* — BR §13.3, "every screen hides what the user cannot
 *   do… the interface hiding an action is never the security control", which is
 *   why both halves exist. Mapping it here rather than in each page is what
 *   stops forty-six pages from growing forty-six private re-readings of
 *   `requireManager` — the check itself stays in the domain, where the command
 *   would enforce it again regardless of what the page decided to render.
 *
 * **That last refusal has two answers, and telling them apart is the whole of
 * U2 §3.1.**
 *
 * U1 shipped one answer, `notFound()`, and gave the reason at §3.4: a redirect
 * to a "you may not" screen confirms the page exists and which shelf has one.
 * That reasoning holds for a *manager* page, whose existence is not public. It
 * does not transfer to a shelf page, whose existence is: `bookshelves_public_
 * read` (`20260808_12_bookshelves_public_read.sql`) makes every active shelf
 * discoverable by name and address precisely so the portal can list it, and
 * the portal then links to it. A 404 from a link the portal just displayed is
 * a dead end, and the person hitting it is overwhelmingly a member who is not
 * signed in yet — on a shared parish phone that is the ordinary case, not the
 * adversarial one.
 *
 * - **No session at all** (`ctx.actor.userId === null`) → `redirect()` to
 *   `/dang-nhap`, carrying where they were going, so they land back on it.
 * - **A session, but no membership here** (`userId` set, and the domain still
 *   refused) → `notFound()`, unchanged. For them the shelf's contents genuinely
 *   are none of their business; BR:91 closed the anonymous-caller path
 *   deliberately.
 *
 * **The distinction is `userId`, and it cannot be `role`.** `contextFor`
 * (`src/auth/guards.ts`) returns a context whose role is `"guest"` in *both*
 * cases — read the branch at its `if (!membership?.id)`: a signed-in
 * non-member gets `{...guest, actor: {...guest.actor, userId: session.userId}}`.
 * "Guest" in that function means "holds no membership of this shelf", not "has
 * no session". Keying the redirect on `role === "guest"` therefore sends a
 * signed-in non-member to sign in, where they already are signed in, so
 * `signInAction` sends them back to the page that just refused them, which
 * redirects them to sign in: a loop with no exit and no error, on the one
 * journey — following a portal link to somebody else's parish — that produces
 * it. `tests/lib/page-data.test.ts` walks the full round trip rather than
 * asserting the branch, because the branch is what would be edited.
 *
 * What is not lost by answering differently: a guest is refused by *every*
 * page of a shelf, member and manager alike, so the redirect discloses nothing
 * about which pages exist — it is the same answer everywhere. A signed-in
 * reader on a manager URL still gets U1 §3.4's 404, unchanged, which is the
 * case that reasoning was actually about.
 *
 * Everything else propagates. A `PostgresError`, a `ValidationFailed`, a
 * `NotWired` are faults, and a fault rendered as a friendly Vietnamese
 * sentence tells a volunteer their input was wrong when the database was
 * down (U1 §3.3). `RuleViolated` is matched on its `code` and not on its
 * class for the same reason: a future query that refuses for a *business*
 * reason must not silently become a 404 because it happened to throw the same
 * class.
 *
 * This is deliberately not the place a *command's* `RuleViolated` is handled.
 * That one is caught by the server action, returned to the form as a code and
 * rendered through `messageFor` — a different path with a different answer,
 * and it belongs to U1 Task 4.
 */
export async function loadPage<T>(
  shelfSlug: string,
  read: (tx: Tx, ctx: TenantContext) => Promise<T>,
): Promise<T> {
  let ctx: TenantContext;
  try {
    ctx = await contextForRequest(shelfSlug);
  } catch (err) {
    if (err instanceof NotFound && err.code === "shelf_not_found") notFound();
    throw err;
  }

  try {
    return await runQuery(pool(), ctx, read);
  } catch (err) {
    if (err instanceof RuleViolated && err.code === "not_permitted") {
      if (ctx.actor.userId === null) redirect(await signInPathForRequest());
      notFound();
    }
    throw err;
  }
}

/**
 * How a page with **no shelf** reads from the database — `loadPage`'s
 * counterpart for the front door.
 *
 * There is one surface in this project that a person with no membership
 * anywhere may read, and it is the reason the front door works at all: the
 * portal directory (OPS §3.1's `GetPortalDirectory` and `SearchBookshelves`,
 * both **Global**, both `guest`). `loadPage` cannot serve it, and not because
 * of a missing parameter: its whole sequence is slug → `contextFor` →
 * `runQuery`, and a stranger looking for their parish has no slug to start
 * from. That is the state of affairs the portal exists for, not a gap in it.
 *
 * So this is a *shorter* seam, not a wider one. No cookie is read, because
 * nothing here depends on who is asking — a signed-in manager and a stranger
 * see the identical directory, so resolving a session would be collecting an
 * answer nothing is entitled to use. Nothing is caught: there is no
 * `shelf_not_found` to translate (no shelf was named) and no `not_permitted`
 * to translate (no permission was required), so every error reaching this
 * function is a fault and keeps the behaviour U1 §3.3 asks for by doing
 * nothing at all.
 *
 * `runPublicQuery` (`src/domain/kernel/unit-of-work.ts`) is what makes it safe
 * without a membership, and its docstring is where that argument lives: the
 * role is `olibra_app`, the tenant scope is explicitly empty, and the rows a
 * caller can reach are exactly the ones `bookshelves_public_read` hands to a
 * caller with no shelf. The `bypassrls` role is not involved.
 *
 * **A page calling this is still a page that reaches Postgres**, so
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` requires
 * it to be explicitly dynamic — it walks imports of this module, not of
 * `loadPage` specifically. That matters more here than it looks: a page with no
 * session to read is exactly the page Next.js is happiest to render once at
 * build time and serve to everyone, and the portal's rows would then be
 * whatever the shelves were on the day of the build.
 */
export async function loadPublicPage<T>(read: (tx: Tx) => Promise<T>): Promise<T> {
  return runPublicQuery(pool(), read);
}

/**
 * How a server action writes to the database — `loadPage`'s twin, and
 * deliberately not its mirror image.
 *
 * The sequence is the same, and shares `contextForRequest` so it cannot become
 * a second reading of who is asking: session cookie → `TenantContext` →
 * `runCommand`, which opens one transaction, sets `olibra.bookshelf_id` and
 * `olibra.now`, assumes `role olibra_app`, runs the command and writes its
 * audit entries in that same transaction (G3).
 *
 * **What it does not do is catch `RuleViolated`.** `loadPage` translates
 * `not_permitted` into a 404 because a *page* has to decide what a reader who
 * typed a manager URL sees. An action has a different caller with a different
 * need: BR §16.3 wants a blocking condition to surface "as a clear message
 * before the confirm step", and the message it surfaces as — "Bạn đọc đã mượn
 * tối đa số sách cho phép.", OPERATIONS.md:234 under `LendCopy`, and
 * `errors.ts:59` where the code and the sentence are paired — rendered
 * beside the confirm button, and a 404 would replace the one sentence that
 * tells a volunteer what to do next with a blank wall. So every `RuleViolated`
 * — `not_permitted` included — leaves this function intact and is caught by
 * the action, which turns it into a code the form renders through
 * `messageFor`. U1 §3.3, and `tests/lib/lending-actions.test.ts` pins it.
 *
 * **A `NotFound` is a 404**, and that includes but is no longer limited to
 * `shelf_not_found`. This shipped translating that one code and nothing else,
 * so a `copyId` belonging to another shelf — or any well-formed uuid naming
 * nothing — left `lendCopy`'s `NotFound("copy_not_found")` uncaught and gave a
 * volunteer a bare HTTP 500. OPERATIONS.md:33 names all three shapes and what
 * each one is for: a candidate stack "must be able to distinguish *not found*,
 * *validation failure*, and *business-rule violation* as different error
 * shapes, because the UI treats them differently (inline field error vs. a
 * named blocking message vs. **a 404 page**)." A bare 500 is the one outcome
 * that sentence exists to forbid. `shelf_not_found` keeps its own line in the
 * reasoning — it is thrown by `contextFor` before there is a tenant at all —
 * but it no longer needs its own branch.
 *
 * **Except `write_target_not_found`.** That code is not a URL naming nothing;
 * it is `unit-of-work.ts`'s own guard firing because an `update` a command
 * issued matched zero rows, which `errors.ts` groups with
 * `audit_forbidden_field` and `invalid_bookshelf_id` as an internal fault no
 * volunteer can act on. Rendering it as a 404 would hide a bug inside a
 * command behind a page that looks like a mistyped address. Matched on the
 * code rather than by excluding a class, for the reason `loadPage` matches
 * `RuleViolated` on its code: the class is not the question.
 *
 * Everything else propagates untouched — a `PostgresError`, a
 * `ValidationFailed`, a `NotWired`. U1 §3.3 is blunt about why: a fault
 * rendered as a friendly Vietnamese sentence tells a volunteer their input was
 * wrong when the database was down.
 */
export async function submitCommand<I, O>(
  shelfSlug: string,
  command: Command<I, O>,
  input: I,
): Promise<O> {
  try {
    const ctx = await contextForRequest(shelfSlug);
    return await runCommand(pool(), ctx, command, input);
  } catch (err) {
    if (err instanceof NotFound && err.code !== "write_target_not_found") {
      notFound();
    }
    throw err;
  }
}
