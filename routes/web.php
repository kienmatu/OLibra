<?php

use App\Http\Controllers\Admin\AuditController as AdminAuditController;
use App\Http\Controllers\Admin\CategoryController as AdminCategoryController;
use App\Http\Controllers\Admin\DashboardController as AdminDashboardController;
use App\Http\Controllers\Admin\FeedbackController as AdminFeedbackController;
use App\Http\Controllers\Admin\ManagerController as AdminManagerController;
use App\Http\Controllers\Admin\ProfileChangeController as AdminProfileChangeController;
use App\Http\Controllers\Admin\SettingsController as AdminSettingsController;
use App\Http\Controllers\Admin\ShelfController as AdminShelfController;
use App\Http\Controllers\ContactController;
use App\Http\Controllers\Manage\AnnouncementController as ManageAnnouncementController;
use App\Http\Controllers\Manage\AuditLogController;
use App\Http\Controllers\Manage\BookController;
use App\Http\Controllers\Manage\BorrowRequestController as ManageBorrowRequestController;
use App\Http\Controllers\Manage\CommentModerationController;
use App\Http\Controllers\Manage\CopyController;
use App\Http\Controllers\Manage\DashboardController;
use App\Http\Controllers\Manage\DonationController as ManageDonationController;
use App\Http\Controllers\Manage\ExportController;
use App\Http\Controllers\Manage\LabelController;
use App\Http\Controllers\Manage\LendController;
use App\Http\Controllers\Manage\LoanController;
use App\Http\Controllers\Manage\LostCopiesController;
use App\Http\Controllers\Manage\OverdueController;
use App\Http\Controllers\Manage\ProfileChangeController as ManageProfileChangeController;
use App\Http\Controllers\Manage\ReaderController;
use App\Http\Controllers\Manage\ReaderLifecycleController;
use App\Http\Controllers\Manage\RegistrationQueueController;
use App\Http\Controllers\Manage\ReturnController;
use App\Http\Controllers\Manage\SettingsController as ManageSettingsController;
use App\Http\Controllers\Manage\StatisticsController;
use App\Http\Controllers\Manage\UnitController;
use App\Http\Controllers\Reader\AnnouncementController;
use App\Http\Controllers\Reader\BookController as ReaderBookController;
use App\Http\Controllers\Reader\BorrowRequestController as ReaderBorrowRequestController;
use App\Http\Controllers\Reader\CatalogueController;
use App\Http\Controllers\Reader\CommentController;
use App\Http\Controllers\Reader\DonationController;
use App\Http\Controllers\Reader\FeedbackController;
use App\Http\Controllers\Reader\MyLoansController;
use App\Http\Controllers\Reader\NotificationController;
use App\Http\Controllers\Reader\ProfileController;
use App\Http\Controllers\Reader\ScanController;
use App\Http\Controllers\Reader\SearchController;
use App\Http\Controllers\RegistrationController;
use App\Http\Controllers\ShellController;
use Illuminate\Support\Facades\Route;

// ── Public ────────────────────────────────────────────────────────────────
Route::get('/', [ShellController::class, 'home'])->name('home');
Route::get('/register', [RegistrationController::class, 'create'])->name('register');
Route::post('/register', [RegistrationController::class, 'store'])
    ->middleware('throttle:register')->name('register.store');
// Phase 3b-ii Task 2 (spec D2), and phase 3c-ii Task 3's POST beside it.
// BOTH VERBS sit deliberately outside every group on this file: no `auth`,
// no `role:`, and above all no `tenant`. The visitor these two lines are
// for is a parish with no bookshelf at all, so binding a tenant is not
// merely unnecessary, there is nothing to bind. ContactController's
// docblock carries what that costs the controller.
//
// RETRACTED, phase 3c-ii Task 3, by the phase this line was waiting for.
// What stood here was:
//
//   > There is NO POST here and must not be one until 3c: BR §16.1's
//   > feedback form lands with the inbox that reads it, and adding a write
//   > path to a route with no throttle and no reader is how a page that
//   > helps a stranger becomes a page that silently swallows their message.
//
// It is retracted rather than deleted because it was right, and because the
// POST below is only defensible once its two conditions are met. They are:
// `/admin/feedback` is this phase's Task 4, so the message has a reader;
// and the limit is spec D2's domain rule inside
// App\Actions\Community\SubmitFeedback — three messages per phone number
// over a ROLLING 24 hours, counted off the injected clock — chosen there
// over route middleware deliberately, because a `throttle:` refusal is a
// bare 429 where this one is a Vietnamese sentence the sender can read.
//
// NO `throttle:` MIDDLEWARE, then, and that is stated rather than left to
// be noticed: this route is no weaker than `shelves.feedback.store`, the
// guest-reachable shelf form the previous task shipped under exactly the
// same domain rule and no route limiter either. What is NOT bought by
// either is a per-IP ceiling — the key is the phone number, so a sender
// churning valid numbers is bounded by Phone::assert() and nothing else.
//
// The POST is the one call site in the whole application that tells
// SubmitFeedback its message belongs to NO shelf, which is the only reason
// that command takes a $siteWide flag at all.
Route::get('/contact', [ContactController::class, 'show'])->name('contact');
Route::post('/contact', [ContactController::class, 'store'])->name('contact.feedback');
Route::get('/shelves', [ShellController::class, 'shelves'])->name('shelves.index');

