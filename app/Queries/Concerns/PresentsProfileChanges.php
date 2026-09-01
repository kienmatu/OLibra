<?php

declare(strict_types=1);

namespace App\Queries\Concerns;

use App\Models\User;
use App\Support\Members\AvatarStorage;
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
 * {label}: {value} row would print one on a screen. sideBySide() therefore
 * skips the field outright, and avatarPair() below sends ADDRESSES instead —
 * the same rule App\Queries\MyProfileChangeRequestQuery keeps on the
 * reader's own page, and the same one RegistrationController records for
 * registration: a key is minted server-side and never crosses a seam.
 *
 * ── Why the queues send the PICTURES and not a sentence ──────────────────
 *
 * They used to send `avatarProposed` as a bare boolean and each screen
 * rendered "Bạn đọc có gửi kèm ảnh đại diện mới." underneath the table. That
 * meant a manager APPROVED A PHOTOGRAPH OF A CHILD on the strength of a
 * sentence saying one existed. BR:580's whole demand of this card is that
 * the manager "can see exactly what would change", and for the one field
 * that is a picture, seeing it is the entire decision — a wrong face, a
 * screenshot, an unsuitable image are not things a boolean can carry.
 *
 * `AvatarStorage::url()` is a config-derived read of a local disk with no
 * constructor dependencies and no tenancy of its own, so the UNBOUND
 * `/admin` queue can call it exactly as the reader's tenant-bound page
 * does. That is why this lives in the shared trait rather than in the one
 * queue that happened to need it first.
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

    /**
     * The two addresses a decision card shows: the photograph in force and
     * the one waiting.
     *
     * THE CURRENT HALF IS READ OFF THE PERSON, not off `previous_values`,
     * for this trait's own stated reason — a manager may have corrected the
     * record since the proposal was filed, and "what would change" is
     * measured against the row as it stands now. That is a deliberate
     * divergence from the reader's own page, which reads its `previous`
     * half out of the request because a reader is reading their own
     * submission back; the prop is named `currentAvatarUrl` here and
     * `previousAvatarUrl` there so the two cannot be confused.
     *
     * NO STATUS GATE, unlike MyProfileChangeRequestQuery's pair. Both queues
     * are built from a `status = pending` predicate, so no row reaching this
     * method has had either object discarded yet — spec D6's deletes all
     * happen at decision time. A gate here would be dead code arguing that
     * the predicate above it might change.
     *
     * @param  array<string, string|null>  $proposed  ProfileFields::pick's output
     * @return array{avatarProposed: bool, proposedAvatarUrl: string|null, currentAvatarUrl: string|null}
     */
    private static function avatarPair(AvatarStorage $avatars, User $person, array $proposed): array
    {
        return [
            // Still a FLAG beside the addresses, never inferred from a URL
            // being non-null: a proposal that names the field is a different
            // thing from one whose image is readable, and a disk
            // misconfigured after a docroot change would otherwise turn
            // "they proposed a new photograph" silently into "they proposed
            // nothing" on the one screen where that matters most.
            'avatarProposed' => array_key_exists('avatar_object', $proposed),
            'proposedAvatarUrl' => $avatars->url($proposed['avatar_object'] ?? null),
            'currentAvatarUrl' => $avatars->url($person->avatar_object),
        ];
    }
}
