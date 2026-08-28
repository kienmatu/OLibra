<?php

namespace App\Http\Controllers;

use App\Actions\Members\RegisterMembership;
use App\Exceptions\RuleViolated;
use App\Http\Requests\Members\RegisterMembershipRequest;
use App\Models\Bookshelf;
use App\Queries\ParishContextQuery;
use App\Support\Members\ParishUnits;
use App\Support\QueryParam;
use App\Support\TenantContext;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The registration surface — /register?shelf={slug}, the shelf chosen at
 * the portal and carried in the query string because this route has no
 * shelf in its path. The tenant is bound HERE, by hand, with a null
 * membership: the guest reading of contextFor, and what lets
 * BookshelfScope, ParishContextQuery and AuditRecorder work on a route
 * outside the shelves/{shelf} group.
 *
 * A stranger naming a different parish's slug registers for that parish
 * and waits for ITS manager — that is what choosing a parish means; an
 * unknown or archived slug is the chooser on GET and shelf_not_found on
 * POST, never an existence oracle.
 */
class RegistrationController extends Controller
{
    public function create(Request $request, TenantContext $context, ParishContextQuery $parish): Response
    {
        $shelf = $this->resolveShelf(QueryParam::first($request, 'shelf'));

        if ($shelf === null) {
            return Inertia::render('register', [
                'shelf' => null, 'taxonomy' => null, 'units' => [], 'sent' => false,
            ]);
        }

        $context->set($shelf, null);
        $parishContext = $parish->run();

        // Live units only: OFFERING is the picker's rule (deleted units
        // stay valid history, but must not be offered — design §7). A
        // guest-facing controller must filter through ParishUnits::options
        // before serialising: ParishContextQuery deliberately returns
        // deletedAt for every unit (its own docstring), so an unfiltered
        // pass-through would leak which units were soft-deleted and their
        // retired names to an unauthenticated caller.
        $units = collect([
            ...ParishUnits::options($parishContext['units'], 1),
            ...ParishUnits::options($parishContext['units'], 2),
        ])->map(fn (array $u) => [
            'id' => $u['id'], 'level' => $u['level'],
            'parentId' => $u['parentId'], 'name' => $u['name'],
        ])->values()->all();

        return Inertia::render('register', [
            // {id, slug, name}: resources/js/types/index.ts's SharedShelf
            // shape exactly (HandleInertiaRequests's own key), not the
            // narrower {slug, name} the brief drafted — the two collide as
            // one TypeScript interface field, and mismatching it there was
            // a TS2430 build error, not a preference. Never a foreign
            // bookshelf_id: this is the one already-resolved, this-route
            // shelf.
            'shelf' => ['id' => $shelf->id, 'slug' => $shelf->slug, 'name' => $shelf->name],
            'taxonomy' => [
                'levels' => $parishContext['taxonomy']->levels,
                'nested' => $parishContext['taxonomy']->nested,
                'level1Label' => $parishContext['taxonomy']->level1Label,
                'level2Label' => $parishContext['taxonomy']->level2Label,
            ],
            'units' => $units,
            'sent' => QueryParam::first($request, 'sent') === '1',
        ]);
    }

    public function store(RegisterMembershipRequest $request, TenantContext $context, RegisterMembership $register): RedirectResponse
    {
        /** @var array<string, ?string> $validated */
        $validated = $request->validated();

        $shelf = $this->resolveShelf($validated['shelf'] ?? null);
        if ($shelf === null) {
            throw new RuleViolated('shelf_not_found');
        }

        $context->set($shelf, null);

        // $validated comes from RegisterMembershipRequest::rules(), which
        // never declares avatar_object — a guest cannot point a brand-new
        // person's avatar at an arbitrary storage key by naming one in the
        // POST body (RegisterMembership's own docstring, fix round minor
        // finding 3). validated() only returns declared-and-present keys,
        // so nothing here has to strip it by hand for that to hold.
        $register->execute($validated);

        // Not signed in, not to the shelf: the membership is pending and
        // every shelf page would refuse it — a loop on the one journey
        // this form exists to start. ?sent=1 is the acknowledgement.
        return redirect()->route('register', ['shelf' => $shelf->slug, 'sent' => 1]);
    }

    private function resolveShelf(?string $slug): ?Bookshelf
    {
        if ($slug === null || $slug === '') {
            return null;
        }

        return Bookshelf::query()
            ->where('slug', $slug)
            ->where('status', 'active')
            ->first();
    }
}
