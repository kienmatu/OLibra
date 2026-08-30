<?php

namespace App\Http\Middleware;

use App\Models\Notification;
use App\Models\User;
use App\Queries\DonationQueueQuery;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /** @var string */
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /** @return array<string, mixed> */
    public function share(Request $request): array
    {
        $context = app(TenantContext::class);
        $shelf = $context->bookshelf();
        /** @var User|null $user */
        $user = $request->user();

        return [
            ...parent::share($request),
            'auth' => [
                // is_super_admin is included: a super admin passes role:
                // gates on a shelf they hold no membership of (the gate is
                // unconditional in AppServiceProvider), so TenantContext's
                // membership() is null and 'role' below is null for them
                // too. Without this flag, shared props cannot express
                // "this user can see manage/admin nav" for the one person
                // guaranteed access to it — a client that hides
                // role-conditional UI on `role === null` would hide it
                // from super admins as well as guests.
                'user' => $request->user()?->only([
                    'id', 'display_name', 'full_name', 'saint_name', 'is_super_admin',
                ]),
            ],
            // Only the bound shelf, only presentation fields. §5.4: no
            // Inertia prop may carry a foreign bookshelf_id — this is the
            // single place shelf data enters shared props.
            'shelf' => $shelf === null ? null : [
                'id' => $shelf->id,
                'slug' => $shelf->slug,
                'name' => $shelf->name,
            ],
            'role' => $context->membership()?->role?->value,
            // BR §15's bell count. A CLOSURE, not a value: share() runs on
            // every request through the web group, but Inertia resolves a
            // callable prop only while building an Inertia\Response
            // (Inertia\PropsResolver) — so a redirect, a streamed CSV
            // download or any non-Inertia response never runs this query.
            // MyNotificationsTest pins both halves (no count statement on
            // the mark-all POST; exactly one on a page whose controller
            // never asks for notifications).
            //
            // One count per render is affordable only because
            // 2026_08_30_000001 gave notifications an index that can serve
            // it. Before that index this planned as `type: ALL, rows: 400`
            // over a 400-row two-shelf table — a full scan of EVERY
            // tenant's rows, because read_at was in no index and
            // BookshelfScope's bookshelf_id is an ordinary WHERE clause,
            // applied after the scan, not a scan boundary. On a shared
            // install (BUSINESS-REQUIREMENTS.md:57 and SDD.md:228 both
            // describe Phase 1 as "one tenant among many") that made one
            // parish's bell cost grow with every other parish's volume.
            // Now: `type: index_merge … Using intersect(...); Using index,
            // rows: 66` — covering, and bounded by this user's unread rows.
            //
            // NULL is "render no bell", and the third clause is a DEVIATION
            // from task-16-brief.md, which asked for "a user is signed in
            // AND a shelf is bound" alone. Measured, not theorised: the
            // shelf's `feedback` route is deliberately outside the
            // role:reader group (a guest may leave feedback), so a
            // signed-in NON-member reaches a shelf page with both a user
            // and a shelf bound — and the two-clause version handed them a
            // header link to a notifications page that 404s them.
            // Gate::allows('act-as-reader') is the SAME gate the route's
            // role:reader middleware asks, rather than a second opinion
            // about who is a member (and Gate::before keeps the memberless
            // super admin's bell, exactly as it keeps their access).
            //
            // BookshelfScope FAILS CLOSED on an unbound tenant, so the
            // $shelf clause is load-bearing, not cosmetic: counting without
            // it would throw on every signed-in page outside a shelf.
            // $user->id is a users(id) — notifications.user_id is never a
            // membership id.
            'unreadNotifications' => fn (): ?int => ($user !== null && $shelf !== null && Gate::allows('act-as-reader'))
                ? Notification::query()
                    ->where('user_id', $user->id)
                    ->whereNull('read_at')
                    ->count()
                : null,
            // BR §16.3's Donation queue badge — "Reachable from the
            // sidebar nav with a count badge" is that paragraph's first
            // sentence (opened), and OPS §3.3's GetDonationQueue row
            // carries "Queue count for the badge" as derived on read.
            // Built on the bell above, key for key: a CLOSURE, so a
            // redirect or a CSV download resolves nothing (the POSTs on
            // the donation queue itself are redirects, so pressing Duyệt
            // costs no count); a role GATE, so the number only reaches
            // somebody the manage routes would admit; and a `$shelf`
            // clause, because BookshelfScope FAILS CLOSED on an unbound
            // tenant and DonationQueueQuery reads through it — counting
            // with no shelf bound would throw on every signed-in page
            // outside a shelf, not merely answer wrong.
            //
            // act-as-manager, not act-as-reader: this is the manage
            // sidebar's number. Gate::before in AppServiceProvider keeps
            // the memberless super admin's badge exactly as it keeps
            // their access to the screen.
            //
            // NULL is "render no badge", and it is the SERVER's decision,
            // the way the bell's is: a reader gets null rather than a
            // number they could compare against a screen they cannot
            // open. 0 is a real answer — an empty queue for a manager.
            //
            // The count is DonationQueueQuery::countPending(), which
            // shares its predicate with the list the badge links to (that
            // class's docblock carries why that is structural). Resolved
            // out of the container inside the closure so the middleware
            // does not construct a query object on every non-Inertia
            // request.
            'pendingDonations' => fn (): ?int => ($user !== null && $shelf !== null && Gate::allows('act-as-manager'))
                ? app(DonationQueueQuery::class)->countPending()
                : null,
            // For the plain <form method="post"> downloads (an Inertia
            // router.post cannot receive a file): the token VerifyCsrfToken
            // will demand.
            'csrfToken' => $request->session()->token(),
            'flash' => [
                'success' => fn () => $request->session()->get('success'),
            ],
        ];
    }
}
