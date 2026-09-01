<?php

declare(strict_types=1);

namespace App\Actions\Admin\Concerns;

use App\Enums\ProfileChangeStatus;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Clock;
use App\Support\Members\ProfileFields;
use Illuminate\Database\QueryException;

/**
 * The one copy of how a proposal reaches the pending row — shared by
 * App\Actions\Admin\ProposeProfileChange (Task 2, the eight text fields)
 * and App\Actions\Admin\ProposeAvatarChange (Task 8, the photograph).
 *
 * EXTRACTED WHEN THE SECOND CALLER ARRIVED, not before. Spec D6 says the
 * avatar "shares the pending row, the merge of D1 and the audit action
 * `profile_change.proposed`" — one lifecycle with a file-carrying case, not
 * a second lifecycle. Two hand-copied versions of the lock order and the
 * duplicate-key catch below would be two places for either to be got wrong
 * separately, and both are the kind of wrong that is silent.
 *
 * IT LIVES UNDER app/Actions/Admin/ for the same reason
 * DecidesProfileChanges does: spec D10, and the fences
 * WideningArchitectureTest draws around that directory.
 *
 * ── The two orderings this trait owns ────────────────────────────────────
 *
 * 1. THE SUBJECT'S `users` ROW IS LOCKED FIRST, before anything in
 *    profile_change_requests. Reversed, a proposal races
 *    ApproveProfileChange — which reaches the same two rows from the other
 *    end — and the reference measured that deadlocking 3/3 in both
 *    directions.
 *
 * 2. THE PENDING ROW IS LOCKED AS WELL AS READ. Without it, two proposals
 *    for one person each merge onto the same stale contents and the later
 *    write discards the earlier one wholesale, both reporting success. The
 *    reference reproduced that three times.
 *
 * ── The duplicate-key catch, and why it is spelled out ───────────────────
 *
 * `pending_user_id` is generated as IF(status = 'pending', user_id, NULL)
 * with a UNIQUE index, and it is NOT the second-proposal guard: the merge
 * means there is never a second row on this shelf. What it catches is the
 * one case the tenant-scoped SELECT cannot see — a person with memberships
 * at TWO shelves, whose blocking row belongs to the other parish. Its
 * refusal is `change_already_pending`, and without the catch it would
 * surface as a raw driver error, which OPS §2 forbids.
 *
 * App\Support\UniqueViolation::translate performs exactly this match and is
 * deliberately not used: the code it raises is a MAP VALUE, and the refusal
 * census (tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php) only
 * sees a LITERAL first argument, so a code raised that way is invisible to
 * the one test that pins every code against its Vietnamese sentence.
 */
trait WritesProfileProposals
{
    /**
     * The subject's `users` row, locked — the FIRST statement of every
     * propose transaction. See this trait's header.
     */
    private function lockSubjectForProposal(Membership $membership): User
    {
        $person = User::query()->lockForUpdate()->find($membership->user_id);

        if ($person === null) {
            throw new RuleViolated('membership_not_found');
        }

        return $person;
    }

    /**
     * The pending proposal on THIS shelf, locked. BookshelfScope scopes the
     * read; null when the person has none waiting.
     */
    private function lockPendingProposal(User $person): ?ProfileChangeRequest
    {
        return ProfileChangeRequest::query()
            ->where('user_id', $person->id)
            ->where('status', ProfileChangeStatus::Pending->value)
            ->lockForUpdate()
            ->first();
    }

    /**
     * The pending row's two bags, narrowed through the allowlist — the
     * shape App\Support\Members\ProfileProposals::merge takes as $existing.
     *
     * `avatar_object` SURVIVES THIS NARROWING, and that is the graft spec
     * D6 needs: ProfileFields::pick carries all nine columns, so a pending
     * photograph's storage key is still in `$existing['proposed']` when a
     * later text-only proposal merges onto it, and is carried forward
     * rather than dropped. ProfileProposals' own header records the
     * coupling from the other side — reversing the merge to a literal
     * "replace" drops that key and orphans the image in a public-read
     * bucket forever.
     *
     * @return array{proposed: array<string, ?string>, previous: array<string, ?string>}|null
     */
    private function existingContents(?ProfileChangeRequest $pending): ?array
    {
        if ($pending === null) {
            return null;
        }

        return [
            'proposed' => ProfileFields::pick($pending->proposed_values),
            'previous' => ProfileFields::pick($pending->previous_values),
        ];
    }

    /**
     * UPDATE in place when something is already pending, INSERT when
     * nothing is.
     *
     * KEYED BY THE ROW'S EXISTING ID on the merge path, so the reader's one
     * pending card is still the same card and every surface that already
     * links to it still resolves. An INSERT there would also collide with
     * the generated column's unique index and refuse a merge the spec calls
     * normal.
     *
     * `requested_at` COMES FROM THE APPLICATION CLOCK, never the column
     * default: the default is the database host's clock, and this is a
     * timestamp the domain means — a test with a frozen clock must be able
     * to make a request look a week old without waiting a week. A merge
     * refreshes it, because the reader asked again just now.
     *
     * @param  array{proposed: array<string, ?string>, previous: array<string, ?string>}  $next
     * @return string the request id — the SAME one on a merge
     */
    private function writeProposal(
        Membership $membership,
        User $person,
        ?ProfileChangeRequest $pending,
        array $next,
    ): string {
        if ($pending !== null) {
            $pending->update([
                'proposed_values' => $next['proposed'],
                'previous_values' => $next['previous'],
                'requested_at' => $this->proposalClock()->now(),
            ]);

            return $pending->id;
        }

        try {
            $request = ProfileChangeRequest::query()->create([
                'bookshelf_id' => $membership->bookshelf_id,
                'user_id' => $person->id,
                'proposed_values' => $next['proposed'],
                'previous_values' => $next['previous'],
                'status' => ProfileChangeStatus::Pending->value,
                'requested_at' => $this->proposalClock()->now(),
            ]);
        } catch (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062
                && str_contains($e->getMessage(), 'profile_change_requests_one_pending')) {
                throw new RuleViolated('change_already_pending');
            }

            throw $e;
        }

        return $request->id;
    }

    /**
     * The nine verified columns as they stand, spelled and typed the way a
     * proposal's bags are: raw attributes, with date_of_birth as the plain
     * Y-m-d the column holds rather than the instant its cast produces.
     * UpdateReaderProfile reads its `before` the same way and for the same
     * reason — a Carbon compared against a posted string is never equal,
     * which would make every unchanged birthday look like a change.
     *
     * @return array<string, ?string>
     */
    private function currentProfileFields(User $person): array
    {
        $current = [];

        foreach (ProfileFields::FIELDS as $field) {
            $raw = $person->getAttributes()[$field] ?? null;

            $current[$field] = $field === 'date_of_birth'
                ? $person->date_of_birth?->toDateString()
                : ($raw === null ? null : (string) $raw);
        }

        return $current;
    }

    abstract private function proposalClock(): Clock;
}
