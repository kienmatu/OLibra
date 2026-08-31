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
 * The manager's side of the shelf bulletin: the list of everything the
 * shelf has ever posted, the compose and edit forms, and the decisions a
 * row carries. OPS §4.4's CreateAnnouncement, UpdateAnnouncement,
 * PublishAnnouncement, HideAnnouncement, PinAnnouncement and
 * UnpinAnnouncement, each behind one route.
 *
 * WHICH DOCUMENT AUTHORISES THIS SCREEN, written out rather than cited in
 * shorthand because the shorthand was wrong once and a shorthand is what
 * gets copied. An earlier draft of this docblock opened "BR §16.1's Bản
 * tin"; resources/js/pages/shelves/announcements/index.tsx carries a
 * correction of that same misattribution, made one commit earlier. All
 * four passages below were opened while this paragraph was written:
 *
 *   - BR §16.1 is titled "Public pages". Its one sentence about
 *     announcements is the shelf home's card — "The pinned announcement,
 *     or the most recent published one … shown as a single card, absent
 *     entirely when the shelf has published none." That is a reader's
 *     screen, and it is not this one.
 *   - BR §16.3 is titled "Manager pages" and enumerates the manager's
 *     screens from the dashboard to statistics. It does not use the word
 *     "announcement".
 *   - So BR specifies no bulletin editor. What it does give is the ENTITY,
 *     in §5.4's record list — "Announcement — bookshelf, title, slug, rich
 *     body, plain-text derivation for excerpts and search, pinned flag,
 *     publication time (absent means draft), expiry, author" — which is
 *     where every column the forms below write comes from; and the
 *     PERMISSION, "manage announcements", in §13.2's Community row, which
 *     is what the manage group's gate stands for.
 *   - The screen itself is OPS §4.4's, and that document says the gap
 *     aloud under PublishAnnouncement: "§16.3 does not itself describe an
 *     announcement-management screen; this command follows the built UI
 *     (src/app/.../quan-ly/thong-bao/page.tsx), whose buttons read 'Đăng
 *     ngay' and 'Đăng lại'." Those two button words are this class's
 *     publish route, and that sentence is its authority.
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
 * A THIRD SPELLING IS WRONG FOR A DIFFERENT REASON, and it shipped in this
 * class's first commit: a date-only `expires_at` parsed bare becomes the
 * FIRST microsecond of the day the manager typed, so the notice lapses at
 * 07:00 that morning in Asia/Ho_Chi_Minh rather than at the end of that
 * day. AGENTS.md's date rule is explicit — "A loan is due at the end of a
 * day, not at 14:23 on that day" — and expiry(), below, is where this class
 * honours it, with the measurement written out there.
 *
 * NOTHING ABOUT WHAT A NOTICE IS IS DECIDED HERE. The three chips come from
 * AnnouncementsQuery::managed(), which labels each row through the one
 * helper Task 12 built for exactly this, and re-deriving `showing` from
 * publishedAt and expiresAt on this class or on the page would be the third
 * clock that query's docblock warns about. What this class owns is nine
 * route names, two page components, six flashes, the rename, and the day a
 * date-only expiry means.
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
    /** `yyyy-mm-dd` and nothing after it — see expiry(). */
    private const DATE_ONLY = '/^\d{4}-\d{2}-\d{2}$/';

    /** The parish's civil timezone, the one App\Support\Clock::today() reads a day in. */
    private const PARISH_TIMEZONE = 'Asia/Ho_Chi_Minh';

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
            // `??` here and nowhere else in this method: is_pinned is a
            // bool with no third case — absent, present-null and
            // present-false are one instruction, "not pinned" — so there is
            // nothing for a presence test to keep apart. The two arguments
            // below are a different question and get a different spelling.
            pinned: (bool) ($validated['is_pinned'] ?? false),
            // ARRAY_KEY_EXISTS, matching changes() below, and the reason is
            // the spelling rather than the behaviour: CreateAnnouncement
            // takes ?CarbonImmutable for both, so an absent key and a
            // present null are the same instruction here and `??` would
            // pass the same value. changes()'s docblock nonetheless bans
            // `isset()` and its `??` twin for exactly these two keys three
            // methods down, and a call site in this same file asking the
            // same question the banned way is how a ban stops being read as
            // one. One spelling of "was this key supplied", everywhere in
            // this class.
            //
            // published_at is mapped even though the compose form sends no
            // such box: StoreAnnouncementRequest validates the key, so the
            // day a form grows one it reaches the command without an edit
            // here. What the shipped form does send is nothing, which is
            // why a new notice is a draft — see the flash sentence.
            publishedAt: array_key_exists('published_at', $validated)
                ? self::instant($validated['published_at'])
                : null,
            expiresAt: array_key_exists('expires_at', $validated)
                ? self::expiry($validated['expires_at'])
                : null,
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
     *
     * THAT ALWAYS-PRESENT KEY IS WHY THE PAGE WITHHOLDS THIS FORM FROM A
     * SHOWING ROW, and the first draft of this screen did not, which made
     * *Đăng lại* on a live notice move its published_at AND wipe its expiry,
     * under a success flash. The key being present is read as a supply, the
     * guard therefore never fires, and an empty box is a cleared column —
     * every step correct on its own. resources/js/pages/manage/
     * announcements/index.tsx now renders the disclosure only for a draft or
     * a lapsed row, matching the reference. The route still accepts the
     * post, so the refusal is pinned by a block rather than left to the
     * markup: ManagerAnnouncementsScreenTest's "POST publish to a showing
     * row with no expiry key at all is refused".
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
            $changes['expiresAt'] = self::expiry($validated['expires_at']);
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

    /**
     * The expiry cast: instant(), plus AGENTS.md's date rule.
     *
     * AGENTS.md: "Dates read as dates … A loan is due at the END of a day,
     * not at 14:23 on that day." An expiry is the same kind of thing. Both
     * expiry boxes this screen ships are `<input type="date">`, whose wire
     * value is the HTML spec's `yyyy-mm-dd` and carries no time at all, so
     * a date-only value is what arrives here from every submission the
     * screen makes — and instant() alone would read the manager's chosen
     * day as its first microsecond.
     *
     * MEASURED, both spellings, for a manager who types 30/09. The times
     * are Asia/Ho_Chi_Minh, which is the clock that manager is reading; the
     * verdicts are AnnouncementsQuery::state()'s, reproduced against its
     * `expires_at > $at` comparison over the value the column actually
     * keeps:
     *
     *   stored by a bare parse      2026-09-30 00:00:00 UTC
     *     07:30 on 30/09 -> expired · 23:00 on 30/09 -> expired
     *     00:30 on 01/10 -> expired
     *
     *   stored by this method       2026-09-30 16:59:59 UTC
     *     07:30 on 30/09 -> showing · 23:00 on 30/09 -> showing
     *     00:30 on 01/10 -> expired
     *
     * The two rows that separate them are pinned end to end over HTTP, in
     * tests/Feature/Community/ManagerAnnouncementsScreenTest.php: 'POST Đăng
     * lại with a date puts that date in the column' asserts the stored
     * instant, and 'a notice set to expire 30/09 is still showing at 23:00
     * on 30/09 in the parish' plus 'the same notice has lapsed by 00:30 on
     * 01/10 in the parish' walk the frozen clock across it and read the chip
     * off the index. With the branch below deleted, the first two of those
     * three are the file's only failures.
     *
     * So under the bare parse the notice was gone for the whole of the day
     * the manager named — from 07:00 that morning — while
     * resources/js/pages/manage/announcements/index.tsx rendered "Hết hạn
     * ngày 30/09" on the same row whose chip already read Hết hạn. One row,
     * two sentences, disagreeing.
     *
     * THE ZONE IS THE PARISH'S, FOR Clock::today()'s REASON, read off
     * App\Support\Clock: "today" for a shelf is the parish's day, not the
     * server's UTC day, and a date a manager types into a box on a screen
     * in Đồng Tháp is a day on that same calendar. The zone is named here
     * rather than taken from the clock because this is a parse of a
     * submitted string, not a read of the current instant — Clock is the
     * door for the latter and nothing in this class opens it.
     *
     * ONE SECOND AT THE END OF THE NAMED DAY IS LOST, recorded rather than
     * hidden. endOfDay() is 23:59:59.999999, and the value that reaches the
     * column is 23:59:59 — Announcement declares no getDateFormat()
     * override (read off App\Models\Announcement), so Eloquent's default
     * 'Y-m-d H:i:s' formats the binding and the fraction goes. state()'s
     * live condition is `expires_at > $at`, so between 23:59:59 and
     * midnight the notice reads expired. The alternative — storing the
     * FIRST instant of 01/10, which is what old_next's expiryDate() does in
     * UTC by adding 24 hours to midnight — is exact at that boundary but
     * moves the stored instant onto 01/10, which both the list and the form
     * would then each have to take a day back off to show the manager what
     * they typed (old_next's own dateInputValue does exactly that, and says
     * so). A second against two derivations is the trade this method makes.
     *
     * A VALUE CARRYING A TIME IS PARSED AS GIVEN. `date` in the three Form
     * Requests accepts more than `yyyy-mm-dd`, and a submission that named
     * an hour meant that hour; only the shape that named no time gets a
     * time chosen for it.
     */
    private static function expiry(mixed $value): ?CarbonImmutable
    {
        if ($value !== null && preg_match(self::DATE_ONLY, (string) $value) === 1) {
            return CarbonImmutable::parse((string) $value, self::PARISH_TIMEZONE)
                ->endOfDay()
                ->setTimezone('UTC');
        }

        return self::instant($value);
    }
}
