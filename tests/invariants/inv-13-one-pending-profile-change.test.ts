import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fixedClock } from "../../src/domain/kernel/clock";
import type { TenantContext } from "../../src/domain/kernel/tenant";
import { runCommand } from "../../src/domain/kernel/unit-of-work";
import { approveProfileChange } from "../../src/domain/members/commands/approve-profile-change";
import { proposeProfileChange } from "../../src/domain/members/commands/propose-profile-change";
import { updateReaderProfile } from "../../src/domain/members/commands/update-reader-profile";
import { PROFILE_FIELDS } from "../../src/domain/members/profile-fields";
import { makeMember, makeShelf, makeUser } from "../support/factories";
import { filesUnder } from "../support/source-text";
import { closeAll, resetDatabase, sql } from "../support/db";

/**
 * INV-13, in the wording BR §6 has held since **2026-08-09**, and the reason
 * that date matters to anyone reading this file:
 *
 * > At most one ProfileChangeRequest per person is pending at a time. A
 * > person's verified details never change silently: every change is either an
 * > approved ProfileChangeRequest or a manager's direct correction, and both
 * > write an audit record naming the actor, the time, and the values before and
 * > after. A **reader** changes their own verified details only by proposal.
 *
 * It used to read "A person's verified details change only through an approved
 * ProfileChangeRequest", and this file's own comment used to quote that. The
 * product owner answered master plan §5 Q8 — a manager corrects a reader's
 * details **directly**, with a full audit record and no approval step — and BR
 * §6 was restated before any of it was built (commit `fb95adc`).
 *
 * The restatement is narrower than it looks, and the tests below are split on
 * exactly that line:
 *
 * - **INV-13a**, the database's half, is unchanged: `profile_change_requests
 *   _one_pending`, a partial unique index. The three tests that shipped with
 *   this file assert it and are untouched.
 * - **INV-13b** was never really "the approval step". What it protects is that
 *   a person's details never change *silently*, and BR §2 already made that
 *   argument about a larger power: whoever can set a reader's password can sign
 *   in as that reader and propose anything as that reader, so the pre-2026-08-09
 *   wording bought traceability that a direct, audited edit buys more honestly.
 *   What it does still forbid is a **reader** rewriting their own verified
 *   details, and a *third* write path appearing with no argument behind it.
 */

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const clock = fixedClock("2026-08-09T02:00:00Z");

const insertPending = (userId: string, shelfId: string) => sql`
  insert into profile_change_requests
    (user_id, bookshelf_id, proposed_values, previous_values, status)
  values (${userId}, ${shelfId}, '{"full_name":"New Name"}', '{"full_name":"Old Name"}', 'pending')
`;

test("INV-13: a second pending request for the same person collides", async () => {
  // DATABASE.md §7's first half of INV-13: at most one pending request per
  // person, so a manager never faces two competing versions of the same
  // fact (BR §7.4). The other half is application discipline; as of the
  // restatement above it is tested here, further down, rather than nowhere.
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  await insertPending(user.id, shelf.id);
  await expect(insertPending(user.id, shelf.id)).rejects.toMatchObject({
    code: "23505",
  });
});

test("INV-13: a decided request does not block a new pending one", async () => {
  // The index is partial on status = 'pending'. Once a request is approved,
  // rejected or cancelled, it is history — it must not permanently occupy
  // the one pending slot for that person.
  const shelf = await makeShelf(sql);
  const user = await makeUser(sql);

  const [decided] = await sql<{ id: string }[]>`
    insert into profile_change_requests
      (user_id, bookshelf_id, proposed_values, previous_values, status, decided_at)
    values (${user.id}, ${shelf.id}, '{"full_name":"New Name"}', '{"full_name":"Old Name"}', 'approved', now())
    returning id
  `;
  expect(decided.id).toBeDefined();

  await expect(insertPending(user.id, shelf.id)).resolves.toBeDefined();
});

test("INV-13: two different people may each have a pending request", async () => {
  const shelf = await makeShelf(sql);
  const userA = await makeUser(sql);
  const userB = await makeUser(sql);

  await insertPending(userA.id, shelf.id);
  await expect(insertPending(userB.id, shelf.id)).resolves.toBeDefined();
});

// ── INV-13b, the application half ────────────────────────────────────────

/**
 * Every `.ts` under `src/domain/` whose *code* — not its prose — runs an
 * `update users`.
 *
 * Comments are stripped and string and template literals are **kept**, which
 * is the opposite of `stripCommentsAndStrings` in `tests/support/source-text
 * .ts` and is why that helper is not reused. The SQL this test is looking for
 * lives inside tagged template literals, so stripping those would find nothing
 * at all and pass forever; meanwhile three of these modules *describe* the
 * hazard in prose (`set-reader-credentials.ts` quotes the live probe verbatim),
 * so counting raw occurrences would fail a module for explaining itself.
 *
 * Known gap, stated rather than implied: a line comment containing `//` inside
 * a string on the same line can confuse the second replacement below. It is a
 * false *positive* — an extra file reported — not a silent miss, and reporting
 * a file that should not be there is a review conversation, which is what this
 * test is for.
 */
