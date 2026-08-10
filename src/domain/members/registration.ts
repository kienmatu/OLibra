import type { AuditEntry } from "../kernel/audit";
import { hashFor, verifyFor } from "../kernel/crypto";
import { RuleViolated, ValidationFailed } from "../kernel/errors";
import type { TenantContext } from "../kernel/tenant";
import type { Tx } from "../kernel/unit-of-work";
import { loadParishContext } from "./parish-context";
import { validateSelection } from "./parish-taxonomy";
import {
  assertPasswordLength,
  blank,
  type MembershipStatus,
  membershipTransition,
} from "./policy";
import { assertStorableDate } from "./profile-fields";

/**
 * Everything OPS §4.3's registration form posts.
 *
 * `fatherName` and `motherName` are **required**, against OPS §4.3's own input
 * list, which marks both optional. BR §5.3 says the opposite in as many words
 * ("father's name and mother's name (both required)") and explains why —
 * they are how a manager tells two children with the same name apart, which
 * BR §3 lists as a real edge case — BR §16.1 says it a third time, and
 * `users.father_name`/`mother_name` are `not null` in the live schema. A
 * command that treated them as optional would raise a bare 23502 from inside
 * the transaction instead of a named failure.
 */
export interface RegistrationInput {
  username?: string | null;
  password?: string | null;
  passwordConfirm?: string | null;
  saintName?: string | null;
  fullName: string;
  /** `YYYY-MM-DD`. A date, not a timestamp — a birthday has no o'clock. */
  dateOfBirth: string;
  fatherName: string;
  motherName: string;
  phone: string;
  email?: string | null;
  /**
   * An object **already** in storage, not bytes.
   *
   * B5 has landed: `src/storage/s3.ts` is the `ObjectStore`. Nothing here
   * changes because of it — the domain records which object is this person's
   * photograph and never moves one; the upload belongs to the surface, which
   * already handles a multipart form. That separation is now enforced rather
   * than merely intended: `tests/architecture/boundaries.test.ts` fails if
   * anything under `src/domain/` imports the store.
   *
   * **A URL and no key, which means this photograph can never be deleted.**
   * Every other avatar in the system arrives through `ProposeAvatarChange`,
   * which carries `avatar_object` — the storage key — in the request's
   * `proposed_values`, so rejecting, cancelling or superseding one removes the
   * object (`src/lib/avatar.ts`). One set here has no key anywhere, so a family
   * that asks the parish to take their child's photograph down cannot be
   * obliged by any code path. That is a **retention** gap, not a storage one:
   * `src/storage/s3.ts` records that the readers here are children and that
   * name-plus-face is the most identifying pair of facts in the system.
   * Closing it means a key column on `users` and a migration — master plan
   * §7.14, **B6 · Avatar retention**, owns it.
   */
  avatarUrl?: string | null;
  parishUnitL1Id?: string | null;
  parishUnitL2Id?: string | null;
}

export interface RegistrationResult {
  userId: string;
  membershipId: string;
}

/**
 * The hasher and verifier used to live here as module-level `let`s, each
 * injected once through its own setter. They moved to
 * `../kernel/crypto` (M-QA1, 2026-08-10): Turbopack bundles a module
 * imported by both `src/instrumentation.ts` (the `node` layer) and a server
 * action (the `react-server` layer) as two separate instances, each with its
 * own copy of every module-level binding — so wiring performed in one was
 * invisible to the other, and `POST /dang-ky` 500'd for every reader who
 * supplied a username and password. `crypto.ts` is not a new idea, only a
 * new address: the same throwing defaults, the same reasoning for why they
 * throw `NotWired` rather than fail silently or masquerade as a business
 * refusal, now reached from a module every layer wires on its own — see that
 * file's docstring for the rest of the argument, and
 * `src/lib/crypto-wiring.ts` for where the wiring call itself lives and why.
 */
export { hashFor, verifyFor } from "../kernel/crypto";

