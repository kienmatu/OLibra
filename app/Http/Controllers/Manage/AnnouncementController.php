<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Community\CreateAnnouncement;
use App\Actions\Community\HideAnnouncement;
use App\Actions\Community\PinAnnouncement;
use App\Actions\Community\PublishAnnouncement;
use App\Actions\Community\UnpinAnnouncement;
use App\Actions\Community\UpdateAnnouncement;
use App\Http\Controllers\Controller;
use App\Http\Requests\Community\PublishAnnouncementRequest;
use App\Http\Requests\Community\StoreAnnouncementRequest;
use App\Http\Requests\Community\UpdateAnnouncementRequest;
use App\Models\Announcement;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\AnnouncementsQuery;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.1's Bản tin, as the manager meets it: the list of everything the
 * shelf has ever posted, the compose and edit forms, and the four decisions
 * a row carries. OPS §4.4's CreateAnnouncement, UpdateAnnouncement,
 * PublishAnnouncement, HideAnnouncement, PinAnnouncement and
 * UnpinAnnouncement, each behind one route.
 *
 * THIS CLASS IS THE RENAME THE THREE ANNOUNCEMENT FORM REQUESTS HAVE BEEN
 * WAITING FOR, and getting it wrong collapses three request shapes into two
 * while each Form Request and each command still behaves as its own docblock
 * describes. StoreAnnouncementRequest,
 * UpdateAnnouncementRequest and PublishAnnouncementRequest each validate
 * `expires_at`; App\Actions\Community\UpdateAnnouncement and
 * PublishAnnouncement each read `expiresAt` out of their $changes array. All
 * three request docblocks say so and say nothing maps them; changes() below
 * is the map, and it is the first one in the codebase.
 *
 * BOTH IDIOMATIC SPELLINGS OF THAT MAP ARE WRONG, and both were measured
 * against this repository before this class was written (the measurements
 * are written out in PublishAnnouncementRequest's docblock, which is where
 * the probe was run):
 *
 *   - `$request->date('expires_at')` answers null for an ABSENT key and null
 *     for a present-empty one, so a presence test built on it cannot tell
 *     "leave the expiry alone" from "clear the expiry". `has()` separates
 *     them; `filled()` does not, being false for both. Hence
 *     array_key_exists() over validated(), below.
 *   - `CarbonImmutable::parse(null)` answers the current instant, not null,
 *     so a cleared expiry would be stored as the publish instant and the
 *     notice would lapse in the same breath it was posted — with its status,
 *     its flash and its published_at all reading correct. Hence the
 *     null-preserving ternary in instant(), below.
 *
 * Both are pinned by blocks in
 * tests/Feature/Community/ManagerAnnouncementsScreenTest.php that assert the
 * expires_at COLUMN rather than a status: 'Đăng lại with no date' for the
 * parse, 'PATCH naming only the title' for the presence. Each was reddened
 * by mutation before this file shipped.
 *
 * NOTHING ABOUT WHAT A NOTICE IS IS DECIDED HERE. The three chips come from
 * AnnouncementsQuery::managed(), which labels each row through the one
 * helper Task 12 built for exactly this, and re-deriving `showing` from
 * publishedAt and expiresAt on this class or on the page would be the third
 * clock that query's docblock warns about. What this class owns is nine
 * route names, two page components, six flashes and the rename.
 *
 * THE GATE IS THE ROUTE'S, and it is doubled on the three routes carrying a
 * Form Request. routes/web.php's manage group is ['auth', 'role:manager'],
 * which 404s a non-manager out of EnsureShelfRole; store, update and publish
 * additionally meet their Form Request's own abort_unless(Gate::allows(
 * 'act-as-manager'), 404). Which door answers first for each of the nine
 * routes was measured for this task by removing role:manager and recording
 * every answer; the run is in the task report, and no method here calls
 * Gate::authorize itself — the commands do, and their AnnouncementPolicy
 * abilities delegate to the same gate.
 */
class AnnouncementController extends Controller
{
    public function index(Bookshelf $shelf, AnnouncementsQuery $announcements): Response
    {
        return Inertia::render('manage/announcements/index', [
            'announcements' => $announcements->managed(),
        ]);
    }

    public function create(Bookshelf $shelf): Response
    {
        // The same component as edit(), handed a null row. One form, two
        // routes: a compose screen and an edit screen that differed by more
        // than their heading would be two places for "what a notice is
        // made of" to be written down.
        return Inertia::render('manage/announcements/form', [
            'announcement' => null,
        ]);
    }

    public function store(StoreAnnouncementRequest $request, Bookshelf $shelf, CreateAnnouncement $create): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $create->execute(
            $user,
            $validated['title'],
            $validated['body'],
            pinned: (bool) ($validated['is_pinned'] ?? false),
            // published_at is mapped even though the compose form sends no
            // such box: StoreAnnouncementRequest validates the key, so the
            // day a form grows one it reaches the command without an edit
            // here. What the shipped form does send is nothing, which is
            // why a new notice is a draft — see the flash sentence.
            publishedAt: self::instant($validated['published_at'] ?? null),
            expiresAt: self::instant($validated['expires_at'] ?? null),
        );

