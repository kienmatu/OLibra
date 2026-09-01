<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\AuditLogQuery;
use App\Support\Audit\AuditSentences;
use App\Support\QueryParam;
use App\Support\SafeId;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class AuditLogController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, AuditLogQuery $audit): Response
    {
        $actors = $audit->actors();

        // Every parameter is a raw query value — FreeTextEncodingGuardTest
        // cannot see these (its recorded third blind spot), so each is
        // guarded HERE before it can reach an ascii_bin bind: uuid shape
        // AND membership of the shelf's own actor list for ?actor=
        // (resolving against people this log actually names keeps the
        // page's links honest — a foreign uuid narrows to nothing anyway,
        // but a filter control must not point at a person with no entries);
        // a closed map for ?group=; a real calendar day for ?from=/?to=.
        $actorParam = QueryParam::first($request, 'actor');
        // SafeId::isUuid() is currently redundant with the in_array
        // membership check that follows it: $actors is the closed list of
        // this shelf's own actor ids, so any string not shaped like one of
        // them already fails that check regardless of UUID shape. Kept as
        // defence in depth — removing the membership check (e.g. widening
        // $actors) would make the UUID guard load-bearing again, and
        // deleting it here silently would leave that future change
        // unguarded. Mutation-tested: dropping the isUuid() half leaves
        // this test suite green.
        $actorId = SafeId::isUuid($actorParam)
            && in_array($actorParam, array_column($actors, 'userId'), true)
            ? $actorParam : null;

        $groupParam = QueryParam::first($request, 'group');
        $group = in_array($groupParam, AuditSentences::GROUPS, true) ? $groupParam : null;

        // A real calendar day or null — 2026-02-31 matches the shape and is
        // still refused. The narrowing moved to QueryParam::civilDay in phase
        // 3c-ii Task 5, unchanged, when /admin/audit became its second caller.
        $from = QueryParam::civilDay($request, 'from');
        $to = QueryParam::civilDay($request, 'to');
        // The max(1, …) clamp here is currently redundant with the query's
        // own `$page = max(1, $page)` (App\Queries\Concerns\ReadsAuditLog
        // ::auditPage, which phase 3c-ii Task 5 moved it into), which
        // re-clamps whatever it is given. Kept as defence in depth for any future caller of this
        // action that isn't the query itself. Mutation-tested: dropping
        // this clamp and passing a negative page straight through still
        // leaves the suite green, because the query clamps it anyway.
        $page = max(1, (int) QueryParam::first($request, 'page', '1'));

        return Inertia::render('manage/audit', [
            'filters' => ['actor' => $actorId, 'group' => $group, 'from' => $from, 'to' => $to],
            'actors' => $actors,
            'log' => $audit->run($actorId, $group, $from, $to, $page),
        ]);
    }
}
