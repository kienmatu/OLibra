import {
  getBookDetailManager,
  type ManagerBookDetail,
  type ManagerCopyRow,
} from "../domain/catalogue/queries/get-book-detail-manager";
import { copyLendable } from "../domain/circulation/policy";
import type { Block } from "../domain/kernel/block";
import { NotFound } from "../domain/kernel/errors";
import type { TenantContext } from "../domain/kernel/tenant";
import type { Tx } from "../domain/kernel/unit-of-work";
import {
  getReaderDetail,
  type ReaderDetail,
} from "../domain/members/queries/get-reader-detail";

/**
 * The surface's half of the quick-lend flow: turning what a URL carries back
 * into rows, and choosing the copy the confirm screen is about.
 *
 * Everything here is a *lookup*, never a rule. The rules live in
 * `domain/circulation/policy.ts` and are applied by `lendCopy` inside its own
 * transaction; what these functions do is make sure a screen asks about the
 * same copy the command will judge (BR §16.3).
 */

/**
 * `?sach=<slug>` → the manager's view of that title, or `null`.
 *
 * **Two statements, because OPS §3.3's `GetBookDetail` (manager) takes a
 * `bookId` and every URL in this app names a book by slug.** Adding a
 * slug-shaped input to that query would be a domain change U1 is not making,
 * and the reader-facing `getBookDetail` — which does take a slug — is the
 * wrong query twice over: it is gated on `requireReader` and it filters
 * `is_published`, so a manager could not lend a title that has not been
 * announced yet, which is exactly what `getBooksList` exists to find.
 *
 * The resolving `select` runs inside the page's own scoped read-only
 * transaction, so RLS answers "which shelf's slug is this" before the query
 * does. It names no rule and returns one id.
 *
 * **`null`, not a throw, for a slug that resolves to nothing.** A missing or
 * mistyped `?sach=` is not a fault: it is the volunteer arriving at step 2 by
 * a stale link or a hand-edited URL, and the page answers with "Không tìm thấy
 * sách này." and a way back to step 1. `getBookDetailManager`'s own
 * `NotFound("book_not_found")` is unreachable from here for the same reason —
 * the id it is given was just read out of `books`.
 */
export async function bookFromSlug(
  tx: Tx,
  ctx: TenantContext,
  slug: string | undefined,
): Promise<ManagerBookDetail | null> {
  if (!slug) return null;
  const [row] = await tx<{ id: string }[]>`
    select id from books where slug = ${slug} and deleted_at is null
  `;
  if (!row) return null;
  return getBookDetailManager(tx, ctx, { bookId: row.id });
}

