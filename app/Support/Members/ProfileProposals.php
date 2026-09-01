<?php

declare(strict_types=1);

namespace App\Support\Members;

/**
 * What a reader may put FORWARD, and what happens when they put forward a
 * second thing while the first is still pending. Port of
 * old_next/src/domain/members/profile-proposals.ts.
 *
 * Separate from App\Support\Members\ProfileFields, and the reference's
 * reason for the split is the one that matters here too: that class says
 * which columns of `users` may ever be written — an invariant — and this
 * one says which of those a PROPOSAL may name and how two proposals
 * combine, which is a product reading. Folding them together would put the
 * reading in the same file as the invariant.
 *
 * ── The reading, isolated so it can be reversed ───────────────────────────
 *
 * BUSINESS-REQUIREMENTS.md:343 says a new proposal "replaces" an
 * outstanding one. The reference ships a field-wise MERGE instead, and
 * records why: read strictly, a reader who proposes a corrected phone
 * number and then a new photograph silently loses the phone proposal, with
 * no signal anywhere on a screen that shows one pending card. Spec D1 ports
 * the merge because it is what this port's users have had, and carries the
 * open question into docs/known-gaps.md — the product owner may still
 * prefer the literal reading.
 *
 * Reversing it is `merge()` below returning `$incoming` outright, plus the
 * coupling the reference warns about: `avatar_object` is an ordinary
 * proposable field of the stored bag, so a phone-only proposal under
 * "replace" would drop a pending photograph's storage key and orphan the
 * image in a public-read bucket forever. The avatar task's graft, or an
 * equivalent, has to be restored alongside the flip — not the flip alone.
 */
final class ProfileProposals
{
    /**
     * The jsonb key a proposed photograph's storage key is kept under.
     *
     * `avatar_object` and never `avatar_key`: App\Support\Audit\AuditSecrets
     * matches `key` as a whole token, so an `avatar_key` in an audited
     * payload would be refused outright — and this command audits exactly
     * the bag that would hold it.
     */
    public const string AVATAR_OBJECT = 'avatar_object';

    /**
     * ProfileFields::FIELDS without the photograph — eight today, nine
     * columns minus one.
     *
     * DERIVED RATHER THAN WRITTEN OUT AGAIN, so the two cannot drift: a
     * tenth verified field becomes proposable on the day it lands, which is
     * the behaviour OPS §4.3 describes ("**every** field requires
     * approval"). A hand-copied list is the version of this that is wrong
     * in exactly one entry, silently.
     *
     * The photograph is excluded here and only here, and not because it is
     * a different KIND of fact — the product owner named it explicitly when
     * confirming every field needs approval. It is the one proposable field
     * that is a FILE, so it arrives through ProposeAvatarChange, whose
     * caller has already put the bytes in storage and holds the key. That
     * command writes `avatar_object` into the same bag this class merges.
     *
     * @return list<string>
     */
    public static function proposableFields(): array
    {
        $proposable = [];

        foreach (ProfileFields::FIELDS as $field) {
            if ($field !== self::AVATAR_OBJECT) {
                $proposable[] = $field;
            }
        }

        return $proposable;
    }

    /**
     * Exactly the proposable keys a caller named, values untouched — the
     * narrowing that happens BEFORE validation, so a caller that sends
     * `avatar_object` has it dropped rather than quietly bypassing the size
     * and format policy that lives at the upload surface and cannot be
     * enforced from here.
     *
     * KEY PRESENCE IS WHAT "NAMED" MEANS, the same rule
     * ProfileFields::normalisePatch applies one step later: a key absent
     * from $fields is left out, a key present with any value — including
     * null — is kept and folded downstream.
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, mixed>
     */
    public static function onlyProposable(array $fields): array
    {
        $named = [];

        foreach (self::proposableFields() as $field) {
            if (array_key_exists($field, $fields)) {
                $named[$field] = $fields[$field];
            }
        }

        return $named;
    }

    /**
     * Combines an incoming proposal with whatever is already pending, and
     * takes BR §5.4's snapshot for the fields THIS proposal touches.
     *
     * $current is the person as they stand right now, which is what
     * `previous_values` means: BR §5.4 wants it "so a manager reviewing a
     * week-old request sees what it would actually change". Spec D3 is why
     * it is taken here at all rather than at the decision — the column is
     * NOT NULL with no default, so a row cannot be inserted without it.
     *
     * ONLY THE INCOMING FIELDS ARE RE-SNAPSHOTTED. A field already pending
     * keeps the snapshot taken when it was first proposed, "because that is
     * the moment its `previous` describes" — re-snapshotting would quietly
     * rewrite a fact about a week ago every time the reader touched an
     * unrelated field.
     *
     * WHAT IT DELIBERATELY DOES NOT DO is prune entries of $existing that
     * have since become equal to $current — say, because a manager
     * corrected the phone directly while the reader's proposal for it sat
     * pending. That would make this command edit a portion of the request
     * it was not asked about. A manager approving a proposal whose value
     * already matches simply writes the value that is already there: a
     * no-op with an honest audit entry.
     *
     * Pure, and it returns new arrays rather than mutating either argument,
     * so the caller's $existing is still available for an audit `before`.
     *
     * @param  array{proposed: array<string, ?string>, previous: array<string, ?string>}|null  $existing
     * @param  array<string, ?string>  $incoming
     * @param  array<string, ?string>  $current
     * @return array{proposed: array<string, ?string>, previous: array<string, ?string>}
     */
    public static function merge(?array $existing, array $incoming, array $current): array
    {
        $snapshot = [];
        foreach (array_keys($incoming) as $field) {
            $snapshot[$field] = $current[$field] ?? null;
        }

        if ($existing === null) {
            return ['proposed' => $incoming, 'previous' => $snapshot];
        }

        return [
            'proposed' => array_merge($existing['proposed'], $incoming),
            'previous' => array_merge($existing['previous'], $snapshot),
        ];
    }
}
