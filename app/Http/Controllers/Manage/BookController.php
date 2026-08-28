<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Catalogue\CreateBook;
use App\Actions\Catalogue\UpdateBook;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalogue\StoreBookRequest;
use App\Http\Requests\Catalogue\UpdateBookRequest;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\BookForEditQuery;
use App\Queries\BooksListQuery;
use App\Queries\CategoryQuery;
use App\Queries\LostCopiesQuery;
use App\Queries\ManagerBookDetailQuery;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Thin by design (spec §1.3): queries in, Inertia out; every write is an
 * Action.
 *
 * CORRECTED (whole-branch review, PR #60): the line this replaces claimed
 * the per-model Gate::authorize calls below were "the second lock BR §13.3
 * requires." They are not, today. The route group is already behind
 * ['auth', 'role:manager'], which is exactly Gate::allows('act-as-manager')
 * (EnsureShelfRole::handle). show()/edit()'s `Gate::authorize('manage',
 * $book)` calls BookPolicy::manage, which itself is nothing but
 * act-as-manager again — the identical check, on the identical
 * TenantContext membership, repeated — and BookPolicy's own docblock notes
 * $book carries no shelf re-check to make it a genuine second check.
 * Verified directly: deleting both `manage` calls leaves the full suite
 * green. index()/lost()'s `Gate::authorize('viewAny', Book::class)` is
 * weaker still — BookPolicy::viewAny resolves to act-as-reader, and
 * MembershipRole::atLeast() means any manager who already cleared
 * role:manager clears act-as-reader for free, so that call can never
 * itself refuse anyone the middleware let through.
 *
 * None of this makes the calls wrong to keep: they document, at the point
 * of use, which ability a given action actually requires, and they stop
 * being no-ops the day this group's middleware ever loosens (a future
 * route relaxing role:manager to admit readers, say, would make viewAny's
 * check real again without anyone having to remember to add it back). But
 * BR §13.3's "second lock" is not what is running here right now, and nothing
 * in this codebase currently tests that it is.
 */
class BookController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, BooksListQuery $list, CategoryQuery $categories, LostCopiesQuery $lost): Response
    {
        Gate::authorize('viewAny', Book::class);

        $q = QueryParam::first($request, 'q');
        $category = QueryParam::first($request, 'category');
        $sort = QueryParam::first($request, 'sort') === 'title' ? 'title' : 'recent';

        return Inertia::render('manage/books/index', [
            'books' => $list->run([
                'q' => $q,
                'category' => $category,
                'sort' => $sort,
                'page' => (int) QueryParam::first($request, 'page', '1'),
            ]),
            // includeDrafts: this list HAS no is_published filter, so its
            // filter bar must reach the categories drafts live in.
            'categories' => $categories->stockedByShelf(includeDrafts: true),
            'lostCount' => $lost->count(),
            'filters' => [
                'q' => $q ?? '',
                'category' => $category,
                // Normalised, not echoed — an arbitrary ?sort= must not
                // ride back into the page's own links.
                'sort' => $sort,
            ],
        ]);
    }

    public function create(Bookshelf $shelf, CategoryQuery $categories): Response
    {
        Gate::authorize('create', Book::class);

        return Inertia::render('manage/books/create', [
            // allOptions, NOT stockedByShelf: the create form must reach
            // the category a shelf's first book of a kind belongs to.
            'categories' => $categories->allOptions(),
        ]);
    }

    public function store(StoreBookRequest $request, Bookshelf $shelf, CreateBook $createBook): RedirectResponse
    {
        // FormRequest::authorize() already failed the request for a guest,
        // so user() is never null here — the annotations are for the
        // analyser, which cannot see that. Same reasoning on every other
        // $request->user() call in this class and CopyController.
        /** @var User $user */
        $user = $request->user();
        /** @var array{title: string, author: string, category_slug: string, publisher?: ?string, published_year?: ?int, page_count?: ?int, isbn?: ?string, description?: ?string, language?: ?string, is_published?: ?bool, copy_count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string} $validated */
        $validated = $request->validated();

        $book = $createBook->execute($user, $validated);

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }

    public function show(Bookshelf $shelf, Book $book, ManagerBookDetailQuery $detail): Response
    {
        Gate::authorize('manage', $book);

        return Inertia::render('manage/books/show', [
            'detail' => $detail->run($book),
        ]);
    }

    public function edit(Bookshelf $shelf, Book $book, BookForEditQuery $form, CategoryQuery $categories): Response
    {
        Gate::authorize('manage', $book);

        return Inertia::render('manage/books/edit', [
            'book' => $form->run($book),
            'categories' => $categories->allOptions(),
        ]);
    }

    public function update(UpdateBookRequest $request, Bookshelf $shelf, Book $book, UpdateBook $updateBook): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $updateBook->execute($user, $book, $request->validated());

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }
}
