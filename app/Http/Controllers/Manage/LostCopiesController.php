<?php

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Book;
use App\Models\Bookshelf;
use App\Queries\LostCopiesQuery;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class LostCopiesController extends Controller
{
    public function index(Bookshelf $shelf, LostCopiesQuery $lost): Response
    {
        Gate::authorize('viewAny', Book::class);

        return Inertia::render('manage/books/lost', [
            'copies' => $lost->rows(),
        ]);
    }
}
