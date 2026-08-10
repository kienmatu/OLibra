import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { fold } from "../../kernel/fold";
import { assertPhone } from "../../members/policy";
import { checkPolicyBound, type PolicyField } from "../policy";

/**
 * OPS §4.5's shelf lifecycle — the three commands that create, edit and retire a
 * bookshelf. `super_admin` only, and every one of them runs through
 * `runAdminCommand`.
 *
 * **`CreateBookshelf` is the reason `runAdminCommand` escalates the command
 * body**, not only its audit insert.
 * `20260808_08_revoke_bookshelves_insert_from_app.sql` took `insert` on
 * `bookshelves` away from `olibra_app` outright, deliberately, so this cannot
 * run under any tenant scoping — see that runner's docstring for the argument.
 *
 * **The slug is derived once and then frozen.**
 * `20260808_02_bookshelf_slug_immutable.sql` makes it immutable in the database,
 * so `UpdateBookshelfSettings` below does not accept one; OPS §3.4 says the same
 * in words ("slug (read-only after creation)"). A shelf's address appears on
 * printed notices and in a parish's own bookmarks, and changing it silently
 * breaks both.
 */

export interface CreateBookshelfInput {
  name: string;
  slug?: string;
  location?: string | null;
  address?: string | null;
  keeperName?: string | null;
  keeperPhone?: string | null;
  openingHours?: string | null;
}

/**
 * Creates the shelf, and inherits the installation's default lending policy.
 *
 * **The defaults are copied in, not referenced.** `system_settings` holds the
 * values a new shelf starts with, and this writes them into
 * `bookshelves.settings` at creation. A shelf that pointed at the system row
 * instead would change its lending policy the day an administrator edited a
 * default — silently, for every parish at once, weeks after anyone made a
 * decision about it. That is the same argument BR §5.5's per-shelf `coalesce`
 * already makes from the other direction.
 */
export const createBookshelf: Command<
  CreateBookshelfInput,
  { bookshelfId: string; slug: string }
> = async (tx, ctx, input) => {
  const name = input.name.trim();
  if (!name) throw new ValidationFailed("required_fields_missing", "name");

  const slug = (input.slug?.trim() || fold(name).replace(/\s+/g, "-")).slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new ValidationFailed("validation_failed", "slug");
  }

  // QA remediation Task 18. `keeperPhone` is nullable — a shelf may not have
  // named its keeper's number yet — so this only fires once one is actually
  // supplied. It is BR §16.1's own public-facing number for the shelf, printed
  // on `/tu-sach/[shelf]` and bound into a `tel:` link there from the moment
  // the shelf exists.
  const keeperPhone = input.keeperPhone?.trim() || null;
  if (keeperPhone !== null) {
    assertPhone(keeperPhone, "keeperPhone");
  }

  const [taken] = await tx<{ id: string }[]>`
    select id from bookshelves where slug = ${slug}
  `;
  // `bookshelves.slug` is `unique` with no partial predicate, so a soft-deleted
  // shelf still holds its address. Checked by name rather than left to the
  // `23505`, which OPS §2 forbids surfacing raw.
  if (taken) throw new RuleViolated("slug_taken");

  const [defaults] = await tx<
    {
      default_loan_days: number;
      default_max_concurrent_loans: number;
      default_hold_days: number;
    }[]
  >`
    select default_loan_days, default_max_concurrent_loans, default_hold_days
      from system_settings where id
  `;

  const [row] = await tx<{ id: string }[]>`
    insert into bookshelves
      (slug, name, location, address, keeper_name, keeper_phone, opening_hours,
       status, created_by, settings)
    values
      (${slug}, ${name}, ${input.location ?? null}, ${input.address ?? null},
       ${input.keeperName ?? null}, ${keeperPhone},
       ${input.openingHours ?? null}, 'active', ${ctx.actor.userId},
       ${tx.json({
         loan_days: defaults?.default_loan_days ?? 14,
         max_concurrent_loans: defaults?.default_max_concurrent_loans ?? 3,
         hold_days: defaults?.default_hold_days ?? 3,
       })})
    returning id
  `;

  return {
    result: { bookshelfId: row.id, slug },
    audit: {
      action: "bookshelf.created",
      entityType: "bookshelf",
      entityId: row.id,
      before: null,
      after: { name, slug },
      // The shelf did not exist when the decision was made, so the entry
      // belongs to the deployment rather than to it. `runAdminCommand` requires
      // an empty scope for a global entry, which is what the caller has.
      global: true,
    },
  };
};

export interface ShelfProfilePatch {
  name: string;
  location: string | null;
  address: string | null;
  keeperName: string | null;
  keeperPhone: string | null;
  openingHours: string | null;
}

export interface UpdateBookshelfSettingsInput {
  bookshelfId: string;
  /** All six profile fields together, or none of them. See below. */
  profile?: ShelfProfilePatch;
  loanDays?: number;
  maxConcurrentLoans?: number;
  maxRenewals?: number;
  renewalDays?: number;
  holdDays?: number;
  commentsEnabled?: boolean;
  commentsRequireApproval?: boolean;
}

