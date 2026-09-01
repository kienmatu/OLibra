<?php

namespace App\Providers;

use App\Enums\MembershipRole;
use App\Enums\MembershipStatus;
use App\Models\Announcement;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Category;
use App\Models\Comment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\SystemSetting;
use App\Models\User;
use App\Policies\AnnouncementPolicy;
use App\Policies\BookCopyPolicy;
use App\Policies\BookDonationPolicy;
use App\Policies\BookPolicy;
use App\Policies\BookshelfPolicy;
use App\Policies\BorrowRequestPolicy;
use App\Policies\CategoryPolicy;
use App\Policies\CommentPolicy;
use App\Policies\LoanPolicy;
use App\Policies\MembershipPolicy;
use App\Policies\SystemSettingPolicy;
use App\Policies\UserPolicy;
use App\Support\DeadlockDetector;
use App\Support\HashedDatabaseSessionHandler;
use App\Support\Members\Phone;
use App\Support\QueryParam;
use App\Support\TenantContext;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Database\ConcurrencyErrorDetector;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // scoped(), not singleton(): a fresh context per request lifecycle, so a
        // long-running test process (or Octane, ever) cannot leak one request's
        // shelf into the next.
        $this->app->scoped(TenantContext::class);

        // Laravel's DetectsConcurrencyErrors trait — the thing
        // Connection::transaction consults to decide whether to re-run a
        // rolled-back callback — resolves this contract from the container
        // and falls back to the framework's own detector only when nothing
        // is bound. Binding here is therefore what makes the retry loop and
        // App\Support\ConcurrencyRetry's translation ask ONE question
        // rather than two, and it is what keeps a lock-wait timeout out of
        // BOTH: see DeadlockDetector's docblock for why 1205 must stay a
        // loud 500 while 1213 is retried.
        $this->app->bind(ConcurrencyErrorDetector::class, DeadlockDetector::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Laravel's database session store, keyed on sha256(session id)
        // instead of the raw id — see HashedDatabaseSessionHandler's
        // docstring for why the raw id must never reach the table.
        Session::extend('hashed-database', function (Application $app) {
            $config = $app->make('config');
            $db = $app->make('db');

            return new HashedDatabaseSessionHandler(
                $db->connection($config->get('session.connection')),
                $config->get('session.table', 'sessions'),
                $config->get('session.lifetime'),
                $app,
            );
        });

        // Open question 3 (plan header): OPS §8 records RegisterMembership
        // rate limiting as unaddressed in both source documents. This is
        // the infrastructure-level answer, at the edge of the route, not a
        // domain rule. Known-gaps records the decision, and both numbers,
        // as taken on the product owner's behalf.
        //
        // TWO keys on purpose. Per-IP ALONE is wrong here: BR §16.1's
        // scenario is a room of people on one parish connection, so a tight
        // per-IP minute budget throttles the legitimate event and stops no
        // script (addresses rotate; a parish's does not). The day budget is
        // keyed on a HASHED phone number, the shape OPS §8 already specifies
        // for the other guest-open write (SubmitFeedback: 3 per phone per
        // day, hashed, §5.4), falling back to the IP when the phone is blank
        // so the phone-missing-reason route is not an open bypass.
        //
        // Fix round, Task 13 — two defects closed here:
        //
        // 1. CRITICAL: this closure runs inside `throttle:register`
        // middleware, BEFORE RegisterMembershipRequest's own validation —
        // route middleware always runs ahead of a controller method's Form
        // Request resolution. `$request->string('phone')` used to read the
        // RAW merged input bag and cast it with Stringable, which throws
        // `ErrorException: Array to string conversion` the instant `phone`
        // arrives as an array (`phone[]=...`, `phone[a][b]=...`, or a bare
        // `phone[]`) — a guest 500 with a stack trace, on the application's
        // only unauthenticated write route, that no amount of tightening
        // RegisterMembershipRequest's rules could ever catch, because this
        // code runs first. QueryParam::input() (see its own docblock for
        // the fuller argument for growing this body-aware sibling rather
        // than a second, duplicate flattener) resolves the same "first
        // value of whatever arrived" shape a repeated query-string key
        // already gets via QueryParam::first(), so an array here degrades
        // to a scalar instead of throwing.
        //
        // 2. The day key hashed the RAW trimmed phone, so
        // `0912345678`/`0912 345 678`/`0912.345.678`/`0912-345-678`/
        // `+84912345678` — five spellings of the identical phone, every
        // one accepted by Phone::isValid() — each got its own 20/day
        // bucket. Phone::normalise() (extracted from, and still shared
        // with, Phone::isValid()'s own separator-stripping, plus the
        // +84-to-0 fold Vietnam's own numbering plan makes safe — see that
        // method's docblock) is what gets hashed now, so every spelling of
        // one phone shares one bucket.
        RateLimiter::for('register', fn (Request $request) => [
            Limit::perMinute(30)->by('ip:'.($request->ip() ?? 'unknown')),
            Limit::perDay(20)->by('reg:'.hash('sha256', (
                Phone::normalise(QueryParam::input($request, 'phone') ?? '') ?: 'ip:'.($request->ip() ?? 'unknown')
            ))),
        ]);

        // The global flag outranks every shelf role — ROLE_RANK.super_admin —
        // but ONLY for the role-hierarchy abilities this file defines
        // (act-as-reader/manager/admin), matched by name prefix, never
        // unconditionally across every ability a future Gate::define adds.
        // Returning null (not false) for anything else lets that ability's
        // own definition run for the super admin exactly as it would for
        // anyone. This is deliberately narrower than the shape this
        // comment originally described (a blanket Gate::before): an
        // unconditional bypass would have silently pre-approved a future
        // `Gate::define('decide-proposal', …)` for a super admin, the
        // opposite of BR §2's "nobody decides their own proposal, including
        // a super administrator" — that invariant must not depend on every
        // future ability remembering to check for it itself.
        Gate::before(function (User $user, string $ability) {
            if (! str_starts_with($ability, 'act-as-')) {
                return null;
            }

            return $user->is_super_admin ? true : null;
        });

        // Role gates read TenantContext and nothing else (Task 17's
        // interface contract). ResolveTenant (Task 16) is the only place
        // that resolves a membership INTO TenantContext via the request
        // pipeline, and it already excludes anything but an active,
        // non-soft-deleted row (see its docstring and the known-gaps entry
        // on withoutGlobalScopes()) — so on that path a membership reaching
        // here is active by construction. But TenantContext::set() is
        // public, and nothing besides a code-review convention stops a
        // future console command, seeder or Phase 1 controller from
        // populating it from a query that does NOT filter on status. The
        // status check below makes the gate fail closed on its own terms
        // instead of trusting a single upstream caller forever — belt and
        // braces on the same principle as the user_id check just under it.
        $roleGate = fn (MembershipRole $required) => function (User $user) use ($required): bool {
            $membership = app(TenantContext::class)->membership();

            // The membership row was resolved for THIS user by
            // ResolveTenant; the guard is belt and braces against a gate
            // checked for a different user object.
            if ($membership === null || $membership->user_id !== $user->id) {
                return false;
            }

            if ($membership->status !== MembershipStatus::Active) {
                return false;
            }

            // The same belt-and-braces reasoning as the status check just
            // above, for the same reason it exists: ResolveTenant's own
            // query already excludes a soft-deleted row (see its docstring
            // and the known-gaps entry on withoutGlobalScopes() stripping
            // SoftDeletingScope, which is the exact incident this line
            // guards against happening a second way), but nothing besides
            // that one caller's discipline stops a future binder handing
            // this gate a $membership fetched with withTrashed() or
            // withoutGlobalScopes() while status is untouched — a "removed"
            // membership whose status column was never flipped. Checked
            // here so the gate fails closed on its own terms instead of
            // trusting, forever, that every future caller of
            // TenantContext::set() remembers to filter deleted_at itself.
            if ($membership->trashed()) {
                return false;
            }

            return $membership->role->atLeast($required);
        };

        Gate::define('act-as-reader', $roleGate(MembershipRole::Reader));
        Gate::define('act-as-manager', $roleGate(MembershipRole::Manager));
        Gate::define('act-as-admin', $roleGate(MembershipRole::Admin));

        // Phase 1a: policies arrive with the Actions they gate. They
        // delegate to the act-as-* gates above — registered here, after
        // those definitions, so the file reads in dependency order.
        Gate::policy(Book::class, BookPolicy::class);
        Gate::policy(BookCopy::class, BookCopyPolicy::class);
        Gate::policy(Membership::class, MembershipPolicy::class);
        Gate::policy(Loan::class, LoanPolicy::class);

        // Phase 2a. Convention-based discovery (App\Models\X ->
        // App\Policies\XPolicy) does find this one today, so deleting this
        // line leaves the whole suite green (1071, measured). That is NOT
        // the same as the line being decorative, and the first version of
        // this comment said it was, which is an invitation to delete it:
        // move BorrowRequestPolicy to App\Policies\Circulation and
        // discovery finds nothing, at which point this line is the only
        // thing wiring the model (18 green with it, 5 red without —
        // measured both ways). Renaming the class is caught at once by
        // Larastan; moving it is caught by
        // tests/Feature/Architecture/PolicyRegistrationTest.php, which
        // derives its census from app/Policies and from the calls below
        // rather than transcribing either, and so covers all five of these
        // and policy number six on the day it lands.
        Gate::policy(BorrowRequest::class, BorrowRequestPolicy::class);

        // Phase 2b. Convention discovery finds this one too today, the
        // same as BorrowRequest above, but that line's own measurement
        // (moving the class, re-running the suite) has not been repeated
        // for this policy — the reasoning transfers, not the number.
        // PolicyRegistrationTest derives its census from app/Policies and
        // from this file's own source, so it covers CommentPolicy without
        // a test edit either way.
        Gate::policy(Comment::class, CommentPolicy::class);

        // Task 9's shelf news. Registered on the same terms as the line
        // above and with the same disclosure: convention discovery finds
        // App\Policies\AnnouncementPolicy for App\Models\Announcement
        // today, and the move-the-class measurement that made
        // BorrowRequest's line load-bearing has not been repeated here
        // either. PolicyRegistrationTest reads this file's own source, so
        // it covers this pair without a test edit.
        Gate::policy(Announcement::class, AnnouncementPolicy::class);

        // Slice C's donation offers, registered on the same terms as the
        // two lines above.
        //
        // MEASURED for this pair rather than carried down: with this line
        // replaced by a comment, PolicyRegistrationTest stays green at 2
        // passed / 41 assertions, so Laravel's convention discovery
        // (App\Models\X -> App\Policies\XPolicy) does resolve
        // BookDonationPolicy for BookDonation as things stand. The
        // move-the-class measurement that made BorrowRequest's line
        // load-bearing was NOT repeated here, so what makes this line
        // worth keeping is that file's argument, not a number of mine.
        // PolicyRegistrationTest reads this file's own source, so it
        // covers this pair without a test edit either way.
        Gate::policy(BookDonation::class, BookDonationPolicy::class);

        // Phase 3b-i, spec D9. Unlike the eight above, this policy answers
        // with Illuminate\Auth\Access\Response rather than bool, so a
        // refusal carries EnsureSuperAdmin's 404 instead of a policy's
        // usual 403 — see BookshelfPolicy's docblock. Registered on the
        // same terms as the lines above: convention discovery
        // (App\Models\Bookshelf -> App\Policies\BookshelfPolicy) also
        // resolves this pair today, and PolicyRegistrationTest reads this
        // file's own source, so it covers the pair either way.
        Gate::policy(Bookshelf::class, BookshelfPolicy::class);
        // Phase 3b-i Task 7, spec D5. One ability — the global grant, the
        // only act in the catalogue done TO a person rather than to a
        // membership, which is why it can live on neither MembershipPolicy
        // (whose every method reads a membership under a bound tenant) nor
        // BookshelfPolicy (this act names no shelf). Same 404-shaped
        // refusal as the line above it.
        Gate::policy(User::class, UserPolicy::class);
        // Phase 3b-ii Task 1, spec D1. The installation's own single row —
        // the administration's contact block and the defaults a new shelf
        // starts with. Its one ability names no shelf, which is also why
        // both of its writers audit globally. Same 404-shaped refusal as
        // the two lines above, and registered on the same terms:
        // convention discovery (App\Models\SystemSetting ->
        // App\Policies\SystemSettingPolicy) resolves this pair today too,
        // and PolicyRegistrationTest reads this file's own source, so it
        // covers the pair either way.
        Gate::policy(SystemSetting::class, SystemSettingPolicy::class);
        // Phase 3b-ii Task 3, spec D3. The book genres — global reference
        // data every tủ sách shares, so this pair names no shelf either,
        // and all three of its writers audit globally for that reason.
        // Registered on the same terms as the lines above: discovery
        // resolves the pair today, and PolicyRegistrationTest reads this
        // file's own source so the pair is covered either way.
        Gate::policy(Category::class, CategoryPolicy::class);
    }
}
