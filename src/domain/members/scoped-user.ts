import type { Tx } from "../kernel/unit-of-work";

/**
 * The one way to name a person inside this domain, and the reason it is a type
 * rather than a convention.
 *
 * ── The hole this closes ─────────────────────────────────────────────────
 *
 * `users` carries no row-level security at all — `0010_rls.sql` names it
 * excluded by design, because it is a global table: one person is one row, and
 * they may be a member of several parishes. So `update users … where id = <any
 * user>` succeeds from any scoped session, and the *only* thing standing between
 * a manager of one parish and every person in the system is that every command
 * reaches a `users` row by joining out of a shelf-scoped `memberships` row.
 *
 * That obligation used to be prose. `profile-fields.ts` said so in its own
 * docstring — "it is the one place in this domain where that obligation is not
 * visible in the type" — and the mechanism holding it was
 * `tests/invariants/inv-13-one-pending-profile-change.test.ts`, which greps
 * `src/domain/` for `update users`. Review probed that guard and found the
 * evasion that matters: **a new command calling `applyProfileFields(tx,
 * userIdFromInput, patch)` stays green.** It writes no `update users` of its
 * own, so the grep sees nothing; it re-uses a sanctioned writer unsanctioned;
 * and it skips the `memberships` join that is the entire protection. The guard
 * is textual and the hole is semantic.
 *
 * ── How the type closes it ───────────────────────────────────────────────
 *
 * `ScopedUserId` is a `string` with a brand no value can carry by accident:
 * `unique symbol` is not constructible outside this module, so there is no cast
 * a caller can reach for that does not name `as unknown as` and read as the
 * mistake it is. Every function that takes a person's id in this domain —
 * `applyProfileFields`, `readProfileFields`, `lockPerson`, `readPendingProposal`
 * — takes this type, and the only values of it come out of the two functions
 * below, each of which performs the shelf-scoped join itself.
 *
 * So a new command cannot pass a `userId` from its own input to any of them:
 * the compiler refuses it, at the call site, in the editor, before a review
 * conversation has to happen at all. The grep test stays — it catches a
 * *different* thing, a fourth file writing the table directly — but it is no
 * longer the only thing standing there.
 *
 * ── What it deliberately does not claim ──────────────────────────────────
 *
 * That the person is a member of the *right* shelf in some absolute sense. It
 * claims exactly what the select did: this id came out of a row RLS returned
 * under `ctx.bookshelfId`, joined to a live `users` row. That is the whole of
 * the guarantee everywhere else in this codebase too, and stating it narrowly is
 * the point — a type that claimed more would be trusted for more.
 */
declare const shelfScoped: unique symbol;

export type ScopedUserId = string & { readonly [shelfScoped]: true };

/**
 * The person behind a membership **of this shelf**, or null.
 *
 * RLS scopes the `memberships` select to `ctx.bookshelfId`, so a membership id
 * belonging to another parish yields zero rows — which is why every caller's
 * refusal is `membership_not_found` ("Không tìm thấy bạn đọc này.") rather than
 * a permission error: from this shelf, that reader does not exist, and saying
 * anything else would confirm they do.
 *
 * The `join users` is the other half of the same sentence: a soft-deleted
 * identity is "no such reader" too, not a membership row that still answers
 * (IMPORTANT 4, fix-report 2026-08-08-b2-members).
 */
export async function userOfMembership(
  tx: Tx,
  membershipId: string,
): Promise<ScopedUserId | null> {
  const [row] = await tx<{ user_id: string }[]>`
    select m.user_id from memberships m
    join users u on u.id = m.user_id and u.deleted_at is null
    where m.id = ${membershipId} and m.deleted_at is null
  `;
  return row ? (row.user_id as ScopedUserId) : null;
}

/**
 * The person a profile-change request is about, reached the same way, or null.
 *
 * `profile_change_requests.user_id` references `users(id)` plainly, and RLS's
 * `with check` on that table guarantees a row's `bookshelf_id` matches the
 * session and **nothing else** — so a row naming a person with no membership
 * here is representable. Taking the id straight off the request row would be a
 * `users` write authorised by a column rather than by a policy; the
 * `join memberships` is what makes it a policy again.
 *
 * The membership id comes back with it because the deciding commands need it —
 * `ApproveProfileChange` may correct the reader's parish placement in the same
 * action — and re-selecting it separately would be a second chance to reach the
 * wrong row.
 */
export async function subjectOfProfileChange(
  tx: Tx,
  profileChangeRequestId: string,
): Promise<{ userId: ScopedUserId; membershipId: string } | null> {
  const [row] = await tx<{ user_id: string; membership_id: string }[]>`
    select r.user_id, m.id as membership_id
      from profile_change_requests r
      join memberships m on m.user_id = r.user_id and m.deleted_at is null
      join users u       on u.id = r.user_id and u.deleted_at is null
     where r.id = ${profileChangeRequestId}
  `;
  return row
    ? { userId: row.user_id as ScopedUserId, membershipId: row.membership_id }
    : null;
}