// ── One shelf ─────────────────────────────────────────────────────────────
// scopeBindings(): every child binding ({book}, later {reader}) resolves
// THROUGH the bound shelf's relationship (Bookshelf::books()), so — in
// principle — a foreign shelf's colliding slug would be a 404 from the
// binding itself, not a cross-tenant hit.
//
// CORRECTED (whole-branch review, PR #60): that is not, today, why the 404
// happens, and RouteIsolationTest does not prove this line does anything.
// Book and BookCopy carry BookshelfScope (app/Models/Scopes/
// BookshelfScope.php) independently of routing, applied by Eloquent on
// EVERY query including the one SubstituteBindings would run without
// scopeBindings() — so the tenant middleware having already bound
// TenantContext to THIS request's {shelf} is what filters out shelf B's
// rows, whether or not the child binding is routed through the parent
// relationship. Deleting this line leaves the full suite green (verified
// directly: removed it, ran the suite, 458/458 passed, restored it). This
// second layer is real and worth keeping as defence in depth — a rename
// that breaks the relationship guess now throws RelationNotFoundException
// loudly instead of silently falling back to an unscoped query, see the
// {bookCopy} comment below — but it is currently unpinned by any test that
// can tell the two layers apart, because BookshelfScope alone already
// produces every 404 this line is credited with.
Route::prefix('shelves/{shelf}')->name('shelves.')->middleware('tenant')->scopeBindings()->group(function () {
    // PR #57 review follow-up: BR §1.2 — "Everything about a shelf's books,
    // readers and announcements sits behind a membership of that shelf" —
    // and §13.1's `reader` role exist precisely to gate this group, but
    // nothing here applied them. In the Next.js original, every one of
    // these six pages (plus the shelf home) called `requireReader(ctx)`
    // (`src/lib/shelf.ts:201`) before reading anything: a guest is
    // redirected to sign in, a signed-in non-member gets a 404
    // (EnsureShelfRole's own behaviour, mirrored here). Nothing leaks today
    // because every one of these routes renders `under-construction`, but
    // the gate has to exist before the first real reader screen does, or
    // that screen ships open by default.
    //
    // `feedback` is deliberately excluded and stays outside this group:
    // `src/app/tu-sach/[shelf]/(doc-gia)/gop-y` is the one page under the
    // original's reader route group that reads the shelf with no
    // `requireReader` at all (`readShelf`, not `readShelfIdentity`), because
    // `submitFeedback`'s own docstring is explicit that it takes neither
    // `requireReader` nor `requireIdentifiedActor` — a guest may leave
    // feedback for a shelf they are not a member of. It is the only such
    // exemption under that route group; every other reader page there
    // (danh-muc, tim-kiem, sach/[slug], thong-bao, tang-sach, quet-ma, and
    // the shelf page itself) calls `requireReader` directly or through a
    // query that does.
    Route::middleware(['auth', 'role:reader'])->group(function () {
        Route::get('/', [ShellController::class, 'shelfHome'])->name('show');
        Route::get('/catalogue', [CatalogueController::class, 'index'])->name('catalogue');
        Route::get('/search', [SearchController::class, 'index'])->name('search');
        Route::get('/books/{book}', [ReaderBookController::class, 'show'])->name('books.show');
        // BR §16.1's "Xin mượn". The 404 a non-member gets here is
        // EnsureShelfRole's (this group's role:reader), not a Form
        // Request's — this POST has no fields and therefore no Form
        // Request to hold an abort_unless(..., 404), so the middleware is
        // the whole of it. CirculationArchitectureTest pins that the
        // middleware is still on the route.
        Route::post('/books/{book}/request', [ReaderBorrowRequestController::class, 'store'])->name('books.request');
        // OPS §4.4's CreateComment. RETRACTED: an earlier draft cited BR
        // §7.5's "viết bình luận" — §7.5 is Membership (Comment is §7.6),
        // and "bình luận" appears nowhere in BR; it is the UI's word.
        // Unlike the request POST above, this
        // one DOES carry a field, so StoreCommentRequest holds an
        // abort_unless(Gate::allows('act-as-reader'), 404) of its own and
        // the 404 a non-member meets has TWO producers, not one — the
        // group's role:reader first, that Form Request behind it. Both
        // halves were measured rather than assumed: moving this POST out
        // of the role:reader group leaves CreateCommentTest fully green —
        // the non-member still meets 404, from the Form Request — and
        // removing BOTH doors turns that same block red with 403, which
        // is CreateComment's own Gate::authorize rendered as an
        // AuthorizationException and the existence oracle spec §5.4
        // forbids. So EITHER door alone is sufficient here, unlike the
        // bodiless request POST above where the middleware is the whole
        // of it.
        Route::post('/books/{book}/comments', [CommentController::class, 'store'])->name('books.comments.store');
        // The reader's Bản tin — OPS §3.2's GetAnnouncementsList and
        // GetAnnouncementDetail. RETRACTED: an earlier draft said "BR
        // §16.1's Bản tin"; BR describes no such page, only the shelf-home
        // card at §16.1 line 510. The list keeps the placeholder's route NAME,
        // and what that continuity buys is the shelf home's nav link:
        // `git grep -n shelves.announcements c913b78 -- resources/`, run
        // before this line was written, returned two hits — the Ziggy call
        // in resources/js/pages/shelves/show.tsx, and a mention of the name
        // inside a comment in resources/js/lib/copy.ts.
        //
        // {slug} IS A STRING, NOT A MODEL BINDING — decided at plan review
        // and kept deliberately, so a later reader does not "fix" it to
        // {announcement:slug}. A binding would resolve a row the controller
        // never reads and then re-query by slug, and its 404 (any live row
        // on this shelf) asks a different question from
        // AnnouncementsQuery::detail()'s (published, and not yet lapsed):
        // the row deciding the status would not be the row deciding the
        // content. MEASURED, with this route changed to
        // {announcement:slug} and the controller rewritten to render the
        // bound row: ReaderAnnouncementsTest's draft block and its lapsed
        // block both answer 200 where they want 404. The measurement is
        // written out in AnnouncementController::show, along with the
        // third failure that run produced.
        //
        // {slug} names no model for the router to resolve, so the shelf
        // confinement on this line is one layer rather than this file's
        // usual two, and that layer is the global scope
        // BelongsToBookshelf installs on Announcement (read off the trait,
        // whose boot method calls addGlobalScope(new BookshelfScope)).
        // MEASURED rather than argued, which is what this file's earlier
        // scopeBindings note asks of a tenancy claim: with that
        // addGlobalScope call commented out,
        // ReaderAnnouncementsTest's cross-shelf block is the filtered
        // run's single failure — shelf B's notice rendered 200 under shelf
        // A's address. role:reader is untouched by any of this: it is the
        // group's, and RouteOrderTest requires it on both lines below.
        //
        // Static before bound (spec §6's house habit), even though one
        // segment and two cannot collide.
        Route::get('/announcements', [AnnouncementController::class, 'index'])->name('announcements');
        Route::get('/announcements/{slug}', [AnnouncementController::class, 'show'])->name('announcements.show');
        // BR §16.1's Tặng sách, the offer form. Task 18 turned the
        // placeholder GET into a real page and kept the route NAME, which
        // is the continuity the POST below already depended on.
        Route::get('/donate', [DonationController::class, 'create'])->name('donate');
        // The POST lands beside it because Task 15 owed the over-HTTP pin
        // for a memberless super admin, which needs an address.
        //
        // The 404 a non-member meets here has TWO producers, the shape
        // the comments POST above records: this group's role:reader
        // (EnsureShelfRole abort(404)s on act-as-reader) and
        // OfferDonationRequest::authorize's own abort_unless on the same
        // ability. MEASURED three ways in this task, on the "a signed-in
        // non-member gets 404 on the donate POST" block: with this line
        // moved out of the role:reader group the whole file stays green
        // at 10 passed (the Form Request answers), with the abort_unless
        // deleted instead it also stays green at 10 (the middleware
        // answers), and with BOTH doors removed that block turns red —
        // "Expected response status code [404] but received 403", which
        // is OfferDonation's own Gate::authorize rendered as an
        // AuthorizationException and the existence oracle spec §5.4
        // forbids. So either door alone is sufficient, and the third run
        // is what shows the pair is doing the work at all.
        //
        // A THIRD status is what an ABSENT route answers on this URI, and
        // it is not 404: the GET above already claims `donate`, so the
        // router raises 405 for an unrouted POST to it. Measured at RED,
        // before this line existed — the non-member block reported
        // "Expected response status code [404] but received 405". That
        // makes this file's usual worry (a 404 block passing against a
        // deleted route) not apply to this particular pair of lines.
        Route::post('/donate', [DonationController::class, 'store'])->name('donate.store');
        // OPS §3.3: CopyByIdQuery is "deliberately not manager-only" — a
        // reader scans a book on the shelf to ask for it, and tenancy
        // (BookshelfScope, applied inside the query), not role, is what
        // makes another parish's sticker unresolvable. Task 12.
        Route::get('/scan', [ScanController::class, 'resolve'])->name('scan');
    });

    // BR §16.1's Góp ý, phase 3c-ii Task 2 — the last placeholder in the
    // reader area. The route NAME is the placeholder's, kept: `grep -rn
    // "shelves.feedback" resources/` at 213f5bb, run before these two lines
    // were written, returned one hit — a mention of the name inside a
    // comment in resources/js/lib/copy.ts explaining why the shelf home did
    // NOT yet link here. That comment is amended in this commit and the
    // link added, which is what the continuity buys.
    //
    // BOTH LINES STAY OUTSIDE THE role:reader GROUP ABOVE, deliberately,
    // and the block comment on that group carries the reason: this is the
    // one page under the original's reader route group with no
    // `requireReader` at all, because a guest may leave feedback for a
    // shelf they are not a member of. What guards the destination instead
    // is that nothing in the body can choose it — `tenant` binds {shelf}
    // and SubmitFeedback reads the shelf off TenantContext, so a message
    // filed here belongs to the shelf whose address was typed.
    //
    // THE EXEMPTION IS NOT A PIN, said here because the shape invites the
    // opposite reading: RouteOrderTest:117's `$excludedSegments =
    // ['manage', 'feedback']` REMOVES these two routes from the
    // reader-area role-gate sweep, so THAT file cannot notice a
    // `role:reader` added here. MEASURED rather than argued, by wrapping
    // both lines in `Route::middleware(['auth', 'role:reader'])` and
    // running the whole suite: 8 failed, 1930 passed, and RouteOrderTest
    // is green in that run. The eight are the guest blocks in
    // tests/Feature/Community/ReaderFeedbackScreenTest.php (five, this
    // task's), SubmitFeedbackTest's rate-limit block (which posts here as
    // a guest), ShellTest's "serves feedback to a guest" and
    // MyNotificationsTest's "a signed-in NON-member gets no bell at all,
    // on the one shelf page they can reach" — that last one being
    // HandleInertiaRequests:83-86's third clause, which exists BECAUSE
    // this route is the page a non-member reaches. So the door is
    // guarded, just not by the file whose name suggests it.
    Route::get('/feedback', [FeedbackController::class, 'create'])->name('feedback');
    Route::post('/feedback', [FeedbackController::class, 'store'])->name('feedback.store');

    // Coordinator correction to this follow-up: `(doc-gia)/layout.tsx`
    // itself does not gate (it only resolves the address for the footer,
    // via `readShelfAddressForFooter`, which swallows the refusal), but
    // every profile *page* underneath it does, per-page: `ho-so/page.tsx`
    // -> `getMyProfile` -> `requireSelfOrManager`
    // (`src/domain/members/policy.ts:214-223`); `ho-so/lich-su` and
    // `ho-so/tong-quan` -> `requireReader` (`get-my-dashboard.ts:200,71`);
    // `ho-so/thong-bao` -> `requireReader` (`get-my-notifications.ts:54`);
    // `ho-so/tang-sach` -> `requireReader` (`get-my-donations.ts:40`).
    // `loadPage` turns every one of those refusals into `notFound()`
    // (`src/lib/reader-area.ts:29-40` says so explicitly), so the original
    // 404s a signed-in non-member on all five profile pages — plain
    // `auth` here under-gated them. `role:reader` is the right gate, not
    // an over-gate: `Gate::before`'s `act-as-*` grant reproduces the
    // original's memberless-super-admin allowance for free, the same way
    // it does for the reader group above.
    Route::prefix('profile')->name('profile.')->middleware(['auth', 'role:reader'])->group(function () {
        // Phase 3c-i Task 1: the last placeholder in this group. BR §16.2's
        // "View personal details" — the reader's own record, GetMyProfile
        // (OPS:67) and GetMyProfileChangeRequest (OPS:68) behind it.
        // Proposing a change to it is Task 2's and posts elsewhere; this
        // one only reads.
        Route::get('/', [ProfileController::class, 'show'])->name('show');
        // Phase 3c-i Task 2: BR:83's request-not-an-edit. It names no
        // membership — the caller's own row comes off the bound tenant, so
        // there is nothing in this URL for a reader to edit into somebody
        // else's. Declared beside its GET rather than in the manager area
        // because this is the reader's own screen; a manager proposing on
        // another's behalf reaches the same Action from theirs.
        Route::post('/change-request', [ProfileController::class, 'propose'])->name('change-request');
        // Phase 3c-i Task 8, spec D6 — the photograph, and the first upload
        // path this port has ever had. A SEPARATE route from the text
        // proposal above rather than a field on it: the two carry different
        // encodings (multipart against a form post), different refusals
        // (`file_too_large`, `heic_not_supported`, `invalid_image`, none of
        // which the text form can raise) and different controls on the
        // screen. They still reach the SAME pending row — spec D6 makes the
        // avatar this lifecycle's file-carrying case, not a second one.
        //
        // Declared BEFORE the bound `change-request/{profileChange}/cancel`
        // line below, the house's static-before-bound habit; these two
        // cannot collide in any case, being under different first segments.
        Route::post('/avatar', [ProfileController::class, 'proposeAvatar'])->name('avatar');
        // Phase 3c-i Task 7: spec D4's self-exemption, and the ONLY caller
        // App\Actions\Admin\CancelProfileChange has. Task 4 shipped that
        // Action with tests and no route — neither decision queue wires it,
        // because BR:580/602 list only Duyệt and Từ chối on those cards —
        // so the capability was unreachable until this line. Static before
        // bound is not at issue: this is two segments past /profile and the
        // POST above is one.
        //
        // {profileChange} resolves through Bookshelf::profileChanges()
        // under the outer group's scopeBindings() AND through BookshelfScope
        // on the model, the same double layer the manager queue's own
        // decide routes describe. Neither layer scopes by person — that is
        // the Action's `not_own_request`, one layer down, exactly as the
        // notification routes below document for their own binding.
        Route::post('/change-request/{profileChange}/cancel', [ProfileController::class, 'cancel'])->name('change-request.cancel');
        // Phase 3c-i Task 7, spec D12. BR §16.2's one remaining
        // immediate-effect control: a password change is not a fact a
        // manager verified, so it is not a proposal and nothing here waits.
        Route::post('/password', [ProfileController::class, 'changePassword'])->name('password');
        Route::get('/history', [MyLoansController::class, 'history'])->name('history');
        // The bell. read-all is declared BEFORE the bound route — the
        // house habit (spec §6's static-before-bound discipline), even
        // though these two cannot collide: read-all is one segment after
        // /notifications and the other is two.
        Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications');
        Route::post('/notifications/read-all', [NotificationController::class, 'readAll'])->name('notifications.read-all');
        // {notification} resolves through Bookshelf::notifications() under
        // scopeBindings(), and through BookshelfScope on the model
        // independently — this file's own documented double layer. Neither
        // layer scopes by PERSON: a notification belonging to another
        // reader OF THIS SHELF binds fine and is refused one layer down,
        // by MarkNotificationRead's user_id key, as a silent no-op.
        Route::post('/notifications/{notification}/read', [NotificationController::class, 'read'])->name('notifications.read');
        // The other half of BR §16.1's Tặng sách: what happened to each
        // offer. Same controller as the form in the reader group above,
        // and the route NAME is the placeholder's, kept.
        Route::get('/donations', [DonationController::class, 'mine'])->name('donations');
        Route::get('/overview', [MyLoansController::class, 'overview'])->name('overview');
        Route::post('/loans/{loan}/renew', [MyLoansController::class, 'renew'])->name('loans.renew');
        // One route, two doors. The reference defines exactly one
        // cancelRequestAction, and it lives in the PROFILE area
        // (ho-so/reader-actions.ts:148) while being posted from both
        // ho-so/tong-quan (:255) and the book page (sach/[slug]:570) —
        // grepped, all three call sites. So the withdrawal sits here with
        // the reader's other own-row actions, and the book page names
        // this route rather than growing a second.
        // {borrowRequest} resolves through
        // Bookshelf::borrowRequests() under scopeBindings(), and through
        // BookshelfScope on the model independently — this file's own
        // documented double layer, either half sufficient (measured; see
        // that relation's docblock).
        Route::post('/requests/{borrowRequest}/cancel', [ReaderBorrowRequestController::class, 'cancel'])->name('requests.cancel');
    });

    // ── The manager area: role:manager = act-as-manager or 404 ──────────
    // 'auth' is explicit here (not implied by 'role:manager') so that
    // bootstrap/app.php's priority ordering — Authenticate ahead of
    // ResolveTenant — actually applies to this route: without 'auth' on
    // the route itself, a guest hitting /manage/* on an UNKNOWN slug would
    // 404 straight out of ResolveTenant instead of redirecting to login,
    // while a guest on a KNOWN slug still redirects (EnsureShelfRole's own
    // guest branch) — an unauthenticated existence oracle over the shelf
    // URL space. tests/Feature/Authz/EnsureShelfRoleTest.php is the
    // canonical ['auth', 'tenant', 'role:*'] shape this copies.
    Route::prefix('manage')->name('manage.')->middleware(['auth', 'role:manager'])->group(function () {
        Route::get('/', [DashboardController::class, 'index'])->name('dashboard');

        Route::get('/lend', [LendController::class, 'index'])->name('lend');
        Route::get('/lend/reader', [LendController::class, 'reader'])->name('lend.reader');
        // BR §16.3's escape hatch (plan settled decision 3): 1b built
        // ManagerRegisterReader and deferred exactly this screen to 1c.
        // Static segment, no binding — declaration order against
        // /lend/reader is irrelevant, but keep it adjacent so the flow
        // reads in the order a volunteer walks it.
        Route::get('/lend/reader/new', [LendController::class, 'newReader'])->name('lend.reader.create');
        Route::post('/lend/reader', [LendController::class, 'storeReader'])->name('lend.reader.store');
        Route::get('/lend/confirm', [LendController::class, 'confirm'])->name('lend.confirm');
        Route::post('/lend', [LendController::class, 'store'])->name('lend.store');
        Route::get('/returns', [ReturnController::class, 'index'])->name('returns');
        Route::get('/returns/lost', [ReturnController::class, 'lost'])->name('returns.lost');
        Route::post('/returns/{loan}', [ReturnController::class, 'store'])->name('returns.store');

        // ORDER IS LOAD-BEARING (spec §6): create BEFORE {reader}, or
        // Laravel binds "create" as a membership id. RouteOrderTest pins it.
        Route::get('/readers', [ReaderController::class, 'index'])->name('readers.index');
        Route::get('/readers/create', [ReaderController::class, 'create'])->name('readers.create');
        Route::post('/readers', [ReaderController::class, 'store'])->name('readers.store');
        Route::get('/readers/{reader}', [ReaderController::class, 'show'])->name('readers.show');
        Route::patch('/readers/{reader}/profile', [ReaderController::class, 'updateProfile'])->name('readers.profile.update');
        Route::post('/readers/{reader}/credentials', [ReaderLifecycleController::class, 'setCredentials'])->name('readers.credentials');
        Route::post('/readers/{reader}/suspend', [ReaderLifecycleController::class, 'suspend'])->name('readers.suspend');
        Route::post('/readers/{reader}/reactivate', [ReaderLifecycleController::class, 'reactivate'])->name('readers.reactivate');
        Route::post('/readers/{reader}/mark-left', [ReaderLifecycleController::class, 'markLeft'])->name('readers.mark-left');

        // ORDER IS LOAD-BEARING (spec §6): create and lost BEFORE {book},
        // or Laravel binds "lost" as a slug. RouteOrderTest pins this.
        Route::get('/books', [BookController::class, 'index'])->name('books.index');
        Route::get('/books/create', [BookController::class, 'create'])->name('books.create');
        Route::post('/books', [BookController::class, 'store'])->name('books.store');
        Route::get('/books/lost', [LostCopiesController::class, 'index'])->name('books.lost');
        Route::get('/books/{book}', [BookController::class, 'show'])->name('books.show');
        Route::get('/books/{book}/edit', [BookController::class, 'edit'])->name('books.edit');
        Route::patch('/books/{book}', [BookController::class, 'update'])->name('books.update');
        Route::post('/books/{book}/copies', [CopyController::class, 'store'])->name('books.copies.store');

        // {bookCopy}, not {copy}: the parameter name is load-bearing for
        // routing — under scopeBindings() Laravel guesses the relation to
        // resolve the child binding through from the parameter name itself
        // (bookCopy -> Bookshelf::bookCopies()), so a rename here is not a
        // silent cross-shelf leak, it is Illuminate\Database\Eloquent\
        // RelationNotFoundException / "Call to undefined method
        // App\Models\Bookshelf::copies()" — loud, at request time. The
        // tenancy guarantee itself sits one layer down and does not depend
        // on this name at all: Book and BookCopy each carry BookshelfScope
        // independently via BelongsToBookshelf (app/Models/Concerns/
        // BelongsToBookshelf.php), so a foreign shelf's copy id 404s on the
        // model's own global scope even if this route parameter resolved
        // some other way.
        Route::post('/copies/{bookCopy}/assess', [CopyController::class, 'assess'])->name('copies.assess');
        Route::post('/copies/{bookCopy}/retire', [CopyController::class, 'retire'])->name('copies.retire');
        Route::post('/copies/{bookCopy}/report-lost', [CopyController::class, 'reportLost'])->name('copies.report-lost');
        Route::post('/copies/{bookCopy}/mark-found', [CopyController::class, 'markFound'])->name('copies.mark-found');

        // The queue and the decisions a manager makes on it — four
        // POSTs since Task 18's release. The GET keeps the
        // placeholder's route NAME — nothing linked to it at HEAD
        // (grepped resources/ at 48e9c0d: no hits), so the continuity
        // this buys is for the nav item and the dashboard card added in
        // the same commit, and for whatever Ziggy-named link comes next.
        Route::get('/borrow-requests', [ManageBorrowRequestController::class, 'index'])->name('borrow-requests');
        Route::post('/borrow-requests/{borrowRequest}/approve', [ManageBorrowRequestController::class, 'approve'])->name('borrow-requests.approve');
        Route::post('/borrow-requests/{borrowRequest}/reject', [ManageBorrowRequestController::class, 'reject'])->name('borrow-requests.reject');
        Route::post('/borrow-requests/{borrowRequest}/handover', [ManageBorrowRequestController::class, 'handover'])->name('borrow-requests.handover');
        // Ruling 1's exit from a lapsed hold. Bodiless, like the handover
        // beside it: nothing is chosen, so there is no field to validate
        // and no Form Request — role:manager is what produces the 404
        // (CirculationArchitectureTest pins the gate on all four names).
        Route::post('/borrow-requests/{borrowRequest}/release', [ManageBorrowRequestController::class, 'release'])->name('borrow-requests.release');
        Route::get('/overdue', [OverdueController::class, 'index'])->name('overdue');
        Route::post('/loans/{loan}/void', [LoanController::class, 'void'])->name('loans.void');
        Route::get('/registrations', [RegistrationQueueController::class, 'index'])->name('registrations');
        Route::post('/registrations/{reader}/approve', [RegistrationQueueController::class, 'approve'])->name('registrations.approve');
        Route::post('/registrations/{reader}/reject', [RegistrationQueueController::class, 'reject'])->name('registrations.reject');
        // The moderation screen and the three decisions a manager makes
        // on a comment. The GET keeps the placeholder's route NAME, and
        // what that continuity buys is the nav item and the dashboard
        // card added in this same commit: `git grep manage.comments
        // 972f7ca -- resources/` returned no call sites, run before this
        // line was written.
        //
        // {comment} resolves two independent ways, divergence 3's two
        // layers: through Bookshelf::comments() under the scopeBindings()
        // on the OUTER shelves/{shelf} group — the `manage` group these
        // four lines sit in is declared prefix->name->middleware(['auth',
        // 'role:manager'])->group(), so the directive reaches them by
        // inheritance rather than locally — and through BookshelfScope on Comment
        // (App\Models\Concerns\BelongsToBookshelf) on every query
        // Eloquent runs for the binding. Bookshelf::comments()'s docblock
        // asked whichever task first routed through {comment} to measure
        // which of the two, alone, suffices, rather than assume
        // borrowRequests()'s answer transfers. MEASURED HERE, on the
        // approve POST with shelf B's comment id under shelf A's URL:
        // with both layers it is 404 and the row is untouched, and with
        // ->scopeBindings() removed from that outer group it is STILL 404 —
        // BookshelfScope alone produces it, exactly as this file's own
        // {bookCopy} note records for that parameter. The reverse
        // direction (scopeBindings alone, with the global scope removed)
        // was not measured. The second layer stays for the reason that
        // note gives: a rename that breaks the relation guess becomes a
        // loud RelationNotFoundException rather than a silent unscoped
        // query.
        Route::get('/comments', [CommentModerationController::class, 'index'])->name('comments');
        Route::post('/comments/{comment}/approve', [CommentModerationController::class, 'approve'])->name('comments.approve');
        Route::post('/comments/{comment}/reject', [CommentModerationController::class, 'reject'])->name('comments.reject');
        Route::post('/comments/{comment}/hide', [CommentModerationController::class, 'hide'])->name('comments.hide');
        // The bulletin, from the side that writes it — and BR specifies no
        // such screen, which is stated here rather than papered over with a
        // section number. An earlier draft of this comment read "BR §16.1's
        // Bản tin"; §16.1 is titled *Public pages* and its only sentence
        // about announcements is the shelf home's card, while §16.3,
        // *Manager pages*, lists the manager's screens without using the
        // word "announcement" at all. The authority for these nine lines is
        // OPS §4.4, which says so itself under PublishAnnouncement — "§16.3
        // does not itself describe an announcement-management screen; this
        // command follows the built UI" — resting on BR §13.2's "manage
        // announcements" permission and §5.4's Announcement record. Both
        // documents were opened for this comment.
        //
        // These route names are NEW rather than a placeholder's kept name: `git grep
        // -n "manage.announcements" 228ca76 -- resources/`, run before
        // this line was written, exited 1 with no output. The nav item
        // added to resources/js/layouts/manage-layout.tsx in this same
        // commit is the first Ziggy caller.
        //
        // ORDER IS LOAD-BEARING (spec §6): create BEFORE {announcement}.
        // Both URIs are one segment past `announcements` and both are
        // reached by GET, so with the bound line first Laravel resolves
        // "create" as an announcement id and the compose form becomes the
        // binding's 404. MEASURED by swapping the two lines and fetching
        // /manage/announcements/create as a manager — the run and its
        // answer are in this task's report. CommunityArchitectureTest's
        // 'declares announcements/create before announcements/{announcement}'
        // pins the declaration order itself.
        //
        // {announcement} binds BY ID, because Announcement declares no
        // getRouteKeyName() (read off app/Models/Announcement.php). The
        // reader's detail route above takes a plain {slug} instead, and
        // the two are independent: that one answers "is this notice
        // showing?" through AnnouncementsQuery::detail(), while these
        // address a row a manager can see in every state, drafts and
        // lapsed ones included.
        //
        // Shelf confinement here is this file's usual two layers:
        // Bookshelf::announcements() under the outer group's
        // scopeBindings(), and BookshelfScope on Announcement
        // (App\Models\Concerns\BelongsToBookshelf) on every query
        // Eloquent runs for the binding.
        //
        // BOTH DIRECTIONS MEASURED FOR {announcement}, which is more than
        // the {comment} note a few lines up could say: that one measured
        // the global scope alone and left "scopeBindings alone" untried.
        // The probe is ManagerAnnouncementsScreenTest's cross-shelf block,
        // six dataset rows over the six routes below that take an id, with
        // shelf B's announcement id under shelf A's URL:
        //
        //   both layers                    6 rows green (404 each)
        //   addGlobalScope commented out   6 rows green — scopeBindings
        //                                  alone produces the 404
        //   ->scopeBindings() removed      6 rows green — the global scope
        //                                  alone produces it
        //   BOTH removed                   6 rows RED, and they are the
        //                                  file's only failures: 200 on the
        //                                  GET, 302 on the five writes
        //
        // So either layer alone suffices here and neither is redundant
        // while the other stands. The role gate, per route, was measured
        // separately and is in the task report.
        Route::get('/announcements', [ManageAnnouncementController::class, 'index'])->name('announcements.index');
        Route::get('/announcements/create', [ManageAnnouncementController::class, 'create'])->name('announcements.create');
        Route::post('/announcements', [ManageAnnouncementController::class, 'store'])->name('announcements.store');
        Route::get('/announcements/{announcement}', [ManageAnnouncementController::class, 'edit'])->name('announcements.edit');
        Route::patch('/announcements/{announcement}', [ManageAnnouncementController::class, 'update'])->name('announcements.update');
        // The publish POST carries a body (one optional expiry box) and
        // therefore a Form Request; the three beneath it are bodiless, so
        // `role:manager` on this group is the whole of their refusal, the
        // way it is for the bodiless circulation POSTs above.
        Route::post('/announcements/{announcement}/publish', [ManageAnnouncementController::class, 'publish'])->name('announcements.publish');
        Route::post('/announcements/{announcement}/hide', [ManageAnnouncementController::class, 'hide'])->name('announcements.hide');
        Route::post('/announcements/{announcement}/pin', [ManageAnnouncementController::class, 'pin'])->name('announcements.pin');
        Route::post('/announcements/{announcement}/unpin', [ManageAnnouncementController::class, 'unpin'])->name('announcements.unpin');
        // BR §16.3's Donation queue, and the two decisions a manager
        // makes on a row. These route names are NEW rather than a
        // placeholder's kept name: `git grep -n "manage.donations"
        // 2731bea -- resources/ routes/` exited 1 with no output, run
        // before these three lines were written. The nav item added to
        // resources/js/layouts/manage-layout.tsx in this same commit is
        // the first Ziggy caller.
        //
        // STATIC BEFORE BOUND (spec §6's house habit), and HABITUAL here
        // rather than load-bearing, which is the difference from the
        // announcements pair above: the index is one segment past
        // `donations` and both bound URIs are three, so no request can
        // match more than one of them however they are declared.
        // CommunityArchitectureTest's 'declares manage/donations before
        // manage/donations/{donation}/…' pins the habit anyway, against
        // the day a one-segment-past sibling is added.
        //
        // {donation} resolves two independent ways, divergence 3's two
        // layers: through Bookshelf::donations() under the scopeBindings()
        // on the OUTER shelves/{shelf} group — the `manage` group these
        // lines sit in is declared prefix->name->middleware([...])->group(),
        // so the directive reaches them by inheritance — and through
        // BookshelfScope on BookDonation (App\Models\Concerns\
        // BelongsToBookshelf) on every query Eloquent runs for the
        // binding. ReceiveDonation's docblock recorded that the binding
        // half of that divergence had nothing to bind while no route
        // reached either command; these two POSTs are that address, and
        // ManagerDonationsScreenTest's cross-shelf dataset is the
        // measurement, over both of them, with shelf B's offer id under
        // shelf A's URL.
        //
        // THE RECEIVE POST IS BODILESS and carries no Form Request, so
        // `role:manager` on this group is the whole of its refusal — the
        // shape the bodiless circulation and comment POSTs above already
        // have. The decline POST carries a required reason and therefore a
        // DeclineDonationRequest, whose authorize() abort_unless is a
        // second door on that one route. What each of the three actually
        // answers with the middleware dropped was MEASURED — 200, 403 and
        // 404 respectively, three distinct numbers — and the run, with the
        // 403 traced to the line that raises it, is in
        // App\Http\Controllers\Manage\DonationController's docblock.
        Route::get('/donations', [ManageDonationController::class, 'index'])->name('donations');
        Route::post('/donations/{donation}/receive', [ManageDonationController::class, 'receive'])->name('donations.receive');
        Route::post('/donations/{donation}/decline', [ManageDonationController::class, 'decline'])->name('donations.decline');
        // Phase 3c-i Task 5, spec D9 — BR §16.3's *Đổi thông tin*, the
        // shelf's own decision queue, replacing the Phase 0 placeholder
        // that has held this settled name since.
        //
        // ONE CARD PER READER-SUBJECT PROPOSAL (BR:580). The other half of
        // the pending set — proposals whose subject is a manager or shelf
        // admin — is deliberately absent, and lives at
        // /admin/profile-changes below, because "nobody present may decide
        // it". The two predicates partition the set by the subject's role;
        // App\Queries\ProfileChangeQueueQuery's docblock carries why the
        // count badge shares them rather than approximating them.
        //
        // {profileChange} resolves the two independent ways this file's
        // divergence-3 note describes: through Bookshelf::profileChanges()
        // under the scopeBindings() on the OUTER shelves/{shelf} group,
        // and through BookshelfScope on ProfileChangeRequest itself. Both
        // layers say the same thing here — a request id from another
        // parish is a 404 at routing, before either Action runs — and the
        // Action then takes the shelf off the ROW rather than from
        // anything in the URL or the body (spec D10).
        //
        // BOTH POSTS CARRY A BODY, which is unusual for an approve in this
        // project: spec D3 gave ApproveProfileChange optional parish-unit
        // ids, and this card is where a manager re-places a reader. The
        // reject's required reason is the ordinary shape.
        Route::get('/profile-changes', [ManageProfileChangeController::class, 'index'])->name('profile-changes');
        Route::post('/profile-changes/{profileChange}/approve', [ManageProfileChangeController::class, 'approve'])->name('profile-changes.approve');
        Route::post('/profile-changes/{profileChange}/reject', [ManageProfileChangeController::class, 'reject'])->name('profile-changes.reject');
        // Phase 3b-ii Task 5, spec D5 and D6 — BR §5.6's parish units, the
        // rows a reader picks from at registration. The placeholder these
        // five replace held the name `units` from Phase 0;
        // ShellController::underConstruction's docblock records that the
        // route NAMES were final from that day, which is why only `units`
        // is inherited and the four write names are new.
        //
        // THIS GROUP BINDS A TENANT, AND THAT IS THE WHOLE REASON THE
        // SCREEN IS HERE. ParishUnit uses BelongsToBookshelf and
        // BookshelfScope fails closed, so every read and write below
        // resolves through the ordinary scoped path. On the /admin shelf
        // editor — which binds no tenant by design — the same CRUD would
        // force TenantContext::systemWide() on all of it, the capability
        // WideningArchitectureTest fences so that it stays rare. Spec D5
        // reversed twice before landing here; the shape of the taxonomy
        // stays on the admin editor (line 595 above), the units do not.
        //
        // `role:manager` on this group is the READ gate, not the write one.
        // All four writes are super-admin-only (ParishUnitPolicy, the
        // reference's requireSuperAdmin), refused in the Form Request and
        // again in the command, and the screen renders a manager the same
        // values as read-only text. A super admin reaches this
        // `role:manager` route because AppServiceProvider's Gate::before
        // grants every act-as-* ability to one.
        //
        // ORDER: reorder BEFORE {parishUnit}, this file's static-before-
        // bound house habit (spec §6). HABITUAL rather than load-bearing
        // here — `units/reorder` is POST and one segment past `units`,
        // while the bound POST is `units/{parishUnit}/delete` at two, so no
        // request can match both however they are declared — and kept
        // anyway against the day a one-segment-past sibling is added.
        //
        // POST for the delete, not DELETE: bodiless, the unit named in the
        // URL being the whole request, which is the shape every other state
        // transition in this file uses (readers.suspend,
        // announcements.pin) and the only verb set this file declares.
        //
        // {parishUnit} resolves two independent ways, the {comment} and
        // {donation} pairs' two layers: through Bookshelf::parishUnits()
        // under the scopeBindings() on the OUTER shelves/{shelf} group, and
        // through BookshelfScope on ParishUnit (App\Models\Concerns\
        // BelongsToBookshelf) on every query Eloquent runs for the binding.
        // SoftDeletes is a third: a retired unit does not resolve at all,
        // so a second "Xoá" on a row a stale screen still shows answers 404
        // rather than deleting nothing and reporting success — the case the
        // reference refuses by hand. ManagerUnitsScreenTest's cross-shelf
        // dataset is the measurement, over both bound routes, with shelf
        // B's unit id under shelf A's URL.
        Route::get('/units', [UnitController::class, 'index'])->name('units');
        Route::post('/units', [UnitController::class, 'store'])->name('units.store');
        Route::post('/units/reorder', [UnitController::class, 'reorder'])->name('units.reorder');
        Route::patch('/units/{parishUnit}', [UnitController::class, 'rename'])->name('units.rename');
        Route::post('/units/{parishUnit}/delete', [UnitController::class, 'destroy'])->name('units.delete');
        Route::get('/audit', [AuditLogController::class, 'index'])->name('audit');
        // BR §16.3's Statistics paragraph, opened: "Period selector (week,
        // month, year, since the shelf began), showing loans, distinct
        // borrowers, books added, and books lost, with charts over time and
        // ranked lists of top books and top readers." OPS §3.3's
        // GetStatistics is the query behind it. The placeholder this replaces
        // held the name from Phase 0; ShellController::underConstruction's
        // docblock records that the route NAMES were final from that day.
        Route::get('/statistics', [StatisticsController::class, 'index'])->name('statistics');
        // Phase 3b-ii Task 6, spec D4 — the shelf's own settings, READ-ONLY
        // and deliberately one route. A manager edits nothing here: the
        // lending policy, the contacts and the taxonomy shape all belong to
        // the super administrator's shelf editor under /admin, and
        // UpdateBookshelfPolicy authorizes internally as one — a manager
        // reaching it gets a 404 rather than a refusal, so a control on this
        // screen could only ever mislead. BR §16.3's fourteen manager
        // screens do not include Settings; §16.4 puts the policy on the
        // admin Bookshelves screen. CatalogueArchitectureTest's
        // "deliberately no delete-book route" is the precedent for saying so
        // in a test rather than only in a comment, and
        // ManagerSettingsScreenTest holds both halves: no write verb under
        // this path, and a component source that reaches for no form.
        Route::get('/settings', [ManageSettingsController::class, 'index'])->name('settings');
        Route::get('/qr-labels', [LabelController::class, 'index'])->name('qr-labels');
        // POST, matching this repo's export convention (ExportController's
        // docblock, and tests/Feature/Oversight/ExportHttpTest.php's POST to
        // /manage/exports/books), and DECLARED BEFORE exports/{kind} on the
        // next line — declared after, a POST here matches {kind} =
        // 'qr-labels' and reaches ExportController instead. Task 10's
        // report carries the falsification: moved below exports/{kind},
        // LabelExportTest's export block turns red; restored, it is green
        // and git status is clean.
        Route::post('/exports/qr-labels', [LabelController::class, 'export'])->name('exports.qr-labels');
        Route::post('/exports/{kind}', [ExportController::class, 'store'])->name('exports.run');
    });
});