function domainFilesWritingUsers(): string[] {
  return filesUnder("src/domain")
    .filter((file) => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (every docstring)
        .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments, sparing `https://`
      return /update\s+users\b/i.test(code);
    })
    .map((file) => file.replace(process.cwd() + "/", ""));
}

test("INV-13b: exactly three files in src/domain/ write `users`, each for a stated reason", () => {
  // The negative half of INV-13b, and the only mechanism that can hold it: no
  // constraint can express which code path may write a column (DATABASE.md §7,
  // §4.11), so the discipline is only as real as a test that reads the source.
  //
  // It **enumerates** rather than counts, and that is the whole design. B2a
  // asserted in prose that `SetReaderCredentials` "must be the *only* command
  // in B2a that writes `users`" — which was false as it was written, because
  // `change-own-password.ts` was in the same slice and writes `password_hash`.
  // A test that counted would have been wrong by one and then relaxed until it
  // proved nothing.
  //
  // | File                       | Writes                     | Why it is exempt |
  // |---|---|---|
  // | `profile-fields.ts`        | the eight verified fields  | it *is* INV-13b's application half — both sanctioned paths go through it |
  // | `set-reader-credentials.ts`| `username` + `password_hash`, in one statement so INV-14's pairing cannot be broken even momentarily | credentials are not verified details; BR §2 gives a manager this power explicitly, by its own argument |
  // | `change-own-password.ts`   | `password_hash`            | BR §16.2: the password is one of the two things "not a fact about the person that a manager verified" |
  //
  // A fourth file appearing here is not necessarily wrong. It is a review
  // conversation, held at the moment it is cheap, in the suite the author is
  // already running.
  expect(domainFilesWritingUsers().sort()).toEqual([
    "src/domain/members/commands/change-own-password.ts",
    "src/domain/members/commands/set-reader-credentials.ts",
    "src/domain/members/profile-fields.ts",
  ]);
});

test("INV-13b: nothing in src/ brands a user id outside the module that resolves one", () => {
  // The half the grep above cannot see, and the reason `ScopedUserId` exists.
  //
  // Review probed the `update users` guard and found three ways past it. Two
  // were cosmetic (`update "users"`, an interpolated table name). The third was
  // not: **a new command calling `applyProfileFields(tx, userIdFromInput,
  // patch)`** writes no `update users` of its own, so the guard above stays
  // green, while skipping the shelf-scoped `memberships` join that is the whole
  // protection against a manager of one parish rewriting a person in another —
  // `users` carries no RLS at all (`0010_rls.sql`).
  //
  // `src/domain/members/scoped-user.ts` closes that in the type: the four
  // functions that take a person's id take a branded string, and the brand is a
  // `unique symbol` no value carries by accident. The compiler is therefore the
  // mechanism, not this test — but a brand is only as good as the absence of a
  // cast, and a cast is textual, so this is the textual half.
  //
  // `tests/` is deliberately exempt and `profile-fields.test.ts` uses exactly
  // this spelling: it drives the writer directly, below the commands that mint
  // an id, and says so.
  const brandingFiles = filesUnder("src")
    .filter((file) =>
      /\bas\s+(unknown\s+as\s+)?ScopedUserId\b/.test(readFileSync(file, "utf8")),
    )
    .map((file) => file.replace(process.cwd() + "/", ""));

  expect(brandingFiles).toEqual(["src/domain/members/scoped-user.ts"]);
});

test("INV-13b: a manager's direct correction writes the value and an audit record, together", async () => {
  // The second sanctioned write path. Both halves in one assertion on purpose:
  // "the details changed" and "an audit entry names who changed them" are one
  // fact under the restated INV-13, and a test that checked only the first
  // would pass against an implementation that had quietly dropped the second.
  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const ctx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  await runCommand(sql, ctx, updateReaderProfile, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });

  const [person] = await sql<
    { phone: string | null }[]
  >`select phone from users where id = ${reader.userId}`;
  expect(person.phone).toBe("0912345678");

  const [entry] = await sql<
    {
      action: string;
      actor_id: string;
      entity_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[]
  >`select action, actor_id, entity_id, before, after from audit_log`;
  expect(entry.action).toBe("profile.corrected");
  expect(entry.actor_id).toBe(manager.userId);
  expect(entry.entity_id).toBe(reader.userId);
  expect(entry.before).toEqual({ phone: "0900000000" });
  expect(entry.after).toEqual({ phone: "0912345678" });
});

