<?php

use App\Http\Controllers\Manage\AuditLogController;
use App\Http\Controllers\Manage\BookController;
use App\Http\Controllers\Manage\BorrowRequestController as ManageBorrowRequestController;
use App\Http\Controllers\Manage\CopyController;
use App\Http\Controllers\Manage\DashboardController;
use App\Http\Controllers\Manage\ExportController;
use App\Http\Controllers\Manage\LendController;
use App\Http\Controllers\Manage\LoanController;
use App\Http\Controllers\Manage\LostCopiesController;
use App\Http\Controllers\Manage\OverdueController;
use App\Http\Controllers\Manage\ReaderController;
use App\Http\Controllers\Manage\ReaderLifecycleController;
use App\Http\Controllers\Manage\RegistrationQueueController;
use App\Http\Controllers\Manage\ReturnController;
use App\Http\Controllers\Reader\BookController as ReaderBookController;
use App\Http\Controllers\Reader\BorrowRequestController as ReaderBorrowRequestController;
use App\Http\Controllers\Reader\CatalogueController;
use App\Http\Controllers\Reader\MyLoansController;
use App\Http\Controllers\Reader\NotificationController;
use App\Http\Controllers\Reader\SearchController;
use App\Http\Controllers\RegistrationController;
use App\Http\Controllers\ShellController;
use Illuminate\Support\Facades\Route;

// ── Public ────────────────────────────────────────────────────────────────
Route::get('/', [ShellController::class, 'home'])->name('home');
Route::get('/register', [RegistrationController::class, 'create'])->name('register');
Route::post('/register', [RegistrationController::class, 'store'])
    ->middleware('throttle:register')->name('register.store');
Route::get('/contact', [ShellController::class, 'underConstruction'])->name('contact');
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
        Route::get('/announcements', [ShellController::class, 'underConstruction'])->name('announcements');
        Route::get('/donate', [ShellController::class, 'underConstruction'])->name('donate');
        Route::get('/scan', [ShellController::class, 'underConstruction'])->name('scan');
    });

    Route::get('/feedback', [ShellController::class, 'underConstruction'])->name('feedback');

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
        Route::get('/', [ShellController::class, 'underConstruction'])->name('show');
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
        Route::get('/donations', [ShellController::class, 'underConstruction'])->name('donations');
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

        // The queue and its three decisions. The GET keeps the
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
        Route::get('/comments', [ShellController::class, 'underConstruction'])->name('comments');
        Route::get('/profile-changes', [ShellController::class, 'underConstruction'])->name('profile-changes');
        Route::get('/units', [ShellController::class, 'underConstruction'])->name('units');
        Route::get('/audit', [AuditLogController::class, 'index'])->name('audit');
        Route::get('/statistics', [ShellController::class, 'underConstruction'])->name('statistics');
        Route::get('/settings', [ShellController::class, 'underConstruction'])->name('settings');
        Route::get('/qr-labels', [ShellController::class, 'underConstruction'])->name('qr-labels');
        Route::get('/exports/qr-labels', [ShellController::class, 'underConstruction'])->name('exports.qr-labels');
        Route::post('/exports/{kind}', [ExportController::class, 'store'])->name('exports.run');
    });
});

// ── The super-admin area ──────────────────────────────────────────────────
Route::prefix('admin')->name('admin.')->middleware('super-admin')->group(function () {
    Route::get('/shelves', [ShellController::class, 'underConstruction'])->name('shelves');
    Route::get('/managers', [ShellController::class, 'underConstruction'])->name('managers');
    Route::get('/categories', [ShellController::class, 'underConstruction'])->name('categories');
    Route::get('/settings', [ShellController::class, 'underConstruction'])->name('settings');
    Route::get('/audit', [ShellController::class, 'underConstruction'])->name('audit');
    Route::get('/feedback', [ShellController::class, 'underConstruction'])->name('feedback');
    Route::get('/profile-changes', [ShellController::class, 'underConstruction'])->name('profile-changes');
});

require __DIR__.'/auth.php';
