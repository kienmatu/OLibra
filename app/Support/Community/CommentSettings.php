<?php

namespace App\Support\Community;

use App\Models\Bookshelf;

/**
 * BR §5.5's two comment settings, read off the shelf row the tenant
 * middleware already loaded — the port of community/policy.ts's
 * commentsEnabled and commentsRequireApproval, and the same shape
 * App\Support\Circulation\LendingSettings uses for the lending numbers.
 * One module, not a coalesce in each command: two copies of "default to
 * true" is how one later stops matching the settings screen.
 *
 * BOTH DEFAULT TRUE, and the two directions mean different things.
 * A shelf that has never opened its settings screen stores {} and both
 * take comments AND moderates them — the safe direction, chosen by the
 * requirements: turning moderation off is a deliberate act by somebody
 * who has decided their parish does not need it, and it is the only way
 * a comment starts life approved (OPS §4.4).
 *
 * THE KEY IS comments_enabled, not BR §5.5's allow_comments — the phase
 * plan's divergence 2 (docs/superpowers/plans/2026-08-30-laravel-phase-2b-
 * community-voice.md). Both the reference's reader (community/policy.ts)
 * and its writer (admin/commands/bookshelves.ts) spell it this way.
 *
 * NARROWED AT TASK 20, because the sentence this replaces overreached.
 * It said the other spelling "occurs in no source tree at all" — and
 * this docblock is itself under app/ and names it, so the claim was
 * false about its own file on the day it was written. A count is not
 * written here for the same reason: this file's own comments move it,
 * so any number would go stale inside its next edit.
 *
 * What Task 20 re-ran, and what survives the narrowing: no EXECUTABLE
 * source spells the setting BR §5.5's way, on either side of the port.
 * Every occurrence found outside the phase plan was a comment or the
 * requirements table itself.
 *
 * Whoever builds /manage/settings writes comments_enabled;
 * docs/known-gaps.md carries the entry recording the lag.
 */
final readonly class CommentSettings
{
    public function __construct(
        public bool $commentsEnabled,
        public bool $commentsRequireApproval,
    ) {}

    public static function fromShelf(Bookshelf $shelf): self
    {
        $settings = (array) $shelf->settings;

        return new self(
            commentsEnabled: (bool) ($settings['comments_enabled'] ?? true),
            commentsRequireApproval: (bool) ($settings['comments_require_approval'] ?? true),
        );
    }
}
