import { NotFound, RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { Command } from "../../kernel/unit-of-work";
import { fold } from "../../kernel/fold";
import { checkPolicyBound, type PolicyField } from "../policy";
import type { ShelfContact } from "../../shelf/queries/get-shelf-settings";

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
  /**
   * PO feedback round 1, Task 2. Optional and defaulted to none — a shelf
   * created before anybody has typed a contact in is exactly the "onboarded
   * on a Sunday afternoon" case `ShelfIdentity.contacts`'s own docstring
   * already names, and `/quan-tri/tu-sach`'s create form (Task 3) posts this
   * alongside the rest of the profile so a super admin can name the first
   * contact at creation time rather than in a second edit.
   */
  contacts?: ShelfContact[];
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
      default_max_renewals: number;
      default_renewal_days: number;
      default_hold_days: number;
      default_due_soon_days: number;
    }[]
  >`
    select default_loan_days, default_max_concurrent_loans,
           default_max_renewals, default_renewal_days, default_hold_days,
           default_due_soon_days
      from system_settings where id
  `;

  const [row] = await tx<{ id: string }[]>`
    insert into bookshelves
      (slug, name, location, address, status, created_by, settings)
    values
      (${slug}, ${name}, ${input.location ?? null}, ${input.address ?? null},
       'active', ${ctx.actor.userId},
       ${tx.json({
         loan_days: defaults?.default_loan_days ?? 14,
         max_concurrent_loans: defaults?.default_max_concurrent_loans ?? 3,
         // QA remediation Task 23: these three used to be absent from
         // `system_settings` entirely, so a new shelf's `max_renewals` and
         // `renewal_days` came only from the `coalesce` fallbacks
         // `renewalSettingsFor` (`../../circulation/settings.ts`) applies at
         // read time (1, 7), and `due_soon_days` from `get-shelf-settings.ts`'s
         // own fallback (3) — never from a decision an administrator could see
         // or change on `/quan-tri/cai-dat`. The literals here are the same
         // numbers those fallbacks already used, so a shelf created before this
         // migration and one created after it start identically.
         max_renewals: defaults?.default_max_renewals ?? 1,
         renewal_days: defaults?.default_renewal_days ?? 7,
         hold_days: defaults?.default_hold_days ?? 3,
         due_soon_days: defaults?.default_due_soon_days ?? 3,
       })})
    returning id
  `;

  // The shelf is brand new, so there is nothing to soft-delete first — unlike
  // `updateBookshelfSettings`'s wholesale replacement below, this is a plain
  // insert per contact the caller supplied.
  for (const contact of input.contacts ?? []) {
    if (contact.name.trim() === "") {
      throw new ValidationFailed(
        "contact_name_required",
        `contact_${contact.position}`,
      );
    }
    await tx`
      insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
      values (${row.id}, ${contact.position}, ${contact.name.trim()},
              ${contact.phone}, ${contact.roleLabel})
    `;
  }

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
  /**
   * PO feedback round 1, Task 2. Replaces `keeperName`/`keeperPhone`/
   * `openingHours` — a wholesale replacement of `bookshelf_contacts`'
   * live rows, not a diff against them. See `updateBookshelfSettings`'s own
   * body for why.
   */
  contacts: ShelfContact[];
}

export interface UpdateBookshelfSettingsInput {
  bookshelfId: string;
  /** The profile's four fields together, or none of them. See below. */
  profile?: ShelfProfilePatch;
  loanDays?: number;
  maxConcurrentLoans?: number;
  maxRenewals?: number;
  renewalDays?: number;
  holdDays?: number;
  /**
   * QA remediation Task 23: joined the other five fields this command already
   * wrote field-by-field. `checkPolicyBound`'s loop below needed no change to
   * pick it up — see `../policy.ts`'s own docstring on why this was designed
   * as one table a third caller could join rather than a decision to make.
   */
  dueSoonDays?: number;
  commentsEnabled?: boolean;
  commentsRequireApproval?: boolean;
}

