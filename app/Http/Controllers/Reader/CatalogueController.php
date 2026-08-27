<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\CatalogueQuery;
use App\Queries\CategoryQuery;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class CatalogueController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, CatalogueQuery $catalogue, CategoryQuery $categories): Response
    {
        Gate::authorize('viewAny', Book::class);

        $scope = $request->query('scope') === 'all' ? 'all' : 'available';
        $sort = $request->query('sort') === 'title' ? 'title' : 'recent';

        return Inertia::render('shelves/catalogue', [
            'books' => $catalogue->run([
                'scope' => $scope,
                'category' => $request->query('category'),
                'sort' => $sort,
                'page' => (int) $request->query('page', '1'),
            ]),
            'categories' => $categories->stockedByShelf(),
            'filters' => [
                'scope' => $scope,
                'category' => $request->query('category'),
                'sort' => $sort,
            ],
        ]);
    }
}
