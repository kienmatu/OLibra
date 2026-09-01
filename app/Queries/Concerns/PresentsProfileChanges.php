<?php

declare(strict_types=1);

namespace App\Queries\Concerns;

use App\Models\User;
use App\Support\Members\ProfileFields;

/**
 * The card body both change queues render — BR:580's "showing the current
 * value and the proposed one side by side so the manager can see exactly
 * what would change", and BR:602's "the same pattern the shelf-level queue
 * already uses" for the cross-shelf one.
 *
 * ONE COPY, NOT TWO, and the reason is the sentence BR:602 uses. The two
 * queues differ in WHICH proposals they hold, never in how a proposal
 * reads; two hand-copied versions of this would be two places for the
 * avatar rule below to be got right separately. (App\Queries\
 * DonationQueueQuery's docblock records the opposite call for its own row
 * builder, and records it as a drift-capable pair rather than a preference
 * — this is that decision made the other way, with the third file the
 * paragraph says whoever adds the third read should write.)
 *
 * THE CURRENT HALF IS READ OFF THE PERSON, not off the request's
 * previous_values, and that is a deliberate divergence from the reader's
 * own screen. "What would change" is measured against the row as it stands
 * NOW: a manager may have corrected the person directly
 * (App\Actions\Members\UpdateReaderProfile) since the proposal was filed.
 * previous_values is a snapshot of PROPOSAL time — the right thing on
 * resources/js/pages/shelves/profile/index.tsx, where a reader reads their
 * own submission back, and the wrong thing on a decision card.
 *
 * ProfileFields::FIELDS' ORDER, not the JSON's. proposed_values is a JSON
 * column and its key order is whatever the writer happened to serialise, so
 * two proposals over the same pair of fields would otherwise list them
 * differently on a screen whose whole job is reading a change quickly.
 *
 * avatar_object CARRIES NO VALUE ACROSS THIS SEAM. It is one of the nine
 * and a proposal may name it, but its value is a storage key: a generic
 * {label}: {value} row would print one on a screen. Task 2's brief fixed
 * this rule for every surface that lists proposed fields, and Task 1's page
 * already keeps it — the FIELD is announced (the queues send
 * `avatarProposed`) and the key stays server-side until Task 8 replaces the
 * label with the two photographs.
 */
trait PresentsProfileChanges
{
    /**
     * @param  array<string, string|null>  $proposed  ProfileFields::pick's output
     * @return list<array{field: string, current: string|null, proposed: string|null}>
     */
    private static function sideBySide(User $person, array $proposed): array
    {
        $rows = [];

        foreach (ProfileFields::FIELDS as $field) {
            if ($field === 'avatar_object' || ! array_key_exists($field, $proposed)) {
                continue;
            }

            $current = $person->getAttribute($field);

            $rows[] = [
                'field' => $field,
                // date_of_birth arrives as a Carbon through the model's
                // cast, so a bare (string) would render a full timestamp
                // beside a proposed 'YYYY-MM-DD' and read as a change that
                // is not one.
                'current' => match (true) {
                    $current === null => null,
                    $field === 'date_of_birth' => $person->date_of_birth?->toDateString(),
                    default => (string) $current,
                },
                'proposed' => $proposed[$field],
            ];
        }

        return $rows;
    }
}
