import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireSuperAdmin, type MembershipRole } from "../../members/policy";
import {
  pickProfileFields,
  PROFILE_FIELDS,
  type ProfileFields,
  type ProfilePatch,
} from "../../members/profile-fields";

export interface PendingManagerChangeRow {
  profileChangeRequestId: string;
  membershipId: string;
  userId: string;
  bookshelfId: string;
  shelfSlug: string;
  shelfName: string;
  /** The subject's membership role. Never `"reader"` — see this query's docstring. */
  subjectRole: Exclude<MembershipRole, "reader">;
  requestedAt: string;
  /** What was proposed. Same shape as `PendingProfileChange`'s own field. */
  proposedValues: ProfilePatch;
  /** The subject's details **right now**, read from `users` in this query — see
   * `get-pending-profile-changes.ts`'s docstring for why "current" is live rather
   * than the request's own snapshot; the same drift is possible here. */
  currentValues: ProfileFields;
  /** The snapshot taken when the proposal was made. Kept beside `currentValues`,
   * never instead of it — same reasoning as the reader-side query. */
  previousValues: ProfilePatch;
}

/**
 * The super admin's profile-change queue, `/quan-tri/doi-thong-tin`
 * (PO feedback round 1, Task 10) — the other half of §9's routing table.
 *
 * `../../members/queries/get-pending-profile-changes.ts` now filters to
 * `m.role = 'reader'`, because Task 9 routes a manager's or shelf admin's own
 * change to a `super_admin` only, and a manager reading that queue is
 * structurally unable to decide a colleague's request. This query is that
 * filter's **complement** — `m.role in ('manager', 'admin')` — and it is
 * cross-shelf where the reader-side query is not: a manager's pending change
 * can belong to any parish, and the person who may decide it oversees all of
 * them at once. Together the two queries must partition every pending
 * request with none left in neither — a request that fell into the gap
 * between them would be invisible to everyone able to decide it, which is
 * exactly the defect Task 9 introduced and this query exists to close.
 *
 * **Cross-shelf, so this runs under `runAdminQuery`, not `runQuery`.**
 * `../get-admin-overview.ts`'s docstring holds the argument in full: OPS §2
 * names the cross-shelf administration views as one of INV-10's three
 * enumerated exceptions, and `requireSuperAdmin` is restated here rather than
 * assumed from the caller, exactly as every query in that file does — the
 * kernel's own `requireSuperAdminActor` check (inside `runAdminQuery`) is not
 * redundant with it, see that function's docstring for why the two answer
 * different questions.
 *
 * **The join is the same security check `get-pending-profile-changes.ts`
 * gives at length**, restated because it applies here unchanged:
 * `profile_change_requests.user_id` references the global, RLS-free `users`
 * table plainly, so a `join memberships` is what ties the subject to a real
 * shelf at all — here, to *every* shelf at once, since nothing narrows this
 * select to one.
 *
 * **The shelf is `r.bookshelf_id`, and the `memberships` join is scoped to
 * it — `m.bookshelf_id = r.bookshelf_id`, not a bare `m.user_id = r.user_id`.**
 * Fix round 1 caught this live: the first version took the shelf from
 * `m.bookshelf_id` with no predicate tying it to the request's own shelf, so
 * a subject who holds `manager`/`admin` membership at more than one parish —
 * ordinary, not an edge case, per `../commands/managers.ts`'s "the same
 * person may be a manager of one parish and a reader of another" — produced
 * one row *per membership*, not one row per request: the same
 * `profileChangeRequestId` came back twice, labelled with two different
 * shelves, and `countPendingManagerChanges` inflated the badge the same way.
 * `pending-proposal.ts:193-198` is where the authoritative column is
 * decided in the first place — `bookshelf_id` on `profile_change_requests`
 * is always `ctx.bookshelfId` at propose time, "the shelf this call is
 * scoped to", never a value from input — so this query reads that column
 * back rather than re-deriving "which shelf" from `memberships`, which can
 * only ever answer "every shelf this person belongs to".
 * `tests/domain/admin/pending-manager-changes.test.ts`'s "a subject with
 * membership at more than one shelf is not duplicated or misattributed"
 * pins it.
 *
 * **Order is oldest first.** A queue is worked front to back; the person who
 * has waited longest for a super admin to look should not be at the bottom of
 * the list.
 *
 * **`shelfName`/`shelfSlug`/`bookshelfId` are new, and `bookshelfId` is not
 * decoration.** This queue spans every parish, so a card that only named the
 * subject would leave a super admin guessing which shelf a decision belongs
 * to — ambiguity resolved in `.superpowers/sdd/2026-08-12-po-feedback-round-1/
 * task-10-brief.md` in favour of naming the shelf on every card, by name, not
 * by slug. `bookshelfId` is what the page's own actions pass to
 * `submitAdminCommand` so the approval's audit row lands on the request's own
 * shelf rather than nowhere nameable — the same reason `admin-actions.ts`'s
 * `assignManagerAction` carries a `bookshelfId` hidden field.
 */
