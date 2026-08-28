<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Members\RegisterMemberOnBehalf;
use App\Http\Controllers\Controller;
use App\Http\Requests\Members\RegisterReaderOnBehalfRequest;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use App\Queries\ParishContextQuery;
use App\Queries\ReadersListQuery;
use App\Support\Members\ParishUnits;
use App\Support\QueryParam;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ReaderController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, ReadersListQuery $list, ParishContextQuery $parish): Response
    {
        Gate::authorize('viewAny', Membership::class);

        $status = QueryParam::first($request, 'status');
        $unit = QueryParam::first($request, 'unit');
        $q = QueryParam::first($request, 'q') ?? '';

        $context = $parish->run();

        return Inertia::render('manage/readers/index', [
            'readers' => $list->run([
                'q' => $q,
                'status' => $status,
                // This screen is "Người đọc" — readers. A shelf's own
                // managers and admins never appear in a roster built to
                // edit reader records (post-review fix wave item 1). The
                // 1c donor picker calls the query WITHOUT this filter.
                'role' => 'reader',
                'parishUnitId' => $unit,
                'page' => (int) (QueryParam::first($request, 'page', '1') ?? '1'),
            ]),
            'units' => collect([
                ...ParishUnits::options($context['units'], 1),
                ...ParishUnits::options($context['units'], 2),
            ])->map(fn (array $u) => ['id' => $u['id'], 'level' => $u['level'], 'name' => $u['name']])->values()->all(),
            'filters' => ['q' => $q, 'status' => $status, 'unit' => $unit],
        ]);
    }

    public function create(Bookshelf $shelf, ParishContextQuery $parish): Response
    {
        Gate::authorize('create', Membership::class);

        $context = $parish->run();

        return Inertia::render('manage/readers/create', [
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

    public function store(RegisterReaderOnBehalfRequest $request, Bookshelf $shelf, RegisterMemberOnBehalf $register): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        /** @var array<string, ?string> $validated */
        $validated = $request->validated();

        $result = $register->execute($user, $validated);

        return redirect()->route('shelves.manage.readers.show', [
            'shelf' => $shelf->slug, 'reader' => $result['membershipId'],
        ]);
    }

    /** Task 15 replaces this body with the real detail render. */
    public function show(Bookshelf $shelf, Membership $reader): Response
    {
        return Inertia::render('under-construction');
    }
}
