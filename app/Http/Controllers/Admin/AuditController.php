<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Queries\Admin\AuditBrowserQuery;
use App\Support\Audit\AuditSentences;
use App\Support\QueryParam;
use App\Support\SafeId;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR:606's cross-shelf audit browser — the last `underConstruction` route in
 * the application, and the reader six administration actions have been
 * writing rows for since phase 3b with nothing able to open them.
 *
 * READ-ONLY, AND THEREFORE WITHOUT A SINGLE REFUSAL OR FLASH. There is no
 * write anywhere on this screen: an audit log that could be edited from a
 * screen would not be an audit log (INV-12). That is also why it is absent
 * from AdminScreensRenderFeedbackTest's hand-written list — that file pins
 * that every admin page renders the server feedback its CONTROLS produce,
 * and this page has no controls that produce any.
 *
 * SUPER-ADMIN ONLY, from the route group's own middleware — the shape every
 * other index in this directory has, and the reason there is no Gate call
 * here. A refusal in `/admin` is a 404 rather than a 403, deliberately: the
 * area does not confirm its own screens exist to somebody who may not use
 * them.
 *
 * FOUR FILTERS, ONE OF WHICH IS NEW. The actor `<select>`, the group chips
 * and the date range are the manager's own log's, shared through
 * App\Queries\Concerns\ReadsAuditLog — including the Asia/Ho_Chi_Minh
 * civil-day boundary on `?from=`/`?to=`, which spec D5 exists to stop a
 * second screen re-deriving. `?shelf=` is the new one, and the only one
 * that needed a query at all.
 *
 * EVERY PARAMETER IS GUARDED HERE, before it can reach a bind, exactly as
 * Manage\AuditLogController guards its four — FreeTextEncodingGuardTest
 * cannot see a query-string value (its recorded third blind spot). Each is
 * narrowed against a CLOSED LIST rather than merely shape-checked:
 *
 * - `?actor=` must be uuid-shaped AND name somebody this log actually
 *   records. The list is cross-shelf, so Task 6's link from
 *   `/admin/managers` — which carries an actor and no shelf — survives it.
 * - `?shelf=` must be one of the options the screen itself offers: a parish
 *   with entries, or the word AuditBrowserQuery::SITE_WIDE.
 * - `?group=` must be one of AuditSentences::GROUPS.
 * - `?from=`/`?to=` must be real calendar days.
 *
 * AN UNRECOGNISED VALUE MEANS "NO FILTER", NEVER "a filter that matches
 * nothing" — FeedbackInboxQuery's rule, applied to five parameters instead
 * of one, and the reference names the cost of the other reading: an empty
 * screen that reads as "nothing has ever happened" is the shape of a bug
 * this project has already shipped twice. On a log it would be worse than
 * on an inbox, because "no activity" is a sentence somebody might act on.
 */
class AuditController extends Controller
{
    public function index(Request $request, AuditBrowserQuery $audit): Response
    {
        $actors = $audit->actors();
        $shelves = $audit->shelves();

        $actorParam = QueryParam::first($request, 'actor');
        // SafeId::isUuid() is redundant with the membership check beside it
        // for the same reason it is on the manager's own screen — the actor
        // list is a closed set of ids, so a malformed string fails that
        // check anyway. Kept as defence in depth, and kept in the same
        // shape, so the two screens' guards read alike.
        $actorId = SafeId::isUuid($actorParam)
            && in_array($actorParam, array_column($actors, 'userId'), true)
            ? $actorParam : null;

        // The shelf is validated against the OPTIONS, which already carry
        // the site-wide word as one of their ids — so one check covers both
        // halves of the filter and there is no second list to keep in step.
        $shelfParam = QueryParam::first($request, 'shelf');
        $shelf = in_array($shelfParam, array_column($shelves, 'shelfId'), true)
            ? $shelfParam : null;

        $groupParam = QueryParam::first($request, 'group');
        $group = in_array($groupParam, AuditSentences::GROUPS, true) ? $groupParam : null;

        $from = QueryParam::civilDay($request, 'from');
        $to = QueryParam::civilDay($request, 'to');
        $page = max(1, (int) QueryParam::first($request, 'page', '1'));

        return Inertia::render('admin/audit', [
            // THE NARROWED VALUES, NOT THE RAW ONES, so the control the
            // screen shows as active is the filter actually applied.
            // Echoing a raw parameter back would let ?group=Sách light a
            // chip over a list showing everything.
            'filters' => [
                'shelf' => $shelf,
                'actor' => $actorId,
                'group' => $group,
                'from' => $from,
                'to' => $to,
            ],
            'actors' => $actors,
            'shelves' => $shelves,
            'siteWideKey' => AuditBrowserQuery::SITE_WIDE,
            'log' => $audit->run($shelf, $actorId, $group, $from, $to, $page),
        ]);
    }
}
