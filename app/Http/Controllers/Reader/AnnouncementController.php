<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\AnnouncementsQuery;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.1's Bản tin, as the reader meets it: the shelf's live notices,
 * and one of them on its own page. OPS §3.2's GetAnnouncementsList and
 * GetAnnouncementDetail, both answered by AnnouncementsQuery.
 *
 * NOTHING IS DECIDED HERE. Both methods hand a shape straight to Inertia:
 * the ordering, the excerpt and the published/lapsed filter are the
 * query's, and re-deciding any of them in this class would be the second
 * definition Task 12's design exists to prevent. What this class owns is
 * the two route names, the two page components, and turning one null into
 * one 404.
 *
 * THE GATE IS THE ROUTE'S. Both actions sit inside routes/web.php's
 * ['auth', 'role:reader'] group, so a guest is redirected to login and a
 * signed-in non-member gets EnsureShelfRole's 404 — read off that
 * middleware, which aborts 404 rather than 403 for spec §5.4's reason.
 * Neither method calls Gate::authorize: there is a role gate on the route
 * already, and the notices these two pages can show are exactly the ones
 * AnnouncementsQuery::published() and detail() hand back.
 */
class AnnouncementController extends Controller
{
    public function index(Bookshelf $shelf, AnnouncementsQuery $query): Response
    {
        return Inertia::render('shelves/announcements/index', [
            'announcements' => $query->published(),
        ]);
    }

    /**
     * A PLAIN STRING, NOT A BOUND MODEL, and the reason is measured on
     * this method rather than argued. `{announcement:slug}` would resolve
     * a row this method never reads and then re-query by slug — and the
     * binding's own 404 (any live row on this shelf) is a DIFFERENT
     * question from detail()'s (published, and not yet lapsed), so the row
     * deciding the status would not be the row deciding the content.
     *
     * MEASURED, with the route changed to {announcement:slug} and this
     * method rewritten to take `Announcement $announcement` and render it
     * directly. THREE blocks failed, not two, and the third is worth as
     * much as the pair:
     *
     *   - the draft block and the lapsed block each answered 200 where
     *     they want 404 — the two-lookup defect, reproduced;
     *   - 'a published notice opens on its own page' failed too, at its
     *     assertInertia line rather than at its status: the page was 200
     *     HTML and AssertableInertia reported "Not a valid Inertia
     *     response", because it runs json_encode over the page props
     *     before reading them.
     *
     * That third failure was traced rather than guessed, with a probe run
     * inside the suite: an Announcement's attributesToArray() ends with
     * `slug_key`, json_encode over the whole array returns false with
     * "Malformed UTF-8 characters", and the same array with `slug_key`
     * removed encodes fine. `show create table announcements` in
     * laravel-mariadb-1 gives the reason — `slug_key binary(32) GENERATED
     * ALWAYS AS (... unhex(sha2(...)) ...)`, so a whole model handed to a
     * page carries 32 raw bytes of hash into JSON.
     *
     * So the binding shape costs a wrong status AND a prop bag that will
     * not serialise. What this method renders instead is the named-key
     * array AnnouncementsQuery::detail() returns — a shape whose declared
     * return type lists exactly eight keys, read off that class.
     *
     * ONE NULL, ONE 404. A draft, a lapsed notice, a slug naming nothing
     * and a neighbouring shelf's slug are four routes into detail()'s
     * null, and they arrive here indistinguishable — which is the point,
     * because a status that told them apart would confirm a row exists to
     * someone refused it (spec §5.4). The last of those four is the
     * global scope BelongsToBookshelf installs on Announcement, measured
     * by commenting that addGlobalScope call out — the cross-shelf block
     * then becomes the filtered run's single failure, and the measurement
     * is written out in routes/web.php beside this route.
     */
    public function show(Bookshelf $shelf, string $slug, AnnouncementsQuery $query): Response
    {
        $announcement = $query->detail($slug);

        abort_unless($announcement !== null, 404);

        return Inertia::render('shelves/announcements/show', [
            'announcement' => $announcement,
        ]);
    }
}
