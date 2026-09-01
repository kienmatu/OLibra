<?php

declare(strict_types=1);

namespace App\Actions\Admin;

use App\Actions\Admin\Concerns\WritesProfileProposals;
use App\Exceptions\RuleViolated;
use App\Models\Membership;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\Members\AvatarStorage;
use App\Support\Members\ProfileProposals;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * A reader proposes a new photograph — OPS §4.3's `ProposeAvatarChange`,
 * Phase 3c-i Task 8, spec D6. Port of
 * old_next/src/domain/members/commands/propose-avatar-change.ts.
 *
 * LIKE EVERY OTHER PERSONAL FIELD IT TAKES EFFECT ONLY ON APPROVAL. The
 * product owner confirmed **every** field needs approval and named the
 * photograph explicitly (OPS:538), so this is ProposeProfileChange's
 * file-carrying case and not a separate lifecycle: it shares the pending
 * row, the field-wise merge of spec D1, and the audit action
 * `profile_change.proposed`. That sharing is why this task adds NO new
 * audit action and the census count stays where Task 6 left it.
 *
 * ── This command never sees the bytes ────────────────────────────────────
 *
 * It takes a storage key. App\Support\Members\AvatarStorage has already
 * applied the three refusals (`heic_not_supported`, `file_too_large`,
 * `invalid_image` — all facts about bytes) and written the object, because
 * OPS §4.3 requires the image to exist while the request is pending: a
 * manager looks at it while deciding. A command that wrote the file inside
 * its own transaction would leave an object nobody references the moment
 * that transaction rolled back.
 *
 * THE KEY IS MINTED BY AvatarStorage AND NEVER SUPPLIED BY A CALLER — the
 * rule RegistrationController.php:94 records for guests and
 * ProposeProfileChangeRequest records for the proposal form. What arrives
 * here is a value this application generated one call frame ago.
 *
 * ── No `empty_proposal`, deliberately ────────────────────────────────────
 *
 * ProposeProfileChange filters its patch against the person's current
 * values and refuses a proposal that would change nothing. That check has
 * no meaning here: every upload mints a fresh UUID, so a re-uploaded
 * identical photograph is a genuinely different object at a genuinely
 * different address. What a refusal WOULD do is strand bytes the surface
 * has already written, with nothing left holding their key.
 *
 * ── The superseded object, and who deletes it ────────────────────────────
 *
 * Proposing a second photograph while the first is still pending replaces
 * it in the bag, and the first one's object is then referenced by nothing.
 * IT IS DELETED AFTER THE TRANSACTION COMMITS — `DB::transaction()` returns
 * only once the commit has happened, so the discard below is post-commit as
 * control flow rather than as a comment. Deleting it inside would destroy
 * an image that a still-live row points at for as long as the commit that
 * follows might fail: a reader's photograph gone, and a request that can
 * never be approved into anything. The residual — a crash between the
 * commit and the delete orphans one object — is the half of the trade this
 * phase chooses, and docs/known-gaps.md carries it.
 *
 * ONLY WHEN IT IS A DIFFERENT OBJECT. A caller that retried with the same
 * key would otherwise be told to delete the image the row it just wrote
 * still points at.
 *
 * ── The gate is `propose`, not a reader-only one (spec D5) ───────────────
 *
 * MembershipPolicy::propose is requireSelfOrManager: a manager may set a
 * photograph on somebody's behalf, which OPS §4.3 lists as a real caller.
 * The membership is never taken from a request body — the reader's own
 * screen hands it the row ResolveTenant put on the context.
 */
final class ProposeAvatarChange
{
    use WritesProfileProposals;

    public function __construct(
        private AuditRecorder $audit,
        private AvatarStorage $avatars,
        private Clock $clock,
    ) {}

    /**
     * @param  string  $avatarObject  the storage key AvatarStorage just minted
     * @return string the request id — the SAME one when something was already pending
     */
    public function execute(User $actor, Membership $membership, string $avatarObject): string
    {
        Gate::forUser($actor)->authorize('propose', $membership);

        $avatarObject = trim($avatarObject);

        if ($avatarObject === '') {
            // Not `validation_failed` being generous: an empty key is a
            // surface that called this without storing anything, and
            // writing it would produce a request proposing a photograph
            // that does not exist.
            throw new RuleViolated('validation_failed');
        }

        /** @var array{id: string, superseded: ?string} $outcome */
        $outcome = DB::transaction(function () use ($membership, $avatarObject): array {
            // FIRST statement — the ordering rule the whole lifecycle
            // obeys. See WritesProfileProposals.
            $person = $this->lockSubjectForProposal($membership);
            $current = $this->currentProfileFields($person);

            $pending = $this->lockPendingProposal($person);
            $existing = $this->existingContents($pending);

            $next = ProfileProposals::merge(
                $existing,
                [ProfileProposals::AVATAR_OBJECT => $avatarObject],
                $current,
            );

            $requestId = $this->writeProposal($membership, $person, $pending, $next);

            // The REQUEST, not the person: nothing about the person moved.
            //
            // THE STORAGE KEY IS AUDITED, and `avatar_object` is the only
            // name it may travel under — App\Support\Audit\AuditSecrets
            // matches `key` as a whole token and would refuse
            // `avatar_key` outright. The audit row is also the only
            // DURABLE record of which object a decided request once
            // pointed at: `proposed_values` is overwritten by the next
            // proposal, while the audit log is append-only.
            $this->audit->forShelf($membership->bookshelf_id)->record(
                'profile_change.proposed',
                'profile_change_request',
                $requestId,
                [ProfileProposals::AVATAR_OBJECT => $next['previous'][ProfileProposals::AVATAR_OBJECT] ?? null],
                [ProfileProposals::AVATAR_OBJECT => $avatarObject],
            );

            $wasPending = $existing['proposed'][ProfileProposals::AVATAR_OBJECT] ?? null;

            return [
                'id' => $requestId,
                'superseded' => $wasPending !== null && $wasPending !== $avatarObject ? $wasPending : null,
            ];
        });

        // AFTER the commit. See this class's header — the ordering is the
        // whole of what this command gets right or wrong.
        $this->avatars->discard($outcome['superseded']);

        return $outcome['id'];
    }

    private function proposalClock(): Clock
    {
        return $this->clock;
    }
}
