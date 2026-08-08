import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { fixedClock } from "../../../src/domain/kernel/clock";
import { NotFound, ValidationFailed } from "../../../src/domain/kernel/errors";
import {
  assertWritten,
  runCommand,
  runGlobalCommand,
  runQuery,
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

// IMPORTANT 1 (fix-report, 2026-08-07-s2-domain-kernel): RLS's `using` clause
// *filters* rows on UPDATE — it does not raise the way `with check` does on
// INSERT. A cross-shelf update that targets a row belonging to another shelf
// is not rejected; it silently affects zero rows, while the command still
// resolves and still commits an audit entry claiming the change happened.
test("assertWritten rejects a write that touched no rows", () => {
  expect(() => assertWritten({ count: 0 }, "book_not_found")).toThrow(NotFound);
  try {
    assertWritten({ count: 0 }, "book_not_found");
  } catch (e) {
    expect((e as NotFound).code).toBe("book_not_found");
  }
});

test("assertWritten accepts a write that touched exactly the expected rows", () => {
  expect(() => assertWritten({ count: 1 }, "book_not_found")).not.toThrow();
  expect(() => assertWritten({ count: 2 }, "book_not_found", 2)).not.toThrow();
});

test("a legitimate same-shelf update guarded by assertWritten still succeeds", async () => {
  const shelf = await makeShelf(sql);
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${shelf.id}, 'Original', 'Tô Hoài', 'same-shelf', true)
    returning id
  `;
  const ctx = {
    bookshelfId: shelf.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await runCommand(
    sql,
    ctx,
    async (tx) => {
      const result =
        await tx`update books set title = 'Updated' where id = ${book.id}`;
      assertWritten(result, "book_not_found");
      return {
        result: null,
        audit: {
          action: "book.updated",
          entityType: "book",
          entityId: book.id,
          after: { title: "Updated" },
        },
      };
    },
    {},
  );

  const [row] = await sql<
    { title: string }[]
  >`select title from books where id = ${book.id}`;
  expect(row.title).toBe("Updated");
  expect(await sql`select 1 from audit_log`).toHaveLength(1);
});

test("a cross-shelf update guarded by assertWritten no longer reports success", async () => {
  // The live reproduction: shelf A's session updates a row that actually
  // belongs to shelf B. Without the guard this resolved with `count: 0` and
  // still committed an audit record saying the title changed. With the
  // guard, the command rejects and nothing commits.
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const [bookB] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${b.id}, 'Original', 'Tô Hoài', 'cross-shelf', true)
    returning id
  `;
  const ctxA = {
    bookshelfId: a.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await expect(
    runCommand(
      sql,
      ctxA,
      async (tx) => {
        const result =
          await tx`update books set title = 'HACKED' where id = ${bookB.id}`;
        assertWritten(result, "book_not_found");
        return {
          result: null,
          audit: {
            action: "book.updated",
            entityType: "book",
            entityId: bookB.id,
            after: { title: "HACKED" },
          },
        };
      },
      {},
    ),
  ).rejects.toBeInstanceOf(NotFound);

  const [row] = await sql<
    { title: string }[]
  >`select title from books where id = ${bookB.id}`;
  expect(row.title).toBe("Original");
  expect(await sql`select 1 from audit_log`).toHaveLength(0);
});

// IMPORTANT 3 (fix-report, 2026-08-07-s2-domain-kernel): runGlobalCommand
// exists so a null-bookshelf_id audit entry can be written at all. It must
// not also let the command *body* write across shelves — the docstring's
// claim that this escalation is scoped to the audit insert must be true.
test("a runGlobalCommand body still cannot write to another shelf", async () => {
  const a = await makeShelf(sql);
  const b = await makeShelf(sql);
  const ctxA = {
    bookshelfId: a.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await expect(
    runGlobalCommand(
      sql,
      ctxA,
      async (tx) => {
        await tx`
          insert into books (bookshelf_id, title, author, slug, is_published)
          values (${b.id}, 'x', 'y', 'cross-shelf-global', true)
        `;
        return {
          result: null,
          audit: {
            action: "system.migration",
            entityType: "system",
            entityId: b.id,
            global: true,
          },
        };
      },
      {},
    ),
  ).rejects.toThrow();

  expect(
    await sql`select 1 from books where slug = 'cross-shelf-global'`,
  ).toHaveLength(0);
});

test("a runGlobalCommand's null-shelf audit entry still commits", async () => {
  const a = await makeShelf(sql);
  const ctxA = {
    bookshelfId: a.id,
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await runGlobalCommand(
    sql,
    ctxA,
    async () => ({
      result: null,
      audit: {
        action: "system.still-works",
        entityType: "system",
        entityId: a.id,
        global: true,
      },
    }),
    {},
  );

  const [entry] = await sql<{ bookshelf_id: string | null }[]>`
    select bookshelf_id from audit_log where action = 'system.still-works'
  `;
  expect(entry.bookshelf_id).toBeNull();
});

// MINOR 7 (fix-report, 2026-08-07-s2-domain-kernel): a malformed bookshelfId
// used to surface as a raw PostgresError from inside the transaction (the
// uuid cast in the RLS policy fails first). An empty string is the sentinel
// `nullif(..., '')` is built to handle and must keep failing closed to zero
// rows, not become an error.
test("a malformed bookshelfId is a named ValidationFailed, not a raw driver error", async () => {
  const ctx = {
    bookshelfId: "not-a-uuid",
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await expect(
    runCommand(
      sql,
      ctx,
      async () => ({
        result: null,
        audit: { action: "x.y", entityType: "x", entityId: "x" },
      }),
      {},
    ),
  ).rejects.toBeInstanceOf(ValidationFailed);

  await expect(
    runQuery(sql, ctx, (tx) => tx`select 1 from books`),
  ).rejects.toBeInstanceOf(ValidationFailed);
});

test("an empty-string bookshelfId still fails closed to zero rows, not an error", async () => {
  const ctx = {
    bookshelfId: "",
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  const rows = await runQuery(sql, ctx, (tx) => tx`select 1 from books`);
  expect(rows).toHaveLength(0);
});

// Minor 3 (review, branch feat/sql-clock): the clock got none of the
// pre-transaction validation the tenant id above gets, even though both
// settings on a scoped transaction come from `ctx` and both are set on
// adjacent lines. `ctx.clock.now().toISOString()` was evaluated *inside*
// `sql.begin`, so a broken clock produced exactly what
// `assertValidBookshelfId` exists to prevent. Measured before the fix, all
// three through `runQuery`:
//
//   new Date("nonsense")  -> RangeError: Invalid time value, from inside the
//   new Date(Infinity)       transaction. No `code`, not a DomainError.
//   new Date(8.64e15)     -> PostgresError 22009, "time zone displacement out
//                            of range: +275760-09-13T00:00:00.000Z" — raised
//                            when a view calls olibra_now() and the cast
//                            fails, i.e. a raw driver error at the kernel
//                            boundary.
//
// Unreachable in production: `systemClock.now()` is `new Date()`. This is a
// test-authoring footgun — `fixedClock("2026-13-45")` is a plausible typo —
// and a symmetry gap, and it is fixed as one.
describe("a Clock that cannot produce a sendable instant is a named ValidationFailed", () => {
  const broken: Record<string, Date> = {
    // `new Date` of an unparseable string, and of a non-finite number: both
    // are the Invalid Date, whose `toISOString()` throws.
    'fixedClock("2026-13-45")-style Invalid Date': new Date("2026-13-45"),
    "new Date(Infinity)": new Date(Infinity),
    // Valid, and the largest `Date` there is. `toISOString()` succeeds here —
    // it yields "+275760-09-13T00:00:00.000Z" — so a finiteness check alone
    // would let this through to Postgres and the 22009 above.
    "new Date(8.64e15), the maximum valid Date": new Date(8.64e15),
  };

  for (const [name, instant] of Object.entries(broken)) {
    test(name, async () => {
      const ctx = {
        bookshelfId: "",
        actor: { userId: null, membershipId: null, role: "manager" as const },
        clock: { now: () => instant, today: () => "2026-08-08" },
      };

      // The query body reads a view that calls olibra_now(), so this is the
      // path that produced the 22009 rather than one that only sets the GUC
      // and never reads it back.
      await expect(
        runQuery(sql, ctx, (tx) => tx`select count(*) from loans_current`),
      ).rejects.toBeInstanceOf(ValidationFailed);

      await expect(
        runCommand(
          sql,
          { ...ctx, bookshelfId: (await makeShelf(sql)).id },
          async () => ({
            result: null,
            audit: { action: "x.y", entityType: "x", entityId: "x" },
          }),
          {},
        ),
      ).rejects.toBeInstanceOf(ValidationFailed);
    });
  }

  test("the error names the clock, not the shelf", async () => {
    // Both settings share one `ErrorCode` (`validation_failed`; this branch
    // adds none), so `field` is the only thing that says which of the two was
    // wrong. Asserting it is what keeps a future refactor from routing a bad
    // clock through the bookshelf-id branch and leaving this suite green.
    const error = await runQuery(
      sql,
      {
        bookshelfId: "",
        actor: { userId: null, membershipId: null, role: "manager" as const },
        clock: { now: () => new Date(Infinity), today: () => "2026-08-08" },
      },
      (tx) => tx`select 1`,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationFailed);
    expect((error as ValidationFailed).field).toBe("clock");
  });

  test("a valid clock at the far end of the range is not caught by this", async () => {
    // The guard must reject what Postgres cannot take, not everything
    // unusual. Year 9999 is the largest four-digit year and round-trips
    // fine — without this, tightening the check into a narrow "plausible
    // dates only" range would go unnoticed.
    const row = await runQuery(
      sql,
      {
        bookshelfId: "",
        actor: { userId: null, membershipId: null, role: "manager" as const },
        clock: {
          now: () => new Date("9999-12-31T23:59:59Z"),
          today: () => "9999-12-31",
        },
      },
      async (tx) =>
        (await tx<{ injected: string }[]>`select olibra_now() as injected`)[0],
    );
    expect(new Date(row.injected).toISOString()).toBe("9999-12-31T23:59:59.000Z");
  });
});

// Item 2 (re-review follow-up): unlike runQuery, the write path has no
// nullif(...) between ctx.bookshelfId and the audit insert's uuid column —
// an empty string used to reach that column raw and surface as
// `PostgresError: invalid input syntax for type uuid: ""`. Confirmed live
// before this test existed; see the final-fix-report for the reproduction.
test("an empty-string bookshelfId on the command path is also a named ValidationFailed, not a raw driver error", async () => {
  const ctx = {
    bookshelfId: "",
    actor: { userId: null, membershipId: null, role: "manager" as const },
    clock,
  };

  await expect(
    runCommand(
      sql,
      ctx,
      async () => ({
        result: null,
        audit: { action: "x.y", entityType: "x", entityId: "x" },
      }),
      {},
    ),
  ).rejects.toBeInstanceOf(ValidationFailed);
});

// Item 1 (re-review follow-up): assertWritten was opt-in, so a command that
// forgot to call it got a cross-shelf update's `count: 0`, resolved
// successfully, and committed an audit record describing a change that
// never happened. `runAs` now hands every Command a guarded `tx` (see
// `guardWrites`/`guardPendingQuery` in unit-of-work.ts) so an UPDATE/DELETE
// affecting zero rows rejects by construction — with no assertWritten call
// anywhere in the command below. The four tests here are the guard's four
// behaviours: a same-shelf write still succeeds, a cross-shelf write is
// auto-rejected, a genuinely-conditional write can opt out with
// `.allowZero()`, and reads are untouched.
describe("the guarded Tx a Command receives (fail-safe zero-row writes)", () => {
  test("a same-shelf update through the guarded tx succeeds with no assertWritten call", async () => {
    const shelf = await makeShelf(sql);
    const [book] = await sql<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${shelf.id}, 'Original', 'Tô Hoài', 'guard-same-shelf', true)
      returning id
    `;
    const ctx = {
      bookshelfId: shelf.id,
      actor: { userId: null, membershipId: null, role: "manager" as const },
      clock,
    };

    await runCommand(
      sql,
      ctx,
      async (tx) => {
        // No assertWritten call — the guard alone must carry this.
        const result =
          await tx`update books set title = 'Updated' where id = ${book.id}`;
        expect(result.command).toBe("UPDATE");
        expect(result.count).toBe(1);
        return {
          result: null,
          audit: {
            action: "book.updated",
            entityType: "book",
            entityId: book.id,
            after: { title: "Updated" },
          },
        };
      },
      {},
    );

    const [row] = await sql<
      { title: string }[]
    >`select title from books where id = ${book.id}`;
    expect(row.title).toBe("Updated");
  });

  test("a cross-shelf update through the guarded tx is auto-rejected with no assertWritten call", async () => {
    const a = await makeShelf(sql);
    const b = await makeShelf(sql);
    const [bookB] = await sql<{ id: string }[]>`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${b.id}, 'Original', 'Tô Hoài', 'guard-cross-shelf', true)
      returning id
    `;
    const ctxA = {
      bookshelfId: a.id,
      actor: { userId: null, membershipId: null, role: "manager" as const },
      clock,
    };

    await expect(
      runCommand(
        sql,
        ctxA,
        async (tx) => {
          // Deliberately does not call assertWritten — the forgetful command
          // the original bug rewarded. The guard must catch it anyway.
          await tx`update books set title = 'HACKED' where id = ${bookB.id}`;
          return {
            result: null,
            audit: {
              action: "book.updated",
              entityType: "book",
              entityId: bookB.id,
              after: { title: "HACKED" },
            },
          };
        },
        {},
      ),
    ).rejects.toBeInstanceOf(NotFound);

    const [row] = await sql<
      { title: string }[]
    >`select title from books where id = ${bookB.id}`;
    expect(row.title).toBe("Original");
    expect(await sql`select 1 from audit_log`).toHaveLength(0);
  });

  test("allowZero() opts a genuinely conditional update out of the guard", async () => {
    const shelf = await makeShelf(sql);
    const ctx = {
      bookshelfId: shelf.id,
      actor: { userId: null, membershipId: null, role: "manager" as const },
      clock,
    };

    await runCommand(
      sql,
      ctx,
      async (tx) => {
        const result = await tx`
          update books set title = 'Updated'
          where slug = 'does-not-exist-in-this-shelf'
        `.allowZero();
        expect(result.command).toBe("UPDATE");
        expect(result.count).toBe(0);
        return {
          result: null,
          audit: { action: "book.updated", entityType: "book", entityId: shelf.id },
        };
      },
      {},
    );

    expect(await sql`select 1 from audit_log`).toHaveLength(1);
  });

  test("reads through the guarded tx are unaffected", async () => {
    const shelf = await makeShelf(sql);
    await sql`
      insert into books (bookshelf_id, title, author, slug, is_published)
      values (${shelf.id}, 'Sách', 'Tô Hoài', 'guard-select', true)
    `;
    const ctx = {
      bookshelfId: shelf.id,
      actor: { userId: null, membershipId: null, role: "manager" as const },
      clock,
    };

    await runCommand(
      sql,
      ctx,
      async (tx) => {
        const rows = await tx`select 1 from books`;
        expect(rows.command).toBe("SELECT");
        expect(rows).toHaveLength(1);
        return {
          result: null,
          audit: { action: "probe.done", entityType: "x", entityId: shelf.id },
        };
      },
      {},
    );
  });
});
