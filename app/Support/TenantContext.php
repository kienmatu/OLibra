<?php

namespace App\Support;

use App\Models\Bookshelf;
use App\Models\Membership;

/**
 * Everything a request knows about where it is and who is asking — the
 * Laravel form of src/domain/kernel/tenant.ts's TenantContext. Registered as
 * a scoped singleton (fresh per request), populated exactly once, by the
 * ResolveTenant middleware (Task 16). Nothing else may call set().
 *
 * Three states, and the third is deliberate:
 *  - bound: set() was called; BookshelfScope filters to that shelf.
 *  - system-wide: actSystemWide() was called. This has no TypeScript
 *    counterpart: src/domain/kernel/tenant.ts's TenantContext declares
 *    bookshelfId as non-nullable, and even its systemContext() still names
 *    a shelf and still filters — the old system never had a way to remove
 *    filtering entirely. actSystemWide() is a capability spec §5 sanctions
 *    widening into. Console commands, seeders and admin queries opt in BY
 *    NAME and then name their own bookshelf_id explicitly.
 *  - unset: querying a scoped model THROWS (see BookshelfScope). Under RLS
 *    an unset tenant returned zero rows; a scope that silently no-ops would
 *    invert that into "returns every shelf's rows" the first time a route
 *    group forgets its middleware. Fail closed, loudly.
 */
final class TenantContext
{
    private ?Bookshelf $bookshelf = null;

    private ?Membership $membership = null;

    private bool $systemWide = false;

    public function set(Bookshelf $bookshelf, ?Membership $membership): void
    {
        $this->bookshelf = $bookshelf;
        $this->membership = $membership;
        $this->systemWide = false;
    }

    /** Opt in to reading across every shelf. Explicit, greppable, audited. */
    public function actSystemWide(): void
    {
        $this->bookshelf = null;
        $this->membership = null;
        $this->systemWide = true;
    }

    /**
     * Run $fn with tenancy removed, then put the tenant back.
     *
     * THE RESTORE IS THE POINT. actSystemWide() alone has no reset — clear()
     * exists on this class and has zero callers in app/ — and this object is
     * bound `scoped` (AppServiceProvider), one instance per request. So a
     * bare widening leaks for the rest of the request, and it leaks SILENTLY:
     * BookshelfScope::apply returns early on isSystemWide() and adds no
     * predicate, rather than throwing the way it does on an unset tenant.
     *
     * The finally covers the exception path too. A cross-shelf query that
     * throws mid-read must not leave the rest of the request unscoped.
     *
     * It restores what it FOUND, not a default — nesting restores to
     * system-wide, and an unset tenant restores to unset, so a caller that
     * was going to fail loudly still does.
     *
     * @template T
     *
     * @param  callable(): T  $fn
     * @return T
     */
    public function systemWide(callable $fn): mixed
    {
        $bookshelf = $this->bookshelf;
        $membership = $this->membership;
        $systemWide = $this->systemWide;

        $this->actSystemWide();

        try {
            return $fn();
        } finally {
            $this->bookshelf = $bookshelf;
            $this->membership = $membership;
            $this->systemWide = $systemWide;
        }
    }

    public function isSystemWide(): bool
    {
        return $this->systemWide;
    }

    public function bookshelf(): ?Bookshelf
    {
        return $this->bookshelf;
    }

    public function bookshelfId(): ?string
    {
        return $this->bookshelf?->id;
    }

    public function membership(): ?Membership
    {
        return $this->membership;
    }

    public function clear(): void
    {
        $this->bookshelf = null;
        $this->membership = null;
        $this->systemWide = false;
    }
}
