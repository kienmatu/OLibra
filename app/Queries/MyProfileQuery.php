<?php

declare(strict_types=1);

namespace App\Queries;

use App\Models\Membership;
use App\Models\User;
use App\Support\Members\ParishUnits;
use App\Support\Members\ProfileFields;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Carbon;

/**
 * OPS §3.3's `GetMyProfile` (docs/OPERATIONS.md:67) — what a reader sees on
 * their own profile page. Port of
 * old_next/src/domain/members/queries/get-my-profile.ts.
 *
 * IT COMPOSES MyProfileChangeRequestQuery RATHER THAN RE-READING THE
 * TABLE. OPS:67 lists "current pending change if any (see
 * `GetMyProfileChangeRequest`)" as part of this query's own return and
 * points at the other query by name; calling it is what makes that pointer
 * true. The rules that query carries — most recent of ANY status, and the
 * stored JSON filtered through the allowlist on the way out — are rules
 * this page needs, and a second read of the same table would be a second
 * place for them to be got wrong.
 *
 * THE NINE FIELDS COME BACK snake_case, which is unlike every other query
 * in this codebase and is deliberate. The reference makes the argument and
 * it survives the port intact: the screen puts these side by side with
 * `pendingChange.proposedValues`, a JSON bag keyed by COLUMN name, and one
 * spelling on both sides of that comparison means the screen matches keys
 * instead of maintaining a translation table that is wrong in exactly one
 * entry.
 *
 * THE PARISH UNITS ARE RENDERED, NOT IDS, AND THE LABELS ARE THE SHELF'S
 * OWN — spec D11, on BR:247 and BR:578. `level1Label`/`level2Label` come
 * off App\Support\Members\ParishTaxonomy, which 3b-ii made editable per
 * shelf, so this is the first reader-side screen that would show the wrong
 * word if it hard-coded "Tổ" or "Giáo họ". The placement itself is
 * read-only to a reader (OPS §4.3) — the screen says to ask a manager —
 * which is why the ids do not travel and the names do.
 * `describeSelection` treats a soft-deleted unit as existing on purpose, so
 * a child stays described by the unit they are actually in on the day a
 * manager retires it, and `unitName` answers "Chưa có" rather than an empty
 * cell.
 *
 * `showLevel1`/`showLevel2` ride along rather than being recomputed in the
 * page, so "no field, or a usable one" is decided once, by
 * ParishUnits::hasVisibleLevel2, which knows that a level-2 unit under a
 * soft-deleted parent renders no options on a nested shelf.
 *
 * NO INLINE GATE — the house shape. MembershipPolicy::viewSelf is applied
 * by the controller.
 */
final class MyProfileQuery
{
    public function __construct(
        private ParishContextQuery $parish,
        private MyProfileChangeRequestQuery $changeRequest,
    ) {}

    /**
     * @return array{membershipId: string, fields: array<string, ?string>, parishLine: string, parishUnitL1Name: string, parishUnitL2Name: string, taxonomy: array{levels: int, nested: bool, level1Label: string, level2Label: string}, showLevel1: bool, showLevel2: bool, pendingChange: array<string, mixed>|null}
     */
    public function run(Membership $membership): array
    {
        $person = User::query()->find($membership->user_id);

        if ($person === null) {
            throw new ModelNotFoundException;   // a soft-deleted identity is no reader
        }

        $context = $this->parish->run();
        $taxonomy = $context['taxonomy'];
        $units = $context['units'];

        // getAttribute, not $person->{$field}: the same nine columns in the
        // same order as ProfileFields::FIELDS, so a tenth field added there
        // appears here on the day it lands rather than the day somebody
        // remembers this file. date_of_birth is cast to a date on the model
        // (App\Models\User::casts) and travels as the Y-m-d the column
        // holds — never an instant, which is what the screen's own date
        // control expects back.
        $fields = [];
        foreach (ProfileFields::FIELDS as $field) {
            $value = $person->getAttribute($field);

            $fields[$field] = match (true) {
                $value === null => null,
                $value instanceof Carbon => $value->toDateString(),
                default => (string) $value,
            };
        }

        return [
            'membershipId' => $membership->id,
            'fields' => $fields,
            'parishLine' => ParishUnits::describeSelection(
                $taxonomy, $units,
                $membership->parish_unit_l1_id, $membership->parish_unit_l2_id,
            ),
            'parishUnitL1Name' => ParishUnits::unitName($units, $membership->parish_unit_l1_id),
            'parishUnitL2Name' => ParishUnits::unitName($units, $membership->parish_unit_l2_id),
            'taxonomy' => [
                'levels' => $taxonomy->levels,
                'nested' => $taxonomy->nested,
                'level1Label' => $taxonomy->level1Label,
                'level2Label' => $taxonomy->level2Label,
            ],
            'showLevel1' => ParishUnits::options($units, 1) !== [],
            'showLevel2' => ParishUnits::hasVisibleLevel2($taxonomy, $units),
            'pendingChange' => $this->changeRequest->run($membership),
        ];
    }
}
