<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\CatalogueQuery;
use App\Queries\CategoryQuery;
use App\Support\QueryParam;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class CatalogueController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, CatalogueQuery $catalogue, CategoryQuery $categories): Response
    {
        Gate::authorize('viewAny', Book::class);

        $scope = QueryParam::first($request, 'scope') === 'all' ? 'all' : 'available';
        $sort = QueryParam::first($request, 'sort') === 'title' ? 'title' : 'recent';
        $category = QueryParam::first($request, 'category');

        return Inertia::render('shelves/catalogue', [
            'books' => $catalogue->run([
                'scope' => $scope,
                'category' => $category,
                'sort' => $sort,
                'page' => (int) QueryParam::first($request, 'page', '1'),
            ]),
            'categories' => $categories->stockedByShelf(),
            'filters' => [
                'scope' => $scope,
                'category' => $category,
                'sort' => $sort,
            ],
        ]);
    }
}
