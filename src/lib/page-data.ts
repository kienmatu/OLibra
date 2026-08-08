import { cookies } from "next/headers";
import { notFound } from "next/navigation";
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
  runQuery,
  type Tx,
} from "../domain/kernel/unit-of-work";
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
 * **Two refusals become `notFound()`, and nothing else is caught.**
 *
 * - `NotFound("shelf_not_found")` — `contextFor` throws it for a slug that
 *   resolves to no active shelf. A typo'd URL is a 404, which is what a 404
 *   is for.
 * - `RuleViolated("not_permitted")` — thrown by `requireManager` /
 *   `requireReader` / `requireIdentifiedActor` inside the query, i.e. by the
 *   domain, which is the only place that decides *permission*. The page
 *   decides *visibility*, and the answer BR §13.3 and U1 §3.4 want is a 404:
 *   a redirect to a "you may not" screen confirms the page exists and which
 *   shelf has one. Mapping it here rather than in each page is what stops
 *   forty-six pages from growing forty-six private re-readings of
 *   `requireManager` — the check itself stays in the domain, where the command
 *   would enforce it again regardless of what the page decided to render.
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
  try {
    const ctx = await contextForRequest(shelfSlug);
    return await runQuery(pool(), ctx, read);
  } catch (err) {
    if (err instanceof NotFound && err.code === "shelf_not_found") notFound();
    if (err instanceof RuleViolated && err.code === "not_permitted") notFound();
    throw err;
  }
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
 * need: BR §16.3 wants "Bạn đọc đã mượn tối đa số sách cho phép." rendered
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
