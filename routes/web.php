<?php

use App\Http\Controllers\ShellController;
use Illuminate\Support\Facades\Route;

// ── Public ────────────────────────────────────────────────────────────────
Route::get('/', [ShellController::class, 'home'])->name('home');
Route::get('/register', [ShellController::class, 'underConstruction'])->name('register');
Route::get('/contact', [ShellController::class, 'underConstruction'])->name('contact');
Route::get('/shelves', [ShellController::class, 'shelves'])->name('shelves.index');

// ── One shelf ─────────────────────────────────────────────────────────────
// scopeBindings(): every child binding ({book}, later {reader}) resolves
// THROUGH the bound shelf's relationship (Bookshelf::books()), so a foreign
// shelf's colliding slug is a 404, not a cross-tenant hit. Without this,
// SubstituteBindings would resolve {book} table-wide. RouteIsolationTest
// carries the proof.
Route::prefix('shelves/{shelf}')->name('shelves.')->middleware('tenant')->scopeBindings()->group(function () {
    Route::get('/', [ShellController::class, 'shelfHome'])->name('show');
    Route::get('/catalogue', [ShellController::class, 'underConstruction'])->name('catalogue');
    Route::get('/search', [ShellController::class, 'underConstruction'])->name('search');
    Route::get('/books/{book}', [ShellController::class, 'book'])->name('books.show');
    Route::get('/announcements', [ShellController::class, 'underConstruction'])->name('announcements');
    Route::get('/feedback', [ShellController::class, 'underConstruction'])->name('feedback');
    Route::get('/donate', [ShellController::class, 'underConstruction'])->name('donate');
    Route::get('/scan', [ShellController::class, 'underConstruction'])->name('scan');

    Route::prefix('profile')->name('profile.')->middleware('auth')->group(function () {
        Route::get('/', [ShellController::class, 'underConstruction'])->name('show');
        Route::get('/history', [ShellController::class, 'underConstruction'])->name('history');
        Route::get('/notifications', [ShellController::class, 'underConstruction'])->name('notifications');
        Route::get('/donations', [ShellController::class, 'underConstruction'])->name('donations');
        Route::get('/overview', [ShellController::class, 'underConstruction'])->name('overview');
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
        Route::get('/', [ShellController::class, 'underConstruction'])->name('dashboard');

        Route::get('/lend', [ShellController::class, 'underConstruction'])->name('lend');
        Route::get('/lend/reader', [ShellController::class, 'underConstruction'])->name('lend.reader');
        Route::get('/lend/confirm', [ShellController::class, 'underConstruction'])->name('lend.confirm');
        Route::get('/returns', [ShellController::class, 'underConstruction'])->name('returns');
        Route::get('/returns/lost', [ShellController::class, 'underConstruction'])->name('returns.lost');

        Route::get('/readers', [ShellController::class, 'underConstruction'])->name('readers.index');
        Route::get('/readers/create', [ShellController::class, 'underConstruction'])->name('readers.create');
        Route::get('/readers/{reader}', [ShellController::class, 'underConstruction'])->name('readers.show');

        // ORDER IS LOAD-BEARING (spec §6): create and lost BEFORE {book},
        // or Laravel binds "lost" as a slug. RouteOrderTest pins this.
        Route::get('/books', [ShellController::class, 'underConstruction'])->name('books.index');
        Route::get('/books/create', [ShellController::class, 'underConstruction'])->name('books.create');
        Route::get('/books/lost', [ShellController::class, 'underConstruction'])->name('books.lost');
        Route::get('/books/{book}', [ShellController::class, 'book'])->name('books.show');
        Route::get('/books/{book}/edit', [ShellController::class, 'book'])->name('books.edit');

        Route::get('/borrow-requests', [ShellController::class, 'underConstruction'])->name('borrow-requests');
        Route::get('/overdue', [ShellController::class, 'underConstruction'])->name('overdue');
        Route::get('/registrations', [ShellController::class, 'underConstruction'])->name('registrations');
        Route::get('/comments', [ShellController::class, 'underConstruction'])->name('comments');
        Route::get('/profile-changes', [ShellController::class, 'underConstruction'])->name('profile-changes');
        Route::get('/units', [ShellController::class, 'underConstruction'])->name('units');
        Route::get('/audit', [ShellController::class, 'underConstruction'])->name('audit');
        Route::get('/statistics', [ShellController::class, 'underConstruction'])->name('statistics');
        Route::get('/settings', [ShellController::class, 'underConstruction'])->name('settings');
        Route::get('/qr-labels', [ShellController::class, 'underConstruction'])->name('qr-labels');
        Route::get('/exports/qr-labels', [ShellController::class, 'underConstruction'])->name('exports.qr-labels');
        Route::get('/exports/{kind}', [ShellController::class, 'underConstruction'])->name('exports.show');
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
