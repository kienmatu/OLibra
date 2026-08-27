<?php

namespace App\Http\Controllers;

use App\Models\Book;
use App\Models\Bookshelf;
use Inertia\Inertia;
use Inertia\Response;

class ShellController extends Controller
{
    public function home(): Response
    {
        return Inertia::render('home');
    }

    public function shelves(): Response
    {
        return Inertia::render('shelves/index', [
            'shelves' => Bookshelf::query()
                ->where('status', 'active')
                ->orderBy('name')
                ->get(['id', 'slug', 'name', 'location'])
                ->map(fn (Bookshelf $shelf) => [
                    'slug' => $shelf->slug, 'name' => $shelf->name, 'location' => $shelf->location,
                ]),
        ]);
    }

    public function shelfHome(): Response
    {
        return Inertia::render('shelves/show');
    }

    /**
     * Every route of the §6 map that Phase 1-3 will fill renders this one
     * page until its real screen lands. The route NAMES are final today; the
     * pages are not — that asymmetry is the whole point of the skeleton.
     */
    public function underConstruction(): Response
    {
        return Inertia::render('under-construction');
    }

    /**
     * The {book} routes type-hint the binding NOW, in the skeleton, so the
     * scoped-binding behaviour (a foreign shelf's slug is 404) is live and
     * tested from day one — not discovered when Phase 1 fills the screen in.
     */
    public function book(Bookshelf $shelf, Book $book): Response
    {
        return Inertia::render('under-construction');
    }
}