const trimmed = (v: string | null | undefined) => (blank(v) ? null : v!.trim());

/**
 * INV-14, checked before anything is written: either both credentials or
 * neither. The database's `users_credentials_paired` check would catch it too,
 * but as a 23514 rather than a sentence a child can read.
 */
async function credentialsFrom(
  input: RegistrationInput,
): Promise<{ username: string | null; passwordHash: string | null }> {
  const username = trimmed(input.username);
  const password = blank(input.password) ? null : input.password!;

  if (username === null && password === null) {
    return { username: null, passwordHash: null };
  }
  if (username === null || password === null) {
    throw new ValidationFailed("required_fields_missing", "username");
  }
  assertPasswordLength(password, "password_too_short");
  if (input.passwordConfirm !== undefined && input.passwordConfirm !== password) {
    throw new ValidationFailed("passwords_dont_match", "passwordConfirm");
  }
  return { username, passwordHash: await hashFor(password) };
}

/**
 * Finds the person this registration is for, or `null` if they are new.
 *
 * The anti-probe rules, in full (see the plan's "Identity is reused across
 * shelves" section for the reasoning):
 *
 * - **A supplied username is matched only against its own password.** If the
 *   username exists and the password verifies, this is that person. If it does
 *   not verify — or the account has no password at all, INV-14's valid state —
 *   the caller gets `username_taken`, exactly what an unrelated collision
 *   gives. A stranger guessing usernames learns only "taken", which the form
 *   has to tell them anyway.
 * - **With no username, the match is the exact triple** `full_name` (case
 *   -insensitively), `date_of_birth`, `phone`. No fuzzy matching: BR §5.3's own
 *   argument for requiring both parents' names is that a name alone does not
 *   identify a child, and a looser rule here would merge two people. Near
 *   -matches belong on `GetPendingRegistrations`' similar-name warning (OPS
 *   §3.3), surfaced to a manager who knows the family.
 *
 * `users` carries no RLS (DB §3), so this reads across every shelf by design —
 * that is what "identity is reused" means. Nothing about the result is
 * returned to the caller; see `register` below.
 */
async function findExistingPerson(
  tx: Tx,
  input: RegistrationInput,
  verify: (plain: string, stored: string) => Promise<boolean>,
): Promise<string | null> {
  const username = trimmed(input.username);

  if (username !== null) {
    const [row] = await tx<{ id: string; password_hash: string | null }[]>`
      select id, password_hash from users
      where lower(username) = lower(${username}) and deleted_at is null
    `;
    if (!row) return null;
    const ok =
      row.password_hash !== null &&
      !blank(input.password) &&
      (await verify(input.password!, row.password_hash));
    if (!ok) throw new RuleViolated("username_taken");
    return row.id;
  }

  const [row] = await tx<{ id: string }[]>`
    select id from users
    where deleted_at is null
      and lower(full_name) = lower(${input.fullName.trim()})
      and date_of_birth = ${input.dateOfBirth.trim()}::date
      and phone = ${input.phone.trim()}
  `;
  return row?.id ?? null;
}

/**
 * The shared body of all three registration commands (OPS §4.3:
 * `RegisterMembership`, `ManagerRegisterReader`, `RegisterMemberOnBehalf`).
 * Only `status` and who the actor is differ between them.
 *
 * Returns the result; the caller builds the audit entry, because the three
 * commands describe the same fact differently (OPS §4.3 records the manager as
 * actor for the two manager-typed ones, "distinguishing it from a
 * self-registration awaiting approval").
 */
