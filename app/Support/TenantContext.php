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
