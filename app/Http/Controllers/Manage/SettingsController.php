<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Support\Circulation\LendingSettings;
use App\Support\Community\CommentSettings;
use App\Support\Members\ParishTaxonomy;
use Inertia\Inertia;
use Inertia\Response;

/**
 * `shelves/{shelf}/manage/settings` — OPS §3.4's `GetShelfSettings`, "view
 * this shelf's profile and lending policy", read-only, `manager`. Phase
 * 3b-ii Task 6, spec D4; replaces `ShellController::underConstruction` and
 * ports the reference's `quan-ly/cai-dat` (whose Vietnamese path segment
 * does not carry across — `RouteOrderTest` bans them).
 *
 * **THERE IS ONE METHOD HERE AND THERE WILL NOT BE A SECOND.** Spec D4
 * reversed the first draft's manager-side writer on three independent
 * grounds: `UpdateBookshelfPolicy` authorizes internally as a super
 * administrator and denies as a 404, so a manager calling it gets a 404
 * rather than a refusal; the reference's own screen renders every policy
 * value as plain text, its row component's docstring saying "plain text,
 * never a control, because a manager cannot edit it"; and BR §16.3
 * enumerates fourteen manager screens without Settings among them, while
 * §16.4 puts the lending policy on the ADMIN Bookshelves screen. So this
 * is a summary — the eight policy values, the shelf's contacts, the
 * taxonomy shape — under the sentence saying who can change them. The
 * absence of a write is asserted by `ManagerSettingsScreenTest`, in both
 * of the two places it could otherwise creep back in: the route table and
 * the component source.
 *
 * **THE THREE READS GO THROUGH THE CLASSES THAT CONSUME THESE SETTINGS,
 * NEVER THE RAW BAG.** `bookshelves.settings` is schemaless and a shelf
 * that has never been configured stores `{}`, so a direct read of a key
 * would either crash on an absent index or print a zero where the
 * application behaves as fourteen — which on a settings screen is worse
 * than a crash, because a settings screen is believed. The reference
 * shipped exactly that defect: six literals that happened to match the
 * defaults, so a shelf lending for twenty-one days read "14 ngày" here and
 * nothing disagreed out loud. `LendingSettings`, `CommentSettings` and
 * `ParishTaxonomy` each hold the same fallbacks the commands apply.
 *
 * **NO WIDENING, AND THAT IS THE ROUTE GROUP'S DOING.** `BookshelfContact`
 * carries `BelongsToBookshelf` and `BookshelfScope` fails closed, so the
 * `/admin` editor needs `App\Queries\Admin\ShelfContactsQuery` to read the
 * same rows. This group binds a tenant, so the ordinary scoped relation
 * resolves and none of that capability is needed here.
 */
class SettingsController extends Controller
{
    public function index(Bookshelf $shelf): Response
    {
        $lending = LendingSettings::fromShelf($shelf);
        $comments = CommentSettings::fromShelf($shelf);
        $taxonomy = ParishTaxonomy::fromSettings(((array) $shelf->settings)['parish_taxonomy'] ?? null);

        // camelCase, unlike the admin editor's snake_case: nothing here is
        // posted back, so there is no storage spelling for the props to
        // match. `manage/units` reads its taxonomy the same way.
        return Inertia::render('manage/settings', [
            'profile' => [
                'name' => $shelf->name,
                'location' => $shelf->location,
                'address' => $shelf->address,
            ],
            'policy' => [
                'loanDays' => $lending->loanDays,
                'maxConcurrentLoans' => $lending->maxConcurrentLoans,
                'maxRenewals' => $lending->maxRenewals,
                'renewalDays' => $lending->renewalDays,
                'holdDays' => $lending->holdDays,
                'dueSoonDays' => $lending->dueSoonDays,
                'commentsEnabled' => $comments->commentsEnabled,
                'commentsRequireApproval' => $comments->commentsRequireApproval,
            ],
            // DENSE, unlike the admin editor's always-three list: that one
            // fills three fixed form blocks and a gap at position 2 would
            // put the wrong volunteer in the wrong block. Nothing here is
            // a block, so an empty slot is simply not a line — and the
            // rows are reached through the relation, which carries its own
            // constraint, rather than through a hand-written predicate.
            'contacts' => $shelf->contacts()->orderBy('position')->get()
                ->map(fn ($contact): array => [
                    'position' => (int) $contact->position,
                    'name' => (string) $contact->name,
                    'phone' => $contact->phone,
                    'roleLabel' => $contact->role_label,
                ])->values()->all(),
            'taxonomy' => [
                'levels' => $taxonomy->levels,
                'nested' => $taxonomy->nested,
                'level1Label' => $taxonomy->level1Label,
                'level2Label' => $taxonomy->level2Label,
            ],
        ]);
    }
}
