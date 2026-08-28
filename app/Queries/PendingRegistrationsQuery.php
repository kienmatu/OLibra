<?php

declare(strict_types=1);

namespace App\Queries;

use App\Enums\MembershipStatus;
use App\Models\Membership;
use App\Support\Members\NameSimilarity;
use App\Support\Members\ParishUnits;
use RuntimeException;

/**
 * GetPendingRegistrations (OPS §3.3): every `pending` application on the
 * bound shelf, oldest first, carrying exactly the fields BR §16.3's
 * review card verifies in person — this row shape is the one place
 * outside the reader detail that carries date of birth, parents' names
 * and phone, because the card renders exactly them and nothing more —
 * plus the similar-name warning (BR §16.3) against ACTIVE members only:
 * a pending applicant is not yet a duplicate risk against another
 * pending one, only against someone already on the roster
 * (old_next/src/domain/members/queries/get-pending-registrations.ts:
 * `where am.status = 'active'`).
 *
 * Divergence 3: the reference computed the similar-name lookup as a
 * `LEFT JOIN LATERAL` calling Postgres's `similarity()` per row; MariaDB
 * has no such function, so this loads the active roster's names once and
 * scores each pending row against it in PHP via `NameSimilarity`. At BR
 * §1's scale (a few hundred readers per shelf) this is microseconds; the
 * day a shelf outgrows it the fix is a folded-trigram table, not a
 * stored counter.
 */
final class PendingRegistrationsQuery
{
    public function __construct(private ParishContextQuery $parish) {}

    /**
     * @return list<array{
     *     membershipId: string, userId: string, fullName: string,
     *     saintName: ?string, dateOfBirth: ?string, fatherName: string,
     *     motherName: string, phone: ?string, phoneMissingReason: ?string,
     *     parishLine: string, requestedAt: string,
     *     similarTo: ?array{membershipId: string, fullName: string, similarity: float},
     * }>
     */
    public function run(): array
    {
        $context = $this->parish->run();

        $pending = Membership::query()->with('user')
            ->where('status', MembershipStatus::Pending)
            ->whereHas('user')   // a soft-deleted identity is no applicant
            ->orderBy('created_at')->orderBy('id')
            ->get();

        $active = Membership::query()->with('user')
            ->where('status', MembershipStatus::Active)
            ->whereHas('user')
            ->get();

        $rows = [];

        foreach ($pending as $m) {
            // whereHas('user') on both queries above makes this relation
            // non-null at runtime; narrowing it into a local lets the
            // analyser see that too, instead of scattering nullsafe access
            // the runtime never actually needs.
            $user = $m->user;

            if ($user === null) {
                throw new RuntimeException('PendingRegistrationsQuery: whereHas(\'user\') left a membership with no user.');
            }

            $best = null;

            foreach ($active as $candidate) {
                if ($candidate->id === $m->id || $candidate->user === null) {
                    continue;
                }

                $score = NameSimilarity::similarity($candidate->user->full_name, $user->full_name);

                if ($score >= NameSimilarity::THRESHOLD && ($best === null || $score > $best['similarity'])) {
                    $best = [
                        'membershipId' => $candidate->id,
                        'fullName' => $candidate->user->full_name,
                        'similarity' => $score,
                    ];
                }
            }

            $rows[] = [
                'membershipId' => $m->id,
                'userId' => $m->user_id,
                'fullName' => $user->full_name,
                'saintName' => $user->saint_name,
                'dateOfBirth' => $user->date_of_birth?->toDateString(),
                'fatherName' => $user->father_name,
                'motherName' => $user->mother_name,
                'phone' => $user->phone,
                'phoneMissingReason' => $user->phone_missing_reason,
                'parishLine' => ParishUnits::describeSelection(
                    $context['taxonomy'], $context['units'],
                    $m->parish_unit_l1_id, $m->parish_unit_l2_id,
                ),
                'requestedAt' => $m->created_at->toIso8601String(),
                'similarTo' => $best,
            ];
        }

        return $rows;
    }
}
