<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\CatalogueQuery;
use App\Queries\SearchQuery;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class SearchController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, SearchQuery $search, CatalogueQuery $catalogue): Response
    {
        Gate::authorize('viewAny', Book::class);

        $q = trim((string) $request->query('q', ''));

        return Inertia::render('shelves/search', [
            'q' => $q,
            'results' => $search->run($q),
            // BR §16.1: "The empty state suggests popular books rather
            // than showing nothing." The reference's device — a short row
            // of recently added, currently available titles — reused via
            // the catalogue query rather than a second read shape.
            'suggestions' => $q === ''
                ? $catalogue->run(['scope' => 'available', 'sort' => 'recent', 'per_page' => 6])['rows']
                : [],
        ]);
    }
}
