<?php

use App\Models\Bookshelf;
use App\Support\Community\CommentSettings;

// Grep first: `grep -rn "^function csgFix" tests/` — top-level helpers are
// process-global (AGENTS.md). No database, the LendingSettingsTest
// precedent: an unsaved Bookshelf carries whatever settings array a case
// wants without a migration or a factory in the way.
function csgFix(array $settings): Bookshelf
{
    return new Bookshelf(['settings' => $settings]);
}

it('BR §5.5 defaults: both comments_enabled and comments_require_approval are true off an empty settings blob', function () {
    $s = CommentSettings::fromShelf(csgFix([]));

    expect($s->commentsEnabled)->toBeTrue()
        ->and($s->commentsRequireApproval)->toBeTrue();
});

it('comments_enabled => false disables comments', function () {
    $s = CommentSettings::fromShelf(csgFix(['comments_enabled' => false]));

    expect($s->commentsEnabled)->toBeFalse();
});

it('comments_require_approval => false turns moderation off', function () {
    $s = CommentSettings::fromShelf(csgFix(['comments_require_approval' => false]));

    expect($s->commentsRequireApproval)->toBeFalse();
});

it('a blob holding only one key leaves the other at its default — the case a settings screen that writes one toggle at a time produces', function () {
    $enabledOnly = CommentSettings::fromShelf(csgFix(['comments_enabled' => false]));
    $approvalOnly = CommentSettings::fromShelf(csgFix(['comments_require_approval' => false]));

    expect($enabledOnly->commentsRequireApproval)->toBeTrue()
        ->and($approvalOnly->commentsEnabled)->toBeTrue();
});
