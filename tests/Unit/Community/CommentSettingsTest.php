<?php

use App\Models\Bookshelf;
use App\Support\Community\CommentSettings;

// Grep first: `grep -rn "^function csgFix" tests/` — top-level helpers are
// process-global (AGENTS.md). No database, the LendingSettingsTest
// precedent: an unsaved Bookshelf carries whatever settings array a case
// wants without a migration or a factory in the way.
//
// SIX it() blocks, not four: fix round 1 found that two of the brief's
// four described "things" each bundle two facts killed by DIFFERENT
// mutations, so a single chained expect()->and() can't show both
// independently — Pest aborts the method on the first failure, so a run
// that only breaks the second half looks identical to one that breaks
// both. Every block below is killed by exactly one of the three
// CommentSettings mutations (or the divergence-2 misspelling), never by a
// combination.
function csgFix(array $settings): Bookshelf
{
    return new Bookshelf(['settings' => $settings]);
}

it('BR §5.5 default: comments_enabled is true off an empty settings blob', function () {
    $s = CommentSettings::fromShelf(csgFix([]));

    expect($s->commentsEnabled)->toBeTrue();
});

it('BR §5.5 default: comments_require_approval is true off an empty settings blob', function () {
    $s = CommentSettings::fromShelf(csgFix([]));

    expect($s->commentsRequireApproval)->toBeTrue();
});

it('comments_enabled => false disables comments', function () {
    $s = CommentSettings::fromShelf(csgFix(['comments_enabled' => false]));

    expect($s->commentsEnabled)->toBeFalse();
});

it('comments_require_approval => false turns moderation off', function () {
    $s = CommentSettings::fromShelf(csgFix(['comments_require_approval' => false]));

    expect($s->commentsRequireApproval)->toBeFalse();
});

it('a blob holding only comments_enabled leaves comments_require_approval at its default', function () {
    $enabledOnly = CommentSettings::fromShelf(csgFix(['comments_enabled' => false]));

    expect($enabledOnly->commentsRequireApproval)->toBeTrue();
});

it('a blob holding only comments_require_approval leaves comments_enabled at its default — the case a settings screen that writes one toggle at a time produces', function () {
    $approvalOnly = CommentSettings::fromShelf(csgFix(['comments_require_approval' => false]));

    expect($approvalOnly->commentsEnabled)->toBeTrue();
});