/**
 * OPS §4.5's `UpdateBookshelfSettings` — the profile and the lending policy.
 *
 * **The profile is all-or-nothing and the policy is field-by-field**, which is
 * an asymmetry worth explaining rather than smoothing over.
 *
 * Five of the six profile columns are nullable, and `null` is a value a person
 * means: clearing a keeper's telephone number is a real edit. So "absent" and
 * "null" have to be different, and the usual `coalesce(${x}, column)` spelling
 * conflates them — it can only express "set it" and "leave it", never "clear
 * it". The spelling that *would* work, interpolating a SQL fragment per column,
 * is unavailable here: this kernel wraps every tagged-template call in
 * `guardPendingQuery`, which attaches a `.then`, so a fragment executes as its
 * own statement the moment it is built (`get-statistics.ts` records the same
 * discovery). Taking the six together sidesteps both, and it matches the one
 * form that calls this — an administrator editing a shelf sees all six fields.
 *
 * The policy is a `jsonb` bag, where `||` merges exactly the keys supplied and
 * leaves the rest, so field-by-field costs nothing. That matters: a form editing
 * the loan period must not clear a comment setting it never showed.
 *
 * **No slug.** It is immutable in the database
 * (`20260808_02_bookshelf_slug_immutable.sql`) and read-only in OPS §3.4; see
 * the module note.
 */
export const updateBookshelfSettings: Command<
  UpdateBookshelfSettingsInput,
  void
> = async (tx, ctx, input) => {
  const [shelf] = await tx<{ id: string; name: string }[]>`
    select id, name from bookshelves
    where id = ${input.bookshelfId} and deleted_at is null
  `;
  if (!shelf) throw new NotFound("shelf_not_found");

  const name = input.profile?.name.trim();
  if (input.profile && !name) {
    throw new ValidationFailed("required_fields_missing", "name");
  }

  // QA remediation Task 18. `keeperPhone` is one of the five nullable profile
  // columns this all-or-nothing patch writes together (see this command's own
  // docstring on why absent and null must stay distinguishable) — `null` is a
  // manager clearing a keeper's number, a real edit, so this only fires when
  // the profile carries an actual value to check.
  if (input.profile && input.profile.keeperPhone !== null) {
    assertPhone(input.profile.keeperPhone, "keeperPhone");
  }

  const policy: Record<string, number | boolean> = {};
  const put = (key: string, value: number | boolean | undefined) => {
    if (value !== undefined) policy[key] = value;
  };
  put("loan_days", input.loanDays);
  put("max_concurrent_loans", input.maxConcurrentLoans);
  put("max_renewals", input.maxRenewals);
  put("renewal_days", input.renewalDays);
  put("hold_days", input.holdDays);
  put("comments_enabled", input.commentsEnabled);
  put("comments_require_approval", input.commentsRequireApproval);

  for (const [key, value] of Object.entries(policy)) {
    // QA remediation Task 15: this used to accept any non-negative integer —
    // `loanDays: 0` included, measured live on 2026-08-10 — because `settings`
    // is a schemaless bag and no database constraint can express a range over
    // one of its keys. `checkPolicyBound` (`../policy.ts`) is the one table
    // both this command and `updateSystemDefaults` check the five numeric keys
    // above against, so `0` now reads "Số ngày cho mượn phải từ 1 đến 365
    // ngày." rather than a bare "Vui lòng kiểm tra lại thông tin." — six
    // different numbers, six different sentences, one place either is edited.
    // The two boolean keys (`comments_enabled`, `comments_require_approval`)
    // have no range to check and are excluded by the `typeof` guard exactly as
    // they were before this task.
    if (typeof value === "number") {
      checkPolicyBound(key as PolicyField, value);
    }
  }

  if (input.profile) {
    await tx`
      update bookshelves
         set name          = ${name!},
             location      = ${input.profile.location},
             address       = ${input.profile.address},
             keeper_name   = ${input.profile.keeperName},
             keeper_phone  = ${input.profile.keeperPhone},
             opening_hours = ${input.profile.openingHours}
       where id = ${shelf.id}
    `;
  }

  if (Object.keys(policy).length > 0) {
    await tx`
      update bookshelves
         set settings = settings || ${tx.json(policy)}
       where id = ${shelf.id}
    `;
  }

  void ctx;

  return {
    result: undefined,
    audit: {
      action: "bookshelf.settings_updated",
      entityType: "bookshelf",
      entityId: shelf.id,
      before: { name: shelf.name },
      after: { name: name ?? shelf.name },
    },
  };
};

/**
 * `active → archived`. OPS §4.5: "hides the shelf from the portal, retains
 * everything."
 *
 * **`status`, never `deleted_at`.** The two are different products and this
 * codebase already relies on the difference: `resolveShelfId`
 * (`src/auth/guards.ts`) filters on `status = 'active'`, which is what makes an
 * archived shelf unreachable by slug for everybody including its own admin —
 * a decision that file records at length. A soft delete would additionally take
 * it out of `bookshelves_public_read` and out of every admin listing, which is
 * not what archiving means.
 */
export const archiveBookshelf: Command<{ bookshelfId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  const [shelf] = await tx<{ id: string; name: string; status: string }[]>`
    select id, name, status from bookshelves
    where id = ${input.bookshelfId} and deleted_at is null
  `;
  if (!shelf) throw new NotFound("shelf_not_found");
  if (shelf.status === "archived") throw new RuleViolated("already_archived");

  await tx`update bookshelves set status = 'archived' where id = ${shelf.id}`;

  return {
    result: undefined,
    audit: {
      action: "bookshelf.archived",
      entityType: "bookshelf",
      entityId: shelf.id,
      before: { name: shelf.name, status: shelf.status },
      after: { status: "archived" },
      // Global, because a shelf that has just been taken out of circulation is
      // no longer a place its own manager reads a log — and because `contextFor`
      // refuses its slug from this moment on, so a shelf-scoped entry would be
      // written into a record nobody can open.
      global: true,
    },
  };
};