export async function getPendingManagerChanges(
  tx: Tx,
  ctx: TenantContext,
): Promise<PendingManagerChangeRow[]> {
  requireSuperAdmin(ctx);

  const rows = await tx<
    (ProfileFields & {
      id: string;
      membership_id: string;
      user_id: string;
      bookshelf_id: string;
      shelf_slug: string;
      shelf_name: string;
      subject_role: MembershipRole;
      requested_at: string;
      proposed_values: unknown;
      previous_values: unknown;
    })[]
  >`
    select
      r.id, r.user_id, r.proposed_values, r.previous_values,
      r.requested_at::text as requested_at,
      m.id as membership_id, m.role as subject_role,
      b.id as bookshelf_id, b.slug as shelf_slug, b.name as shelf_name,
      u.saint_name, u.full_name, u.date_of_birth::text as date_of_birth,
      u.father_name, u.mother_name, u.phone, u.phone_missing_reason, u.email,
      u.avatar_url
    from profile_change_requests r
    join memberships m  on m.user_id = r.user_id
                        and m.bookshelf_id = r.bookshelf_id
                        and m.deleted_at is null
    join users u        on u.id = r.user_id and u.deleted_at is null
    join bookshelves b  on b.id = r.bookshelf_id and b.deleted_at is null
   where r.status = 'pending'
     and m.role in ('manager', 'admin')
   order by r.requested_at
  `;

  return rows.map((row) => ({
    profileChangeRequestId: row.id,
    membershipId: row.membership_id,
    userId: row.user_id,
    bookshelfId: row.bookshelf_id,
    shelfSlug: row.shelf_slug,
    shelfName: row.shelf_name,
    subjectRole: row.subject_role as Exclude<MembershipRole, "reader">,
    requestedAt: row.requested_at,
    proposedValues: pickProfileFields(row.proposed_values),
    currentValues: Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f, row[f] ?? null]),
    ) as ProfileFields,
    previousValues: pickProfileFields(row.previous_values),
  }));
}

/**
 * The nav badge behind `getPendingManagerChanges` — a `count(*)` of the
 * identical `where` (`m.bookshelf_id = r.bookshelf_id` included, for the
 * identical reason the main query's own docstring gives — fix round 1's
 * defect inflated this count exactly as it duplicated the queue's rows, and
 * the two must agree since a badge that overcounts a queue a super admin can
 * open and count by eye is worse than no badge), for `AdminShell`'s sidebar,
 * which needs the number on every `/quan-tri` page and not only on
 * `/quan-tri/doi-thong-tin` itself. Mirrors `countUnreadFeedback`
 * (`../get-feedback-inbox.ts`) rather than having every other admin page
 * pull the full row list just to read its `.length`.
 */
export async function countPendingManagerChanges(
  tx: Tx,
  ctx: TenantContext,
): Promise<number> {
  requireSuperAdmin(ctx);

  const [row] = await tx<{ n: string }[]>`
    select count(*) as n
      from profile_change_requests r
      join memberships m on m.user_id = r.user_id
                         and m.bookshelf_id = r.bookshelf_id
                         and m.deleted_at is null
     where r.status = 'pending'
       and m.role in ('manager', 'admin')
  `;
  return Number(row?.n ?? 0);
}

/**
 * The shelf one specific request belongs to, read off `profile_change_requests`
 * itself rather than trusted from a caller.
 *
 * Fix round 1: `/quan-tri/actions.ts`'s approve/reject actions used to read a
 * posted `tu-sach` field straight off the form and pass it through as
 * `ctx.bookshelfId`, unchecked — on this admin path RLS does not run (
 * `runAdminCommand` executes as `olibra_admin` with `bypassrls`), so nothing
 * stood between a mismatched post and a `profile_change.approved` audit row
 * filed against the wrong parish. This is the same defect class the query
 * above already closed once, at `m.bookshelf_id = r.bookshelf_id`: **the
 * shelf is a fact about the request, not a value a form carries.** The two
 * actions resolve it from here — the same way `handle()`'s feedback actions
 * resolve their shelf from `getFeedbackDetail` instead of a hidden field —
 * rather than trusting what was posted.
 */
export async function getProfileChangeRequestShelf(
  tx: Tx,
  ctx: TenantContext,
  input: { profileChangeRequestId: string },
): Promise<string | null> {
  requireSuperAdmin(ctx);

  const [row] = await tx<{ bookshelf_id: string }[]>`
    select bookshelf_id from profile_change_requests
     where id = ${input.profileChangeRequestId}
  `;
  return row?.bookshelf_id ?? null;
}
