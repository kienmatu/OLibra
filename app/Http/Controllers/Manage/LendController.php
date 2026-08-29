<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\LendCopy;
use App\Actions\Members\ManagerRegisterReader;
use App\Enums\LoanStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\LendCopyRequest;
use App\Http\Requests\Circulation\QuickLendRegisterReaderRequest;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Queries\SearchBooksForLendingQuery;
use App\Queries\SearchReadersForLendingQuery;
use App\Support\Circulation\ChooseCopy;
use App\Support\Circulation\LendingSettings;
use App\Support\Circulation\LoanRules;
use App\Support\Circulation\LoanTerms;
use App\Support\Clock;
use App\Support\Members\ParishUnits;
use App\Support\QueryParam;
use App\Support\SafeId;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.3's quick lend, the most important screen in the application.
 * Steps 1 and 2 are searches; step 3 re-reads everything from the URL —
 * a URL is not evidence (a bookmark from last Sunday, a colleague's
 * pasted link) — and shows the exact refusal LendCopy would throw, BEFORE
 * the confirm tap. The command then re-checks a third time inside its
 * transaction, because even this read is seconds old by the time anybody
 * taps (OPS §5).
 */
class LendController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchBooksForLendingQuery $books): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';

        return Inertia::render('manage/lend/index', [
            'filters' => ['q' => $q],
            'results' => $books->run($q),
        ]);
    }

    public function reader(Request $request, Bookshelf $shelf, SearchReadersForLendingQuery $readers): Response
    {
        $q = QueryParam::first($request, 'q') ?? '';
        $slug = QueryParam::first($request, 'book');
        $book = $slug !== null ? Book::query()->where('slug', $slug)->first() : null;

        return Inertia::render('manage/lend/reader', [
            'filters' => ['q' => $q],
            'book' => $book === null ? null : [
                'slug' => $book->slug, 'title' => $book->title,
                'author' => $book->author, 'coverUrl' => $book->cover_url,
            ],
            'results' => $q === '' ? [] : $readers->run($q),
        ]);
    }

    /**
     * BR §16.3's escape hatch — step 2's "Đăng ký người đọc mới", the
     * screen 1b deferred to this phase (plan settled decision 3). Same
     * fields as the on-behalf form, different command and a different
     * destination: this one lands ACTIVE and goes straight to step 3, so
     * a child who walked up ten seconds ago leaves with the book.
     * `/manage/readers/create` is untouched and still lands pending — BR
     * §16.1's explicit sentence, the approval queue's path.
     */
    public function newReader(Request $request, Bookshelf $shelf, ParishContextQuery $parish): Response
    {
        $slug = QueryParam::first($request, 'book');
        $book = $slug !== null ? Book::query()->where('slug', $slug)->first() : null;
        $context = $parish->run();

        return Inertia::render('manage/lend/new-reader', [
            'book' => $book === null ? null : [
                'slug' => $book->slug, 'title' => $book->title,
                'author' => $book->author, 'coverUrl' => $book->cover_url,
            ],
            // ReaderController::create's exact shapes — the two
            // components below (ParishUnitFields, RegistrationPersonFields)
            // are 1b's and read these props by name.
            'taxonomy' => [
                'levels' => $context['taxonomy']->levels,
                'nested' => $context['taxonomy']->nested,
                'level1Label' => $context['taxonomy']->level1Label,
                'level2Label' => $context['taxonomy']->level2Label,
            ],
            'units' => collect([
                ...ParishUnits::options($context['units'], 1),
                ...ParishUnits::options($context['units'], 2),
            ])->map(fn (array $u) => [
                'id' => $u['id'], 'level' => $u['level'],
                'parentId' => $u['parentId'], 'name' => $u['name'],
            ])->values()->all(),
        ]);
    }

    public function storeReader(
        QuickLendRegisterReaderRequest $request,
        Bookshelf $shelf,
        ManagerRegisterReader $register,
    ): RedirectResponse {
        /** @var User $user */
        $user = $request->user();
        /** @var array<string, ?string> $validated */
        $validated = $request->validated();

        // `book` is this screen's own field, not a registration field.
        // Registration::register() reads named keys and would ignore it,
        // but stripping it here keeps the Action's input contract exactly
        // what its docblock says it is.
        $slug = $validated['book'] ?? null;
        $result = $register->execute($user, Arr::except($validated, ['book']));

        // Straight back into the lend. Without a book (a bookmarked hatch)
        // there is no step 3 to go to, so step 1 it is.
        if ($slug === null || $slug === '') {
            return redirect()->route('shelves.manage.lend', ['shelf' => $shelf->slug]);
        }

        return redirect()->route('shelves.manage.lend.confirm', [
            'shelf' => $shelf->slug, 'book' => $slug, 'reader' => $result['membershipId'],
        ]);
    }

    public function confirm(Request $request, Bookshelf $shelf, Clock $clock): Response
    {
        $slug = QueryParam::first($request, 'book');
        $membershipId = QueryParam::first($request, 'reader');

        $book = $slug !== null ? Book::query()->where('slug', $slug)->with('copies')->first() : null;
        $chosen = $book !== null
            ? ChooseCopy::lowestLendable($book->copies)
            : ['copy' => null, 'reason' => null];

        // PR #62 review, finding 2: memberships.id is ascii_bin — a
        // ?reader= that isn't UUID-shaped must never reach find()'s bind,
        // or MariaDB throws errno 1267 instead of "not found." The old
        // `[0-9a-f-]{36}` regex happened to close that hole (no test
        // covered it — deleting it left the suite green while the route
        // 500'd on both invalid bytes and ordinary 36-character Vietnamese
        // text) but was a second, weaker, hand-rolled definition of "looks
        // like a UUID" than the one Laravel's own route-model-binding
        // layer already enforces (HasUniqueStringIds::resolveRouteBinding-
        // Query() -> Str::isUuid()). SafeId::isUuid() is that same check,
        // shared rather than reinvented — see its own docblock.
        $membership = null;
        if (SafeId::isUuid($membershipId)) {
            $membership = Membership::query()->with('user')->find($membershipId);
        }

        $settings = LendingSettings::fromShelf($shelf);
        $readerReason = null;
        $activeLoans = 0;
        if ($membership !== null) {
            $activeLoans = Loan::query()
                ->where('borrower_id', $membership->user_id)
                ->where('status', LoanStatus::Active)
                ->count();
            $readerReason = LoanRules::memberMayBorrow($membership->status, $activeLoans, $settings->maxConcurrentLoans);
        }

        // OPS §5's order: copy-side refusal first, then reader-side. The
        // step indicator on the page draws the step actually reached.
        $blocking = match (true) {
            $book === null => 'book_missing',
            $chosen['reason'] !== null => $chosen['reason'],
            $membership === null => 'reader_missing',
            $readerReason !== null => $readerReason,
            default => null,
        };

        return Inertia::render('manage/lend/confirm', [
            'book' => $book === null ? null : [
                'slug' => $book->slug, 'title' => $book->title,
                'author' => $book->author, 'coverUrl' => $book->cover_url,
            ],
            'chosen' => $chosen['copy'] === null ? null : [
                'copyId' => $chosen['copy']->id, 'copyCode' => $chosen['copy']->code,
            ],
            'reader' => $membership === null ? null : [
                'membershipId' => $membership->id,
                'fullName' => $membership->user?->full_name,
                'activeLoans' => $activeLoans,
            ],
            'lentOn' => $clock->today(),
            'dueOn' => LoanTerms::dueDateFor($clock->today(), $settings->loanDays),
            'blocking' => $blocking,
        ]);
    }

    public function store(LendCopyRequest $request, Bookshelf $shelf, LendCopy $lendCopy): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // Scoped finds: a foreign or unknown id is a 404 out of
        // BookshelfScope, the same non-answer an unknown URL gets. Cast to
        // string (not left as the validated array's mixed value) so
        // findOrFail's overloaded stub resolves to the single-Model
        // return type rather than the array/Collection one PHPStan
        // otherwise cannot rule out.
        $copy = BookCopy::query()->findOrFail((string) $validated['copy_id']);
        $membership = Membership::query()->findOrFail((string) $validated['membership_id']);

        $result = $lendCopy->execute($user, $copy, $membership);

        // Larastan disagrees with itself across `?->` and plain `->` on
        // these two relations (flags the nullsafe as neverNull, then
        // flags the direct access as possibly-null) — a local variable
        // plus an explicit null check reads the same either way and
        // satisfies both rules at level 8.
        $book = $copy->book;
        $borrower = $membership->user;

        return redirect()
            ->route('shelves.manage.lend', ['shelf' => $shelf->slug])
            ->with('success', __('rules.lend_success_flash', [
                'title' => $book === null ? '' : $book->title,
                'name' => $borrower === null ? '' : $borrower->full_name,
                // AGENTS.md: "dates read as dates" — a raw Y-m-d here would
                // read "hạn trả 2026-09-12" one tap after the confirm screen
                // shows the same date as 12/09/2026 via formatDate(). Fixed
                // to the identical d/m/Y a volunteer already saw.
                'due' => Carbon::parse($result['dueOn'])->format('d/m/Y'),
            ]));
    }
}