test("INV-13b: an approved request writes the value and an audit record, together", async () => {
  // The first sanctioned write path, through the command rather than through
  // raw SQL. The three tests at the top of this file prove the *index*; none of
  // them proves that anything in `src/domain/` behaves correctly when it fires.
  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const reader = await makeMember(sql, shelf.id, { status: "active" });
  const readerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: reader.userId, membershipId: reader.id, role: "reader" },
    clock,
  };
  const managerCtx: TenantContext = {
    bookshelfId: shelf.id,
    actor: { userId: manager.userId, membershipId: manager.id, role: "manager" },
    clock,
  };

  await runCommand(sql, readerCtx, proposeProfileChange, {
    membershipId: reader.id,
    fields: { phone: "0912345678" },
  });
  const [request] = await sql<
    { id: string }[]
  >`select id from profile_change_requests where user_id = ${reader.userId}`;

  // INV-13b's other half, and master plan §7.2's acceptance clause: the
  // proposal on its own left the existing number in force.
  const [duringProposal] = await sql<
    { phone: string | null }[]
  >`select phone from users where id = ${reader.userId}`;
  expect(duringProposal.phone).toBe("0900000000");

  await runCommand(sql, managerCtx, approveProfileChange, {
    profileChangeRequestId: request.id,
  });

  const [person] = await sql<
    { phone: string | null }[]
  >`select phone from users where id = ${reader.userId}`;
  expect(person.phone).toBe("0912345678");

  const [entry] = await sql<
    { action: string; actor_id: string; entity_id: string }[]
  >`select action, actor_id, entity_id from audit_log where action = 'profile_change.approved'`;
  expect(entry.actor_id).toBe(manager.userId);
  expect(entry.entity_id).toBe(reader.userId);
});

test("INV-13b: every field is writable through BOTH sanctioned paths, asserted per field", async () => {
  // Drift 1 in the plan, and the reason `PROFILE_FIELDS` is data rather than
  // two hand-written lists. Two write paths are two field lists that can
  // disagree, and the failure is silent: a field added to one path is simply
  // not writable through the other and nothing raises. Driven per field rather
  // than per path, so the assertion that fails names the field.
  const values: Record<string, string> = {
    saint_name: "Maria",
    full_name: "Nguyễn Thị Mai",
    date_of_birth: "2014-01-31",
    father_name: "Giuse Nguyễn Văn C",
    mother_name: "Anna Lê Thị D",
    phone: "0987654321",
    email: "mai@vd.vn",
    avatar_url: "https://vd.vn/anh.jpg",
  };

  const shelf = await makeShelf(sql);
  const manager = await makeMember(sql, shelf.id, { role: "manager" });
  const ctx = (userId: string, membershipId: string): TenantContext => ({
    bookshelfId: shelf.id,
    actor: { userId, membershipId, role: "manager" },
    clock,
  });
  const managerCtx = ctx(manager.userId, manager.id);

  for (const field of PROFILE_FIELDS) {
    const value = values[field];

    // Path 1 — the manager's direct correction.
    const viaEdit = await makeMember(sql, shelf.id, { status: "active" });
    await runCommand(sql, managerCtx, updateReaderProfile, {
      membershipId: viaEdit.id,
      fields: { [field]: value },
    });

    // Path 2 — an approved request. Inserted directly rather than proposed,
    // because `avatar_url` deliberately does not go through
    // `ProposeProfileChange` (it is `ProposeAvatarChange`'s, a later wave) —
    // and it is `ApproveProfileChange`'s handling of `proposed_values` that is
    // under test here, not the reader's route into it.
    const viaApproval = await makeMember(sql, shelf.id, { status: "active" });
    await sql`
      insert into profile_change_requests
        (user_id, bookshelf_id, proposed_values, previous_values, status)
      values (${viaApproval.userId}, ${shelf.id},
              ${sql.json({ [field]: value })}, ${sql.json({ [field]: null })},
              'pending')
    `;
    const [request] = await sql<
      { id: string }[]
    >`select id from profile_change_requests where user_id = ${viaApproval.userId}`;
    await runCommand(sql, managerCtx, approveProfileChange, {
      profileChangeRequestId: request.id,
    });

    const [[edited], [approved]] = await Promise.all([
      sql.unsafe(`select ${field}::text as v from users where id = $1`, [
        viaEdit.userId,
      ]) as unknown as Promise<{ v: string | null }[]>,
      sql.unsafe(`select ${field}::text as v from users where id = $1`, [
        viaApproval.userId,
      ]) as unknown as Promise<{ v: string | null }[]>,
    ]);
    expect(edited.v, `${field} via UpdateReaderProfile`).toBe(value);
    expect(approved.v, `${field} via ApproveProfileChange`).toBe(value);
  }
});