        return redirect()
            ->route('shelves.manage.announcements.index', ['shelf' => $shelf->slug])
            ->with('success', __('rules.announcement_created_flash'));
    }

    /**
     * THE ROW COMES FROM managed(), NOT FROM THE BOUND MODEL, and the reason
     * is measured rather than stylistic. Task 13 traced what a bare
     * Announcement costs a page: attributesToArray() ends with `slug_key`, a
     * binary(32) generated column, json_encode over the whole array returns
     * false with "Malformed UTF-8 characters", and AssertableInertia — which
     * encodes the props before reading them — reports "Not a valid Inertia
     * response." So this method looks the bound row up in the list the index
     * already renders, which also gives the form the `state` its heading
     * reads without a second derivation.
     *
     * The scan is linear over one shelf's announcements. That is a parish
     * bulletin, not a catalogue, and buying a second query shape to avoid it
     * would be buying a second row shape too.
     *
     * The abort is a type obligation as much as a refusal: $announcement is
     * bound through this shelf and managed() reads every announcement on it,
     * so the two agree — but the loop's result is nullable and a null must
     * become a status, not a TypeError.
     */
    public function edit(Bookshelf $shelf, Announcement $announcement, AnnouncementsQuery $announcements): Response
    {
        $row = null;

        foreach ($announcements->managed() as $candidate) {
            if ($candidate['id'] === $announcement->id) {
                $row = $candidate;
                break;
            }
        }

        abort_unless($row !== null, 404);

        return Inertia::render('manage/announcements/form', [
            'announcement' => $row,
        ]);
    }

    public function update(UpdateAnnouncementRequest $request, Bookshelf $shelf, Announcement $announcement, UpdateAnnouncement $update): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $update->execute($user, $announcement, self::changes($request->validated()));

        return redirect()
            ->route('shelves.manage.announcements.index', ['shelf' => $shelf->slug])
            ->with('success', __('rules.announcement_updated_flash'));
    }

    /**
     * *Đăng ngay* and *Đăng lại*, one route, because
     * App\Actions\Community\PublishAnnouncement is one command. What tells
     * them apart is not the button but the row: that command refuses an
     * announcement whose published_at is already set UNLESS an expiry was
     * supplied, and a lapsed notice is still a published one. So the page's
     * republish form always sends the expires_at key — empty by default —
     * and changes() renames a present null into a present `expiresAt`, which
     * the command reads as a supply and writes as a cleared column.
     */
    public function publish(PublishAnnouncementRequest $request, Bookshelf $shelf, Announcement $announcement, PublishAnnouncement $publish): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $publish->execute($user, $announcement, self::changes($request->validated()));

        return back()->with('success', __('rules.announcement_published_flash'));
    }

    public function hide(Request $request, Bookshelf $shelf, Announcement $announcement, HideAnnouncement $hide): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $hide->execute($user, $announcement);

        return back()->with('success', __('rules.announcement_hidden_flash'));
    }

    public function pin(Request $request, Bookshelf $shelf, Announcement $announcement, PinAnnouncement $pin): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $pin->execute($user, $announcement);

        return back()->with('success', __('rules.announcement_pinned_flash'));
    }

    public function unpin(Request $request, Bookshelf $shelf, Announcement $announcement, UnpinAnnouncement $unpin): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $unpin->execute($user, $announcement);

        return back()->with('success', __('rules.announcement_unpinned_flash'));
    }

    /**
     * validated() -> the $changes array UpdateAnnouncement and
     * PublishAnnouncement read. Three keys pass through; the fourth is
     * renamed.
     *
     * PRESENCE IS array_key_exists(), NEVER isset() AND NEVER filled(). Both
     * of those are false for a present null, and a present null is precisely
     * "this notice no longer expires" — the third case
     * UpdateAnnouncementRequest's `sometimes` + `nullable` pair exists to
     * carry, and the supply PublishAnnouncement's refusal turns on. Reading
     * it with either would leave `expiresAt` permanently absent from
     * $changes for the one edit that most needs it.
     *
     * Shared by update() and publish() rather than written twice: they
     * consume the same key out of two Form Requests that validate it the
     * same way, and two copies of this rename is how the two screens would
     * come to disagree about what an empty box means. title and body are
     * copied through under the same array_key_exists rule because
     * UpdateAnnouncementRequest marks every field `sometimes`, so an omitted
     * one must stay omitted; PublishAnnouncementRequest validates neither,
     * so neither key reaches this method from that route.
     *
     * @param  array<string, mixed>  $validated
     * @return array<string, mixed>
     */
    private static function changes(array $validated): array
    {
        $changes = [];

        foreach (['title', 'body'] as $key) {
            if (array_key_exists($key, $validated)) {
                $changes[$key] = $validated[$key];
            }
        }

        if (array_key_exists('expires_at', $validated)) {
            $changes['expiresAt'] = self::instant($validated['expires_at']);
        }

        return $changes;
    }

    /**
     * A validated date string to the CarbonImmutable the commands take,
     * NULL-PRESERVING.
     *
     * The ternary is the whole point of the method existing: CarbonImmutable
     * ::parse(null) answers the current instant rather than null, so a bare
     * parse() on a cleared expiry stores "expires now" and the notice lapses
     * as it is posted. Measured in this repository against a frozen clock —
     * the run is written out in PublishAnnouncementRequest's docblock.
     *
     * Not $request->date(): that reads the raw input bag and answers null
     * for an absent key as readily as for an empty one, which is the
     * distinction changes() above is built to keep.
     */
    private static function instant(mixed $value): ?CarbonImmutable
    {
        return $value === null ? null : CarbonImmutable::parse((string) $value);
    }
}