/**
 * OPS §4.5's `UpdateBookshelfSettings` — the profile and the lending policy.
 *
 * **The profile is all-or-nothing and the policy is field-by-field**, which is
 * an asymmetry worth explaining rather than smoothing over.
 *
 * `location` and `address` are nullable, and `null` is a value a person means:
 * clearing a street address is a real edit. So "absent" and "null" have to be
 * different, and the usual `coalesce(${x}, column)` spelling conflates them —
 * it can only express "set it" and "leave it", never "clear it". The spelling
 * that *would* work, interpolating a SQL fragment per column, is unavailable
 * here: this kernel wraps every tagged-template call in `guardPendingQuery`,
 * which attaches a `.then`, so a fragment executes as its own statement the
 * moment it is built (`get-statistics.ts` records the same discovery). Taking
 * the whole profile together sidesteps both, and it matches the one form that
 * calls this — an administrator editing a shelf sees the whole thing at once.
 *
 * `contacts` follows the same all-or-nothing rule for a different reason: it
 * is not a column at all but the live rows of `bookshelf_contacts`, and the
 * form posts all three contact blocks every time — see the write below for
 * why that makes a wholesale replacement the honest operation rather than a
 * diff.
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

  // Read before any write, for the audit `before` bag below — and so a save
  // that touches only the policy still has a true "no change" `contacts` on
  // both sides rather than an empty array pretending nothing was ever there.
  const contactsBefore = (
    await tx<
      {
        position: number;
        name: string;
        phone: string | null;
        role_label: string | null;
      }[]
    >`
      select position, name, phone, role_label
        from bookshelf_contacts
       where bookshelf_id = ${input.bookshelfId} and deleted_at is null
       order by position
    `
  ).map((c) => ({
    position: Number(c.position),
    name: c.name,
    phone: c.phone,
    roleLabel: c.role_label,
  }));

  const policy: Record<string, number | boolean> = {};
  const put = (key: string, value: number | boolean | undefined) => {
    if (value !== undefined) policy[key] = value;
  };
  put("loan_days", input.loanDays);
  put("max_concurrent_loans", input.maxConcurrentLoans);
  put("max_renewals", input.maxRenewals);
  put("renewal_days", input.renewalDays);
  put("hold_days", input.holdDays);
  put("due_soon_days", input.dueSoonDays);
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
         set name     = ${name!},
             location = ${input.profile.location},
             address  = ${input.profile.address}
       where id = ${shelf.id}
    `;

    // Wholesale replacement rather than a diff: the admin form posts all
    // three blocks every time, so "what the form said" is the complete truth
    // about this shelf's contacts. Soft-delete first, then insert, so the
    // `bookshelf_contacts_position` partial index sees the old rows as dead
    // before the new ones claim the same positions.
    //
    // `.allowZero()`: a shelf with no contacts yet — the common case for a
    // shelf created before this task, or one whose first save this is — has
    // nothing to retire, and that is not `write_target_not_found`, unlike an
    // ordinary `update`/`delete` this kernel guards by default.
    await tx`
      update bookshelf_contacts set deleted_at = ${ctx.clock.now()}
       where bookshelf_id = ${input.bookshelfId} and deleted_at is null
    `.allowZero();
    for (const contact of input.profile.contacts) {
      if (contact.name.trim() === "") {
        throw new ValidationFailed(
          "contact_name_required",
          `contact_${contact.position}`,
        );
      }
      await tx`
        insert into bookshelf_contacts (bookshelf_id, position, name, phone, role_label)
        values (${input.bookshelfId}, ${contact.position}, ${contact.name.trim()},
                ${contact.phone}, ${contact.roleLabel})
      `;
    }
  }

  if (Object.keys(policy).length > 0) {
    await tx`
      update bookshelves
         set settings = settings || ${tx.json(policy)}
       where id = ${shelf.id}
    `;
  }

  return {
    result: undefined,
    audit: {
      action: "bookshelf.settings_updated",
      entityType: "bookshelf",
      entityId: shelf.id,
      before: { name: shelf.name, contacts: contactsBefore },
      after: {
        name: name ?? shelf.name,
        contacts: input.profile ? input.profile.contacts : contactsBefore,
      },
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
