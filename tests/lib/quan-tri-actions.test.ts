import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { hashPassword } from "../../src/auth/password";
import { signIn } from "../../src/auth/session";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { proposeProfileChange } from "../../src/domain/members/commands/propose-profile-change";
import { migrate } from "../../src/db/migrate";
import { SESSION_COOKIE } from "../../src/lib/session-cookie";
import { makeMember, makeShelf } from "../support/factories";
import { closeAll, resetDatabase, sql } from "../support/db";
import { testDatabaseUrl } from "../support/env";

/**
 * Fix round 1: `approveManagerProfileChangeAction`/`rejectManagerProfileChangeAction`
 * (`src/app/quan-tri/actions.ts`) used to read the shelf a decision is filed
 * against straight off a posted `tu-sach` field and pass it through as
 * `ctx.bookshelfId` — unchecked, because `runAdminCommand` runs as
 * `olibra_admin` with `bypassrls` on this path, so RLS (which would refuse a
 * mismatch on every *other* shelf-scoped write in this codebase) never runs
 * here at all. `getProfileChangeRequestShelf`
 * (`src/domain/admin/queries/get-pending-manager-changes.ts`) closes it by
 * resolving the shelf from the request row itself, the same way
 * `getFeedbackDetail` already does for the feedback pair of actions in the
 * same file. This file proves the fix the only way that actually exercises
 * `actions.ts`'s own code, not just the query or the command underneath it:
 * by calling the real server action with a deliberately mismatched `tu-sach`
 * and reading where the audit row actually landed.
 *
 * Modelled directly on `tests/lib/admin-actions.test.ts`, which covers the
 * same file's sibling, `admin-actions.ts` — the `next/headers` mock, the
 * `redirectedTo` digest-reading helper (a test that mocked `redirect` itself
 * would pass against an action that built the wrong target and never
 * actually redirected there), and `signInAsSuperAdmin` are all restated
 * rather than imported, because that file exports none of them either.
 */

const session = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === SESSION_COOKIE && session.token
        ? { name, value: session.token }
        : undefined,
  }),
}));

const { approveManagerProfileChangeAction, rejectManagerProfileChangeAction } =
  await import("../../src/app/quan-tri/actions");
const { pool } = await import("../../src/db/client");

const clock = fixedClock("2026-08-13T03:00:00Z");

let previousUrl: string | undefined;

beforeAll(async () => {
  previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  await migrate(sql);
});

beforeEach(async () => {
  session.token = null;
  await resetDatabase();
});

afterAll(async () => {
  await pool().end();
  delete (globalThis as { [k: symbol]: unknown })[Symbol.for("olibra.db.pool")];
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  await closeAll();
});

async function signInAsSuperAdmin() {
  const username = `admin-${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await sql<{ id: string }[]>`
    insert into users (
      saint_name, full_name, father_name, mother_name, username, password_hash,
      is_super_admin
    )
    values ('', 'Quản trị viên', '', '', ${username}, ${await hashPassword("x")}, true)
    returning id
  `;
  const { token } = await signIn(sql, { username, password: "x", clock });
  session.token = token;
  return { userId: user.id };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

async function redirectedTo(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return digest.split(";")[2];
    }
    throw err;
  }
  throw new Error("the action returned without redirecting");
}

function refusalIn(target: string): string | null {
  return new URLSearchParams(target.split("?")[1] ?? "").get("loi");
}

/** A shelf with one manager, and that manager's own pending profile change. */
async function aShelfWithAPendingManagerChange(slug: string) {
  const shelf = await makeShelf(sql, { slug });
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };
  const { profileChangeRequestId } = await runCommand(
    sql,
    ctx,
    proposeProfileChange,
    {
      membershipId: manager.id,
      fields: { phone: "0912345678" },
    },
  );
  return { shelf, manager, profileChangeRequestId };
}

test("approving files the audit row against the request's own shelf, even when a mismatched shelf id is posted", async () => {
  await signInAsSuperAdmin();
  const a = await aShelfWithAPendingManagerChange("dong-thap-approve");
  const b = await makeShelf(sql, { slug: "an-giang-approve" });

  const target = await redirectedTo(
    approveManagerProfileChangeAction(
      form({ "yeu-cau": a.profileChangeRequestId, "tu-sach": b.id }),
    ),
  );

  // Succeeds — the actor is a super admin, and `subject_role`/`membershipId`
  // no longer depend on `ctx.bookshelfId` at all (`subjectOfProfileChange`'s
  // own fix), so a mismatched `tu-sach` cannot make this decision fail either.
  expect(refusalIn(target)).toBeNull();

  const rows = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'profile_change.approved'
  `;
  expect(rows).toHaveLength(1);
  // The point of the fix: filed against shelf A — the request's own shelf —
  // never against shelf B, the value the form posted.
  expect(rows[0].bookshelf_id).toBe(a.shelf.id);
});

test("rejecting files the audit row against the request's own shelf, even when a mismatched shelf id is posted", async () => {
  await signInAsSuperAdmin();
  const a = await aShelfWithAPendingManagerChange("dong-thap-reject");
  const b = await makeShelf(sql, { slug: "an-giang-reject" });

  const target = await redirectedTo(
    rejectManagerProfileChangeAction(
      form({
        "yeu-cau": a.profileChangeRequestId,
        "tu-sach": b.id,
        "ly-do": "Số điện thoại không hợp lệ",
      }),
    ),
  );

  expect(refusalIn(target)).toBeNull();

  const rows = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'profile_change.rejected'
  `;
  expect(rows).toHaveLength(1);
  expect(rows[0].bookshelf_id).toBe(a.shelf.id);
});

test("approving an id naming no request at all is refused, not silently filed under the posted shelf", async () => {
  await signInAsSuperAdmin();
  const b = await makeShelf(sql, { slug: "an-giang-missing" });

  const target = await redirectedTo(
    approveManagerProfileChangeAction(
      form({ "yeu-cau": crypto.randomUUID(), "tu-sach": b.id }),
    ),
  );

  expect(refusalIn(target)).toBe("validation_failed");
  expect(
    await sql`select id from audit_log where action = 'profile_change.approved'`,
  ).toHaveLength(0);
});