export async function register(
  tx: Tx,
  ctx: TenantContext,
  input: RegistrationInput,
  status: "pending" | "active",
): Promise<RegistrationResult> {
  for (const [field, value] of [
    ["fullName", input.fullName],
    ["dateOfBirth", input.dateOfBirth],
    ["fatherName", input.fatherName],
    ["motherName", input.motherName],
    ["phone", input.phone],
  ] as const) {
    if (blank(value)) throw new ValidationFailed("required_fields_missing", field);
  }

  // **Before `findExistingPerson`, not merely before the insert.**
  //
  // This is the screen on which a child's date of birth is typed for the first
  // time, by a volunteer, in Vietnamese — and until review found it, `blank()`
  // above was the whole of the validation. `'02/04/2015'` (2 April, the way it
  // is written here) was stored as `2015-02-03`, silently; `'2015-02-30'` rolled
  // over into March; `'hôm qua'` came back as a `RangeError` out of the driver,
  // which OPS §2 forbids. `assertStorableDate` holds the measurements.
  //
  // The ordering matters as much as the check. `findExistingPerson`'s no-username
  // branch matches on `and date_of_birth = ${input.dateOfBirth}::date`, so a
  // mis-read date does not merely store the wrong birthday — it asks the wrong
  // question about *who this is*, and BR §5.3's whole argument for the exact
  // triple is that identity must not be decided loosely.
  assertStorableDate(input.dateOfBirth.trim(), "dateOfBirth");

  const credentials = await credentialsFrom(input);

  // OPS §4.3's named invariant: the parish rule is checked here, in the same
  // transaction as the write, "not by a constraint (DATABASE.md §7)". Verified
  // live why: the composite FK proves the unit is on this shelf and nothing
  // more — a *level-2* unit's id inserts cleanly into parish_unit_l1_id.
  const l1 = input.parishUnitL1Id ?? null;
  const l2 = input.parishUnitL2Id ?? null;
  if (l1 !== null || l2 !== null) {
    const { taxonomy, units } = await loadParishContext(tx, ctx);
    const check = validateSelection(taxonomy, units, { l1, l2 });
    if (check.blocked) throw new ValidationFailed(check.reason!, "parishUnitL1Id");
  }

  const existingId = await findExistingPerson(tx, input, verifyFor);

  let userId: string;
  if (existingId !== null) {
    // BR §5.3: "their identity is reused and only the parish details are
    // re-entered." Nothing on the person is touched — INV-13 sanctions two
    // paths by which a verified detail changes, an approved
    // ProfileChangeRequest and a manager's audited direct correction
    // (`./commands/update-reader-profile.ts`), and a registration form at a
    // second parish is neither. (This comment used to say "the only path",
    // which was true when it was written and stopped being true when BR §6's
    // INV-13 was restated on 2026-08-09; the conclusion is unchanged, and it
    // is the conclusion that is load-bearing here.)
    userId = existingId;
  } else {
    const [created] = await tx<{ id: string }[]>`
      insert into users (
        saint_name, full_name, date_of_birth, father_name, mother_name,
        phone, email, avatar_url, username, password_hash
      ) values (
        ${trimmed(input.saintName)}, ${input.fullName.trim()},
        ${input.dateOfBirth.trim()}::date, ${input.fatherName.trim()},
        ${input.motherName.trim()}, ${input.phone.trim()},
        ${trimmed(input.email)}, ${trimmed(input.avatarUrl)},
        ${credentials.username}, ${credentials.passwordHash}
      )
      returning id
    `;
    userId = created.id;
  }

  // BR §2: a rejected applicant "may re-apply", and a member who left may come
  // back. `memberships_one_per_shelf` is `unique (bookshelf_id, user_id) where
  // deleted_at is null` and ignores status entirely — verified live, a second
  // insert over a rejected row raises 23505 — so a re-application walks the
  // existing row back rather than adding one. Keeping the id keeps every audit
  // entry already pointing at this relationship pointing at the same one.
  const [existing] = await tx<{ id: string; status: string; role: string }[]>`
    select id, status, role from memberships
    where user_id = ${userId} and deleted_at is null
  `;

  if (existing) {
    // CRITICAL 1 (fix-report, 2026-08-08-b2-members): eligibility is decided
    // by `policy.ts`'s graph, never by a second, hand-maintained list of
    // statuses this file used to keep in sync with it by hand. Every walk-back
    // is, at bottom, a `-> pending` re-application (BR §2's "rejected -> pending
    // and left -> pending" edges); a manager immediately activating that same
    // reader afterwards (`status === "active"`, only ever `managerRegisterReader`,
    // which already `requireManager`s) is a further, explicit promotion on top
    // of a re-application the graph already approved — not a transition the
    // graph is asked to model in its own right, the same way a brand-new
    // insert two branches down sets `active` directly with no edge at all.
    // `suspended` has no `-> pending` edge — a suspended reader must be
    // reactivated by a manager (ReactivateMembership), never walked back to
    // pending by resubmitting the public form — so this refuses it exactly
    // the way it already refused `pending`/`active`, with the same sentence.
    //
    // Reversed on re-review (fix-report, 2026-08-08-b2-members): the walk-back
    // used to refuse outright when `existing.role !== "reader"`, to stop a
    // manager's row being silently demoted by a stranger's form submission.
    // That fear describes stripping a privilege the row does not have —
    // `role` on a non-active row confers nothing, since
    // `src/auth/guards.ts`'s membership lookup filters `and m.status =
    // 'active'`, so a `left` or `rejected` holder already resolves to
    // `guest` regardless of what `role` says. History survives in
    // `audit_log`. And the refusal was unrecoverable by anyone: nothing in
    // `src/` ever writes `memberships.role` except the hardcoded `'reader'`
    // in the insert below, so a returning ex-manager could not be re-enrolled
    // by the public form, by a manager (`managerRegisterReader` shares this
    // same function and got the identical refusal), or by any other command —
    // only by someone with database access. Forcing `role = 'reader'` here
    // instead matches the insert path two branches down, which never creates
    // anything but a `reader`, and stays safe: the row still lands in
    // whichever `status` this call was asked for, so a `pending` result still
    // waits on a manager's approval — a de-escalation, not a privilege grant.
    const move = membershipTransition(
      existing.status as MembershipStatus,
      "pending",
    );
    if (!move.allowed) {
      throw new RuleViolated("already_registered_here");
    }
    await tx`
      update memberships
      set status = ${status},
          role = 'reader',
          parish_unit_l1_id = ${l1},
          parish_unit_l2_id = ${l2},
          rejection_reason = null,
          suspension_reason = null,
          approved_by = ${status === "active" ? ctx.actor.userId : null},
          approved_at = ${status === "active" ? ctx.clock.now() : null}
      where id = ${existing.id}
    `;
    return { userId, membershipId: existing.id };
  }

  const [membership] = await tx<{ id: string }[]>`
    insert into memberships (
      bookshelf_id, user_id, role, status,
      parish_unit_l1_id, parish_unit_l2_id, approved_by, approved_at
    ) values (
      ${ctx.bookshelfId}, ${userId}, 'reader', ${status},
      ${l1}, ${l2},
      ${status === "active" ? ctx.actor.userId : null},
      ${status === "active" ? ctx.clock.now() : null}
    )
    returning id
  `;

  return { userId, membershipId: membership.id };
}

/**
 * The audit entry all three registration commands share.
 *
 * Deliberately carries no `phone`, no `dateOfBirth` and no parents' names: BR
 * §5.3 makes those manager-only fields, and `audit_log` is readable by every
 * manager of the shelf *and* by the super administrator across every shelf
 * (BR §13.2). The membership id and the person's name are enough for the
 * Vietnamese sentence BR §14 asks the browser to render.
 */
export function registrationAudit(
  input: RegistrationInput,
  result: RegistrationResult,
  status: "pending" | "active",
): AuditEntry {
  return {
    action: "membership.registered",
    entityType: "membership",
    entityId: result.membershipId,
    after: {
      userId: result.userId,
      fullName: input.fullName.trim(),
      status,
      parishUnitL1Id: input.parishUnitL1Id ?? null,
      parishUnitL2Id: input.parishUnitL2Id ?? null,
    },
  };
}
