import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { systemContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { lendCopy } from "../../src/domain/circulation/commands/lend-copy";
import { receiveReturn } from "../../src/domain/circulation/commands/receive-return";
import { voidLoan } from "../../src/domain/circulation/commands/void-loan";
import { messageFor } from "../../src/domain/kernel/errors";
import { migrate } from "../../src/db/migrate";
import { makeBookWithCopies, makeMember, makeShelf } from "../support/factories";
import { lentOut } from "../support/scenarios";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

test("INV-11: a loan cannot be deleted, only voided", async () => {
  // BR §6 / DATABASE.md §7: mistakes are recorded as *voided* with a reason
  // (loans_voided_has_reason, 0005_circulation.sql), never erased. There is
  // no deleted_at column on loans (schema.test.ts covers that half); this
  // test covers the other half — that a plain SQL DELETE is refused outright,
  // not merely unmodeled by the application.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
    returning id
  `;

  await expect(sql`delete from loans where id = ${loan.id}`).rejects.toThrow();

  const stillThere = await sql`select 1 from loans where id = ${loan.id}`;
  expect(stillThere).toHaveLength(1);
});

test("INV-11: voiding a loan (an update) is unaffected", async () => {
  // The rule forbids deletion, not correction. A manager who lent to the
  // wrong person must still be able to void the mistake in place.
  const shelf = await makeShelf(sql);
  const { bookId, copyIds } = await makeBookWithCopies(sql, shelf.id, 1);
  const reader = await makeMember(sql, shelf.id);

  const [loan] = await sql<{ id: string }[]>`
    insert into loans (bookshelf_id, copy_id, book_id, borrower_id, lent_by, due_on, status)
    values (${shelf.id}, ${copyIds[0]}, ${bookId}, ${reader.userId}, ${reader.userId}, current_date + 14, 'active')
    returning id
  `;

  await expect(sql`
    update loans set status = 'voided', voided_at = now(), void_reason = 'wrong borrower'
    where id = ${loan.id}
  `).resolves.toBeDefined();
});

// C1's Task 5. The two tests above prove the *mechanism* — a `delete` is
// refused outright, and an `update` to `voided` is not — at raw-SQL level.
// What follows is the command that is meant to be the only way anybody reaches
// that state, and it is a different claim: a `VoidLoan` that quietly deleted
// and re-inserted, or that set a flag beside the status instead of changing it,
// would leave both of those green.

test("INV-11: voiding a loan keeps the row and frees the copy", async () => {
  // BR §3: "A manager records a loan by mistake and needs to undo it."
  // BR §11 / INV-11: never a delete. The row survives with status 'voided', a
  // reason, and who voided it — because the audit history the brief requires is
  // the whole point of not deleting it.
  const { ctx, copyId, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm bạn đọc" });

  const [loan] = await sql<
    { status: string; void_reason: string; voided_by: string; voided_at: Date }[]
  >`select status, void_reason, voided_by, voided_at from loans where id = ${loanId}`;
  expect(loan.status).toBe("voided");
  expect(loan.void_reason).toBe("Ghi nhầm bạn đọc");
  expect(loan.voided_by).toBe(ctx.actor.userId); // users(id), not memberships(id)
  expect(loan.voided_at.toISOString()).toBe(ctx.clock.now().toISOString());

  const [copy] = await sql<{ state: string }[]>`
    select state from book_copies where id = ${copyId}
  `;
  expect(copy.state).toBe("available");
});

test("a reason is required", async () => {
  const { ctx, loanId } = await lentOut(sql);
  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "" }),
  ).rejects.toMatchObject({ code: "reason_required" });

  // Whitespace is not a reason. `loans_voided_has_reason` only catches null, so
  // three spaces would satisfy the constraint and tell a manager reading the
  // history in six months exactly nothing.
  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "   " }),
  ).rejects.toMatchObject({ code: "reason_required" });

  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
});

test("only an active loan can be voided", async () => {
  // `loan_not_active_cannot_void`, not `loan_not_active`. OPS §4.2 gives the
  // two commands different sentences for what looks like one code; this is the
  // assertion that keeps them apart.
  const { ctx, loanId } = await lentOut(sql);
  await runCommand(sql, ctx, receiveReturn, { loanId, condition: "perfect" });

  await expect(
    runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm" }),
  ).rejects.toMatchObject({ code: "loan_not_active_cannot_void" });

  // The two codes exist because they say different things, so the test says so
  // too rather than only naming one of them. A "split" that gave both codes the
  // same sentence would satisfy every other assertion in this file.
  expect(messageFor("loan_not_active_cannot_void")).toBe(
    "Chỉ có thể huỷ lượt mượn đang diễn ra.",
  );
  expect(messageFor("loan_not_active")).toBe("Lượt mượn này đã được xử lý.");
  expect(messageFor("loan_not_active_cannot_void")).not.toBe(
    messageFor("loan_not_active"),
  );
});

test("a voided loan frees the copy for INV-1", async () => {
  // The partial index keys on `status = 'active'`, so voiding must actually
  // change the status rather than setting a flag beside it. If it set a flag,
  // this lend fails with a unique violation and the copy is stuck forever.
  const { ctx, copyId, loanId } = await lentOut(sql);
  const other = await makeMember(sql, ctx.bookshelfId);

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm" });

  await expect(
    runCommand(sql, ctx, lendCopy, { copyId, membershipId: other.id }),
  ).resolves.toMatchObject({ loanId: expect.any(String) });

  // Two rows, one active. The mistake is still on the record beside its
  // correction, which is the difference between voiding and deleting.
  const rows = await sql<{ status: string }[]>`
    select status from loans where copy_id = ${copyId} order by status
  `;
  expect(rows.map((r) => r.status)).toEqual(["active", "voided"]);
});

test("voiding writes an audit record naming the reason", async () => {
  // INV-8. The reason is the whole value of voiding rather than deleting: six
  // months later, "why is there no loan here" has an answer. It is recorded in
  // the audit as well as on the row because `audit_log` is append-only
  // (INV-12) and `loans.void_reason` is an ordinary column.
  const { ctx, loanId } = await lentOut(sql);

  await runCommand(sql, ctx, voidLoan, { loanId, reason: "Ghi nhầm bạn đọc" });

  const [entry] = await sql<
    {
      action: string;
      entity_id: string;
      actor_id: string;
      before: { status: string };
      after: { reason: string; status: string };
    }[]
  >`select action, entity_id, actor_id, before, after
      from audit_log where action = 'loan.voided'`;
  expect(entry.action).toBe("loan.voided");
  expect(entry.entity_id).toBe(loanId);
  expect(entry.actor_id).toBe(ctx.actor.userId);
  expect(entry.before.status).toBe("active");
  expect(entry.after.status).toBe("voided");
  expect(entry.after.reason).toBe("Ghi nhầm bạn đọc");
});

test("INV-8: a void with nobody's name on it is refused, whatever the role", async () => {
  // The point of voiding rather than deleting (BR §11) is that "why is there
  // no loan here" has an answer six months later. `voided_by` is *nullable*
  // (0005_circulation.sql:41) and `audit_log.actor_id` is too, so nothing in
  // the schema stops a void with no actor — and `requireManager` cannot,
  // because `systemContext` is `role: "super_admin"` with `userId: null` and
  // outranks every check in `ROLE_RANK`. This command used to resolve under it
  // and commit both nulls. `requireIdentifiedActor` (kernel/tenant.ts) is what
  // refuses it; the assertions below are on the *columns*, since the refusal
  // is only worth having if it stops the row being written.
  const { shelf, ctx, loanId } = await lentOut(sql);

  await expect(
    runCommand(sql, systemContext(shelf.id, ctx.clock), voidLoan, {
      loanId,
      reason: "Ghi nhầm",
    }),
  ).rejects.toMatchObject({ code: "not_permitted" });

  const [loan] = await sql<{ status: string; voided_by: string | null }[]>`
    select status, voided_by from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
  expect(loan.voided_by).toBeNull();
  const voids = await sql`select 1 from audit_log where action = 'loan.voided'`;
  expect(voids).toHaveLength(0);
});

test("only a manager may void a loan", async () => {
  const { ctx, reader, loanId } = await lentOut(sql);

  await expect(
    runCommand(
      sql,
      {
        ...ctx,
        actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
      },
      voidLoan,
      { loanId, reason: "Ghi nhầm" },
    ),
  ).rejects.toMatchObject({ code: "not_permitted" });

  const [loan] = await sql<{ status: string }[]>`
    select status from loans where id = ${loanId}
  `;
  expect(loan.status).toBe("active");
});
