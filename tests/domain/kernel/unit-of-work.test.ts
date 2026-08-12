import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { RuleViolated } from "../../../src/domain/kernel/errors";
import { runCommand } from "../../../src/domain/kernel/unit-of-work";
import type { TenantContext } from "../../../src/domain/kernel/tenant";
import { migrate } from "../../../src/db/migrate";
import { makeShelf } from "../../support/factories";
import { closeAll, resetDatabase, sql } from "../../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-07T10:00:00Z");

async function contextFor(): Promise<TenantContext> {
  const shelf = await makeShelf(sql);
  return {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "manager" },
    clock,
  };
}

test("a successful command writes its audit record in the same transaction", async () => {
  const ctx = await contextFor();

  const bookId = await runCommand(
    sql,
    ctx,
    async (tx, c, input: { title: string }) => {
      const [book] = await tx<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${c.bookshelfId}, ${input.title}, 'Tô Hoài', 'x', true)
      returning id
    `;
      return {
        result: book.id,
        audit: {
          action: "book.created",
          entityType: "book",
          entityId: book.id,
          after: { title: input.title },
        },
      };
    },
    { title: "Dế Mèn Phiêu Lưu Ký" },
  );

  const entries = await sql<{ action: string; entity_id: string }[]>`
    select action, entity_id from audit_log
  `;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ action: "book.created", entity_id: bookId });
});

test("a failed command leaves neither the change nor the audit record", async () => {
  // G3. This is the property the whole kernel exists for: an audit record and
  // its subject can never diverge, because they are the same transaction.
  const ctx = await contextFor();

  await expect(
    runCommand(
      sql,
      ctx,
      async (tx, c) => {
        await tx`
        insert into books (bookshelf_id, title, author, slug, is_published)
        values (${c.bookshelfId}, 'Sách hỏng', 'Tô Hoài', 'y', true)
      `;
        throw new RuleViolated("validation_failed");
      },
      {},
    ),
  ).rejects.toBeInstanceOf(RuleViolated);

  expect(await sql`select 1 from books`).toHaveLength(0);
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

test("the RLS session variable is set for the whole transaction", async () => {
  // G4. Without this the command's own writes would be rejected by the
  // policy, which is the good failure — but the point is that no command has
  // to remember to set it.
  const ctx = await contextFor();

  const seen = await runCommand(
    sql,
    ctx,
    async (tx) => {
      const [row] = await tx<{ v: string }[]>`
      select current_setting('olibra.bookshelf_id', true) as v
    `;
      return {
        result: row.v,
        audit: {
          action: "book.created",
          entityType: "x",
          entityId: ctx.bookshelfId,
        },
      };
    },
    {},
  );

  expect(seen).toBe(ctx.bookshelfId);
});

test("a command may write several audit entries", async () => {
  // OPS §5: ReceiveReturn with holdForRequestId is two facts, one action, one
  // transaction. The kernel must not force it to pretend to be one.
  const ctx = await contextFor();

  await runCommand(
    sql,
    ctx,
    async (tx, c) => {
      const [book] = await tx<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${c.bookshelfId}, 'Sách', 'Tô Hoài', 'z', true)
      returning id
    `;
      return {
        result: null,
        audit: [
          { action: "book.created", entityType: "book", entityId: book.id },
          { action: "copy.added", entityType: "book", entityId: book.id },
        ],
      };
    },
    {},
  );

  expect(await sql`select 1 from audit_log`).toHaveLength(2);
});

test("the actor and the shelf are recorded on every entry", async () => {
  const shelf = await makeShelf(sql);
  const [user] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone)
    values ('Maria', 'Maria Lan', 'A', 'B', '0900000001') returning id
  `;
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: user.id, membershipId: null, role: "manager" },
    clock,
  };

  await runCommand(
    sql,
    ctx,
    async () => ({
      result: null,
      audit: { action: "book.deleted", entityType: "x", entityId: shelf.id },
    }),
    {},
  );

  const [entry] = await sql<{ actor_id: string; bookshelf_id: string }[]>`
    select actor_id, bookshelf_id from audit_log
  `;
  expect(entry.actor_id).toBe(user.id);
  expect(entry.bookshelf_id).toBe(shelf.id);
});