/**
 * The copy a walk-up lend would hand over, and — when there is none — the
 * reason, in the same code `lendCopy` would throw.
 *
 * **Every per-copy answer is `copyLendable`'s, not this file's.** That
 * predicate is `circulation/policy.ts`'s and its docstring says a screen is
 * meant to call it: "the same predicates answer both the 'can I?' question on
 * the quick-lend screen and the 'may I?' question inside the command at commit
 * time. If those were two implementations they would drift, and a volunteer
 * would be told yes and then no."
 *
 * **What this file does add is the aggregation**, because `lendCopy` judges one
 * copy and a screen is looking at a title. The rule it uses is
 * `searchBooksForLending`'s, stated in that query's own docstring: a title is
 * `copy_not_available` while it still has a copy that can come back, and
 * `copy_lost_or_retired` only when every copy it has is one or the other.
 * Reproducing the *aggregation* is what keeps step 1's sentence and step 3's
 * sentence the same sentence; reproducing the *rule* is what
 * `copyLendable` is called for instead. A title with no copies recorded at all
 * keeps `copy_not_available`, exactly as that query documents — nothing about
 * it is lost, and there is no third code whose Vietnamese anybody wrote.
 *
 * **That last case is wrong, and this is not the file that fixes it.** The
 * sentence `copy_not_available` carries is "Bản sách này đang được mượn hoặc
 * đang giữ chỗ.", and a title with no copies at all is neither on loan nor on
 * hold. U1 is the first slice to put that sentence in front of a volunteer and
 * U1 §7 records it; the fix is a new `ErrorCode` with a sentence nobody has
 * written and a new failure mode in OPS §4.1/§4.2, which is a domain change
 * belonging to the slice that makes it. Reproducing the aggregation
 * faithfully — its defect included — is what keeps step 1's sentence and step
 * 3's sentence the same sentence in the meantime. A private correction here
 * would make the two screens disagree, which is the outcome BR §16.3 exists to
 * prevent.
 *
 * **`heldForUserId` is `null`, and that is a limit rather than a decision.**
 * `ManagerCopyRow` does not carry whose hold a `held` copy is under, so INV-3's
 * second clause — a held copy *is* lendable to its own holder — cannot be
 * answered here and every `held` copy reads as unavailable. That is the
 * conservative direction, and it costs nothing today: a title whose copies are
 * all `held` is already blocked at step 1 (`copies_borrowable` requires
 * `state = 'available'`), so no volunteer reaches this screen for one.
 * Collecting a hold is `HandoverRequest`'s flow (OPS §4.2), which C2 ships and
 * which is deliberately not this screen.
 *
 * **Not `copies_borrowable`, even though step 1 counts through it.** The view
 * is stricter than the command: it also excludes an `available` copy that a
 * live approved hold names (`20260808_14_olibra_now.sql:113`). Following it
 * here would refuse a copy `lendCopy` would hand over — the "turns a child away
 * from a book that is actually there" direction. The two cannot disagree
 * through the shipped commands (`receiveReturn` writes `state = 'held'` when it
 * puts a copy aside, and `lendCopy` closes a hold it collects); C2's request
 * commands are where that could change, and this is the note for whoever writes
 * them.
 *
 * `copies` arrives ordered by `code`, so the copy chosen is the lowest
 * shelf-mark rather than whatever the plan returned — step 2 and step 3 name
 * the same one, and so does a volunteer who comes back to it.
 */
export function chooseCopyToLend(book: ManagerBookDetail): {
  copy: ManagerCopyRow | null;
  block: Block;
} {
  let sawReturnable = false;

  for (const copy of book.copies) {
    // "" is never a `users.id`, and `heldForUserId` is null on every row here
    // anyway — see the paragraph above. The comparison inside `copyLendable`
    // therefore always fails, which is the answer this screen can honestly give.
    const verdict = copyLendable({ state: copy.state, heldForUserId: null }, "");
    if (!verdict.blocked) return { copy, block: verdict };
    if (verdict.reason === "copy_not_available") sawReturnable = true;
  }

  return {
    copy: null,
    block: {
      blocked: true,
      reason:
        book.copies.length > 0 && !sawReturnable
          ? "copy_lost_or_retired"
          : "copy_not_available",
    },
  };
}

/**
 * `?nguoi-doc=<membershipId>` → OPS §3.3's `GetReaderDetail`, or `null`.
 *
 * **The shape check is not decoration.** `memberships.id` is a `uuid`, so a
 * hand-edited parameter that is not one reaches Postgres as a failed cast and
 * comes back as a raw `22P02` from inside the transaction — precisely the
 * unstructured exception OPS §2 forbids, and rendered to a volunteer as a 500.
 * Refusing the shape before the query turns a tampered URL into the same empty
 * state a stale one produces. It is a *parse*, never a permission: which
 * memberships this id may name is still RLS's answer and
 * `requireManager`'s, both of which run inside `getReaderDetail`.
 *
 * `NotFound("membership_not_found")` becomes `null` for the same reason
 * `bookFromSlug` returns one: a well-formed id naming nobody on this shelf is
 * a stale link, not a fault. Every other error propagates — a `RuleViolated`
 * from `requireManager` above all, which `loadPage` turns into the 404 U1
 * §3.4 asks for rather than a confirm screen with a blank reader on it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readerFromParam(
  tx: Tx,
  ctx: TenantContext,
  membershipId: string | undefined,
): Promise<ReaderDetail | null> {
  if (!membershipId || !UUID.test(membershipId)) return null;
  try {
    return await getReaderDetail(tx, ctx, { membershipId });
  } catch (err) {
    if (err instanceof NotFound && err.code === "membership_not_found") {
      return null;
    }
    throw err;
  }
}
