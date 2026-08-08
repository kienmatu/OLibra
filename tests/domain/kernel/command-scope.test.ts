import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import {
  runCommand,
  runGlobalCommand,
} from "../../../src/domain/kernel/unit-of-work";
import { migrate } from "../../../src/db/migrate";
import { makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-08T10:00:00Z");

test("an ordinary command cannot write a row belonging to another shelf", async () => {
  // The write-side counterpart of query-scope.test.ts's "no where clause"
  // case: here the mistake is a command whose insert names the wrong shelf
  // outright, whether by a copy-pasted id or a mixed-up ctx. RLS's `with
  // check` is what has to catch that, not code review.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const ctx = {
    bookshelfId: a.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await expect(
    runCommand(
      sql,
      ctx,
      async (tx) => {
        await tx`
          insert into books (bookshelf_id, title, author, slug, is_published)
          values (${b.id}, 'x', 'y', 'z', true)
        `;
        return {
          result: null,
          audit: { action: "book.created", entityType: "book", entityId: b.id },
        };
      },
      {},
    ),
  ).rejects.toThrow();

  expect(await sql`select 1 from books`).toHaveLength(0);
});

test("the global path can write a null-shelf audit entry, and the ordinary path cannot", async () => {
  // BR §13.2: cross-shelf audit visibility is a super_admin permission, and
  // audit_log's policy makes a null bookshelf_id unreachable to olibra_app in
  // either direction. A system-wide fact — no owning shelf — can only be
  // written through the explicit escalation, runGlobalCommand.
  const a = await makeShelf(sql);
  const ctx = {
    bookshelfId: a.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await runGlobalCommand(
    sql,
    ctx,
    async () => ({
      result: null,
      audit: {
        action: "system.migration",
        entityType: "system",
        entityId: a.id,
        global: true,
      },
    }),
    {},
  );

  const [globalEntry] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'system.migration'
  `;
  expect(globalEntry.bookshelf_id).toBeNull();

  await expect(
    runCommand(
      sql,
      ctx,
      async () => ({
        result: null,
        audit: {
          action: "system.migration",
          entityType: "system",
          entityId: a.id,
          global: true,
        },
      }),
      {},
    ),
  ).rejects.toThrow();
});