// ── The super-admin area ──────────────────────────────────────────────────
Route::prefix('admin')->name('admin.')->middleware('super-admin')->group(function () {
    // BR §16.4's admin dashboard: "One row per bookshelf: name, books,
    // active readers, current loans, overdue count, pending items.
    // Anything needing attention is flagged." OPS §3.4's GetAdminOverview.
    // The one route in Phase 3 that is new rather than a placeholder.
    Route::get('/', [AdminDashboardController::class, 'index'])->name('dashboard');
    // BR §16.4's Bookshelves screen. Phase 3b-i Task 3 makes the list
    // real; the placeholder it replaces held the name from Phase 0.
    Route::get('/shelves', [AdminShelfController::class, 'index'])->name('shelves');
    // Task 4's create and edit-profile. `/shelves/create` is declared
    // BEFORE the parameterised routes for the ordinary reason — Laravel
    // matches in declaration order — though the two could not collide as
    // spelled, since the edit path carries a second segment.
    //
    // THE PARAMETER IS {bookshelf}, NOT {shelf}, AND THAT IS LOAD-BEARING.
    // RouteOrderTest requires the `tenant` middleware on every route naming
    // {shelf}, because in this application that name means "the shelf this
    // request is bound to" and the scope fails closed without it. Here it
    // would mean something else entirely: the /admin group binds no tenant
    // by design (spec D0), and the shelf in this URL is the OBJECT being
    // administered from outside it, not the tenant the request runs as.
    // Spelling it {shelf} and adding the middleware to satisfy the fence
    // would bind the admin area to one shelf and defeat the whole area; a
    // different name keeps the fence meaning what it says.
    //
    // It still binds by slug — Bookshelf::getRouteKeyName — which is the
    // address a parish prints, and spec D1 fixes it at creation. There is
    // deliberately no route that changes one.
    Route::get('/shelves/create', [AdminShelfController::class, 'create'])->name('shelves.create');
    Route::post('/shelves', [AdminShelfController::class, 'store'])->name('shelves.store');
    Route::get('/shelves/{bookshelf}/edit', [AdminShelfController::class, 'edit'])->name('shelves.edit');
    // PATCH, not PUT: this submit carries the profile section only. The
    // lending policy and the contacts are Task 5's own routes, because spec
    // D2 makes each section its own form with its own refusal.
    Route::patch('/shelves/{bookshelf}', [AdminShelfController::class, 'update'])->name('shelves.update');
    // Task 5's two sections, each with its own route because spec D2 makes
    // each section its own form, its own submit and its own refusal — and
    // spec D8 leans on that: 3b-ii adds a taxonomy section to this same
    // screen, which is an addition here rather than a restructure.
    //
    // PATCH for the policy, PUT for the contacts, and the difference is
    // real. The policy submit carries all eight settings and merges them
    // into a settings bag it shares with keys it never showed, so it
    // modifies part of the shelf. The contacts submit posts all three blocks
    // every time and REPLACES the set — a block left blank removes that
    // contact — which is what PUT means.
    Route::patch('/shelves/{bookshelf}/policy', [AdminShelfController::class, 'updatePolicy'])->name('shelves.policy');
    Route::put('/shelves/{bookshelf}/contacts', [AdminShelfController::class, 'updateContacts'])->name('shelves.contacts');
    // Phase 3b-ii Task 4's fourth section, spec D5 — BR §5.6's parish
    // taxonomy. PATCH like the policy and for the same reason: the submit
    // carries four keys that are merged into a settings bag shared with keys
    // it never showed, so it modifies part of the shelf rather than
    // replacing it.
    //
    // THE SHAPE ONLY. The units a reader picks from at registration are
    // edited on shelves/{shelf}/manage/units, which binds a tenant —
    // ParishUnit is shelf-scoped and this group is not, so unit CRUD here
    // would force a widening on every read and write of it.
    Route::patch('/shelves/{bookshelf}/taxonomy', [AdminShelfController::class, 'updateTaxonomy'])->name('shelves.taxonomy');
    // Task 6's lifecycle pair, spec D4. POST and bodiless — the shelf named
    // in the URL is the whole request, the shape every other state
    // transition in this file uses (readers.suspend, announcements.pin).
    //
    // TWO ROUTES RATHER THAN ONE TOGGLE, and that is the policy's shape
    // surfacing: BookshelfPolicy::archive() refuses a shelf that is already
    // archived and unarchive() refuses one that is not, each as a 404. A
    // single /status route would have to decide the target state from the
    // row it just read, which is exactly the read-then-act race the two
    // named routes make impossible — a second click on a stale page is
    // refused rather than silently reversing the first.
    //
    // Neither route un-archives on its own account anywhere else: this is
    // the only path back, which is why spec D4 keeps the ResolveTenant
    // filter for 3b-ii rather than landing it beside the archive control.
    Route::post('/shelves/{bookshelf}/archive', [AdminShelfController::class, 'archive'])->name('shelves.archive');
    Route::post('/shelves/{bookshelf}/unarchive', [AdminShelfController::class, 'unarchive'])->name('shelves.unarchive');
    // Task 7's screen, spec D5 and D7 — OPS §3.4's GetManagersList, and the
    // last placeholder in this group to become real.
    Route::get('/managers', [AdminManagerController::class, 'index'])->name('managers');
    // The three grants, all POST and all naming their subject in the URL.
    //
    // {bookshelf} AGAIN, NEVER {shelf} — the reasoning above the shelves
    // routes applies unchanged: RouteOrderTest requires the tenant
    // middleware on every route naming {shelf}, and this group binds no
    // tenant by design.
    //
    // {membership} IS DELIBERATELY NOT BOUND TO A MODEL. Membership carries
    // BelongsToBookshelf, so implicit binding would resolve it through
    // BookshelfScope, which fails closed with no tenant — every request to
    // this route would 500 before the controller body ran. The controller
    // takes it as a string and RevokeManager reads the row through the
    // shelf's own relation, which also confines a hand-posted id to the
    // shelf named here. {user} on the promote route is bound normally: User
    // is not a scoped model.
    //
    // Two segments, three, and four — the three patterns cannot collide
    // however Laravel orders them.
    Route::post('/managers/{bookshelf}', [AdminManagerController::class, 'store'])->name('managers.assign');
    Route::post('/managers/{bookshelf}/{membership}/revoke', [AdminManagerController::class, 'revoke'])->name('managers.revoke');
    // The one grant that belongs to no shelf, which is why its audit row
    // carries none and why Task 1's configurator exists (spec D0, D5).
    // There is deliberately no route back: OPS §4.5 lists no demotion.
    Route::post('/managers/{user}/promote', [AdminManagerController::class, 'promote'])->name('managers.promote');
    // Phase 3b-ii Task 3, spec D3 — the book genres, and the placeholder
    // this replaces held the name from Phase 0.
    //
    // NO {bookshelf} AND NO {shelf} ANYWHERE IN THIS BLOCK, and here that is
    // not a fence being worked around but the table's own shape: categories
    // carries no bookshelf_id at all. One taxonomy, shared by every tủ sách
    // in the installation, which is also why all three writes below audit
    // globally rather than naming a shelf.
    //
    // THE PATH IS ENGLISH. The reference's is /quan-tri/the-loai, and
    // RouteOrderTest bans Vietnamese path segments — the name does not carry
    // across, only the screen does.
    //
    // {category} BINDS BY ID, not by slug, and that is deliberate on a table
    // whose slug is unique: the slug is an internal handle a book form posts
    // (CreateCategory), and putting it in an administrator's URL would make
    // it look like an address somebody could be asked to change. The one
    // thing this area may never do is move it.
    Route::get('/categories', [AdminCategoryController::class, 'index'])->name('categories');
    Route::post('/categories', [AdminCategoryController::class, 'store'])->name('categories.store');
    // PATCH, and the verb is honest: this submit carries the display name
    // and the row keeps its slug, its sort order and every book on it.
    Route::patch('/categories/{category}', [AdminCategoryController::class, 'update'])->name('categories.rename');
    // POST and bodiless — the genre named in the URL is the whole request,
    // the shape shelves.archive above uses. There is deliberately no route
    // back: this slice has no un-archive command (spec D3), and a genre's
    // slug stays taken, so the way back is a new name.
    Route::post('/categories/{category}/archive', [AdminCategoryController::class, 'archive'])->name('categories.archive');
    // Phase 3b-ii Task 1, spec D1 — BR §16.4's system settings, and the
    // first caller `system_settings` has ever had. TWO WRITE ROUTES rather
    // than one, because the screen carries two forms: the administration's
    // own contact block (what the public reads on /contact) and the six
    // defaults a newly created shelf starts with. A shared route would mean
    // a number out of range in the second blocked a correction to the first
    // — 3b-i's D2 rule, applied to a page whose top half is public.
    //
    // POST for both, not PATCH. Each submit carries its whole block and the
    // row is a singleton created by the migration, so there is no partial
    // update to express and no resource to address: the URL names which
    // block is being written, which is the only distinction these two
    // requests carry.
    //
    // NO {bookshelf} AND NO {shelf}: the installation's own row belongs to
    // no parish, which is also why both writers audit globally.
    Route::get('/settings', [AdminSettingsController::class, 'index'])->name('settings');
    Route::post('/settings/contact', [AdminSettingsController::class, 'updateContact'])->name('settings.contact');
    Route::post('/settings/defaults', [AdminSettingsController::class, 'updateDefaults'])->name('settings.defaults');
    // Phase 3c-ii Task 5, spec D5 — BR:606's cross-shelf audit browser, and
    // the LAST placeholder route in the application. The six administration
    // acts that record no parish (3b-ii's five and 3b-i's
    // user.promoted_super_admin) have been written to a table whose only
    // reader compared the tenant column for equality, so not one of them
    // has ever been visible on any screen. This is the reader they were
    // written for, and docs/known-gaps.md's 3b-ii entry saying so is closed
    // in the same commit.
    //
    // READ-ONLY, AND NO SECOND ROUTE. There is no POST here and there must
    // never be one: a log a screen can edit is not a log (INV-12). The four
    // filters BR:606 asks for are query parameters on this one GET, which
    // is also what lets /admin/managers link straight into it with an actor
    // already chosen (Task 6).
    //
    // NO {bookshelf} AND NO {shelf}: the browser spans every parish PLUS
    // the installation's own rows, and which parish an entry belongs to is
    // a FILTER on this screen rather than a segment of its address —
    // App\Queries\Admin\AuditBrowserQuery owns the three answers that
    // filter can give.
    Route::get('/audit', [AdminAuditController::class, 'index'])->name('audit');
    // Phase 3c-ii Task 4, spec D3, D6, D8 and D9 — BR §16.1's Góp ý inbox,
    // and the read half of a table that has been writable since Phase 2b's
    // schema with no screen anywhere able to open it.
    //
    // SUPER-ADMIN ONLY, from this group's own middleware, ruled by the
    // product owner on 2026-09-01 and matching the reference (which gates
    // every feedback read and both handling writes on requireSuperAdmin).
    // BR §13.2 can be read as granting a shelf's own manager a shelf-level
    // inbox; it is not built, and App\Models\Bookshelf::feedback() is the
    // relation that would have served it — kept, unused, recorded in
    // docs/known-gaps.md rather than deleted.
    //
    // NO {bookshelf} AND NO {shelf}: the inbox is one list spanning every
    // parish PLUS the site-wide messages a shelf-scoped read cannot express
    // — feedback.bookshelf_id is the schema's one nullable tenant column.
    //
    // {feedback} IS TAKEN AS A STRING rather than bound to a model. Unlike
    // the profile-change routes below, binding would actually WORK here
    // (Feedback carries no BelongsToBookshelf, so no BookshelfScope fails
    // closed on it) — the id goes through App\Queries\Admin\
    // FeedbackInboxQuery::find() anyway so that one class owns how an
    // unbound `/admin` caller resolves a message, and the missing-row
    // answer is the same 404 either way.
    //
    // TWO WRITES AND NO THIRD. feedback.archived is deliberately not ported
    // (spec D8): OPERATIONS.md lists ArchiveFeedback provisionally with an
    // open question about an inert button, BR:610 asks only for read and
    // resolved, and the reference's own screen records the product owner
    // removing the fourth control.
    Route::get('/feedback', [AdminFeedbackController::class, 'index'])->name('feedback');
    Route::post('/feedback/{feedback}/read', [AdminFeedbackController::class, 'markRead'])->name('feedback.read');
    Route::post('/feedback/{feedback}/resolve', [AdminFeedbackController::class, 'resolve'])->name('feedback.resolve');
    // Phase 3c-i Task 5, spec D9 and D10 — BR §16.4's "Change queue for
    // managers and shelf admins": the other half of the partition above,
    // "every pending profile-change proposal whose subject is a manager or
    // shelf admin anywhere in the system, the shelf named on each card"
    // (BR:602). This is where a manager's own proposed change is decided,
    // because nobody at their own shelf may decide it.
    //
    // NO {shelf} AND NO BINDING. This group binds no tenant, so
    // BookshelfScope fails closed on ProfileChangeRequest and an implicit
    // binding would throw before the controller ran — these two carry a
    // bare id, which App\Queries\Admin\ManagerProfileChangeQueueQuery
    // ::find() resolves by widening once inside the sanctioned directory.
    // A missing id is the 404 the binding would have produced.
    //
    // THE SAME TWO ACTIONS AS THE SHELF QUEUE, per spec D10 — one
    // implementation of the decision, two surfaces reaching it — and the
    // shelf comes off the ROW on both paths, never off the body.
    Route::get('/profile-changes', [AdminProfileChangeController::class, 'index'])->name('profile-changes');
    Route::post('/profile-changes/{profileChange}/approve', [AdminProfileChangeController::class, 'approve'])->name('profile-changes.approve');
    Route::post('/profile-changes/{profileChange}/reject', [AdminProfileChangeController::class, 'reject'])->name('profile-changes.reject');
});

require __DIR__.'/auth.php';
