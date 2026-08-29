<?php

namespace App\Actions\Circulation;

use App\Enums\RequestStatus;
use App\Exceptions\RuleViolated;
use App\Models\Book;
use App\Models\BorrowRequest;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Circulation\RequestRules;
use App\Support\Clock;
use App\Support\TenantContext;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader joins the queue for a title — BR §16.1's "Xin mượn", port of
 * create-borrow-request.ts. This does not check whether a copy is free,
 * and that is the whole point (OPS §4.2, BR §7.2): a request is a
 * statement of intent about a TITLE and never a claim on a physical
 * object — the claim is made by ApproveBorrowRequest, by a manager, on a
 * copy they chose. Nothing here reads book_copies at all.
 *
 * NO ROW LOCK IS TAKEN HERE, and that absence is deliberate (plan
 * divergence 2). An earlier draft opened by re-reading the books row under
 * an exclusive lock; that closes a real AB-BA cycle against UpdateBook,
 * which takes X on the shelf's bookshelves row and then WRITES the book
 * row, while this command's borrow_requests insert and its audit insert
 * each want S on that same bookshelves row through their RESTRICT foreign
 * keys. The rule the lock protected — one live place in this title's queue
 * per reader — is a CONSTRAINT instead:
 * borrow_requests_one_live_per_title_member over the generated column
 * live_request_key, which nothing can race at any isolation level. The
 * read below is the sentence half (the friendly refusal in the common
 * case); the losing insert's errno 1062 is translated by constraint name,
 * exactly as LendCopy translates loans_one_active_per_copy. The reference
 * documents the race it ships ("two taps in the same second produce two
 * pending rows"); this port closes it structurally rather than by
 * serialising the whole title.
 *
 * No claim is made here, or anywhere in this phase, that the codebase is
 * deadlock-free — that claim needs two real OS processes to earn. The
 * claim is only this: this file takes no row lock, and its test greps the
 * source for the locking method's name to keep that true. It draws no
 * further inference, because the INSERT below still holds an implicit
 * exclusive record lock on the unique-index entry until commit — InnoDB's
 * documented behaviour, not something measured here — so a racing create
 * for the same (book_id, member_id) blocks on it and then receives 1062.
 * What IS measured is the translation: deleting the read below entirely
 * leaves this command's duplicate test green, the refusal arriving through
 * 1062 instead. Both the read above and that 1062 resolve to the same
 * duplicate_request sentence, so the racer's experience is identical
 * either way — what the withdrawn lock would have added is not the waiting
 * but an exclusive edge on a row UpdateBook also takes.
 *
 * The membership is the SESSION's, never a form field (plan divergence
 * 4): TenantContext::membership() is what ResolveTenant resolved for the
 * signed-in caller, so "a reader who edited the hidden field" cannot
 * exist here.
 *
 * The two guards below are NOT both defence in depth, and the difference
 * matters to whoever wires the controller. The act-as-reader gate does
 * refuse a non-Active membership, somebody else's membership and no
 * membership at all — but only for ordinary callers: AppServiceProvider
 * installs a Gate::before that returns true for any act-as-* ability when
 * $user->is_super_admin, short-circuiting that closure. A super admin who
 * belongs to no shelf therefore passes EnsureShelfRole (same gate) and
 * this command's authorize, and arrives here with a null membership from
 * ResolveTenant, which binds active memberships only. So:
 *
 *   - the null half of not_permitted is a LIVE production guard, the only
 *     thing between a super admin and a borrow_requests row with nobody
 *     behind it. Its test signs a real super admin in and reaches it;
 *     Task 12's controller needs a path for that refusal.
 *   - the ownership half (a bound membership belonging to somebody else)
 *     is defence in depth: nothing but a direct TenantContext::set() can
 *     produce it.
 *   - memberMayRequest's INV-4 refusal is also unreachable over HTTP,
 *     including for a super admin: ResolveTenant filters status = Active,
 *     so a non-Active membership binds as null and meets not_permitted
 *     first. It is kept for the future non-HTTP caller, and pinned by a
 *     test that opens the gate deliberately.
 *
 * NARROWED against the reference, explicitly (plan divergence 3): no
 * copyId input. The reference records which scanned copy prompted a
 * request; QR labels and ResolveCopyById are 2c's, so nothing in 2a can
 * produce one. 2c restores the optional input, its same-title/same-shelf
 * guards, and fills the copy_id audit key this class already writes as
 * null. member_id receives a users(id), despite its name — the schema's
 * recurring trap; the resolve happens exactly once, below.
 *
 * requested_at is written from the injected clock, though the column
 * carries a default: it is the queue's ordering key, and every hold
 * derived from it is compared against the same injected clock.
 */
final class CreateBorrowRequest
{
    public function __construct(
        private Clock $clock,
        private AuditRecorder $audit,
        private TenantContext $tenant,
    ) {}

    /** @return array{requestId: string} */
    public function execute(User $actor, Book $book): array
    {
        Gate::forUser($actor)->authorize('create', BorrowRequest::class);

        return DB::transaction(function () use ($actor, $book): array {
            // The latest committed row, not the route-bound snapshot — but
            // unlocked (see the class docblock).
            $book = Book::query()->findOrFail($book->id);

            $membership = $this->tenant->membership();
            if ($membership === null || $membership->user_id !== $actor->id) {
                throw new RuleViolated('not_permitted');
            }
            if (($code = RequestRules::memberMayRequest($membership->status)) !== null) {
                throw new RuleViolated($code);
            }

            // approved counts as well as pending: a child holding a copy
            // must not also stand in the queue for the same title.
            // Soft-deleted rows are excluded by the model's own scope —
            // and by live_request_key's own expression, which names
            // deleted_at, so the read and the index select the same set.
            $existing = BorrowRequest::query()
                ->where('book_id', $book->id)
                ->where('member_id', $membership->user_id)
                ->whereIn('status', [RequestStatus::Pending, RequestStatus::Approved])
                ->exists();
            if ($existing) {
                throw new RuleViolated('duplicate_request');
            }

            try {
                $request = BorrowRequest::query()->create([
                    'book_id' => $book->id,
                    'member_id' => $membership->user_id,
                    'status' => RequestStatus::Pending,
                    'requested_at' => $this->clock->now(),
                ]);
            } catch (QueryException $e) {
                // Divergence 2's loser: the read above missed because the
                // rival committed after it. Matched BY CONSTRAINT NAME so
                // an unrelated 1062 is never dressed up as the wrong
                // refusal; anything else rethrows untouched.
                UniqueViolation::translate($e, [
                    'borrow_requests_one_live_per_title_member' => 'duplicate_request',
                ]);
            }

            $this->audit->record('request.created', 'request', $request->id,
                // Null rather than an invented "before": the row did not exist.
                null,
                [
                    'status' => 'pending',
                    'book_id' => $book->id,
                    // Always-present null until 2c's scan path fills it.
                    'copy_id' => null,
                    // The title AS IT IS NOW, stored (P1 §3.2a) — an audit
                    // sentence must not re-read a title UpdateBook can correct.
                    'title' => $book->title,
                    // Both ids, the loan.created rule: member_id/userId is
                    // what the row holds and what the subject join reads;
                    // membership_id is the only shelf-specific one.
                    'userId' => $membership->user_id,
                    'membership_id' => $membership->id,
                ]);

            return ['requestId' => $request->id];
        });
    }
}
