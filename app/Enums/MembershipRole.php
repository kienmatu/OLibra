<?php

declare(strict_types=1);

namespace App\Enums;

enum MembershipRole: string
{
    case Reader = 'reader';
    case Manager = 'manager';
    case Admin = 'admin';

    /**
     * BR §13.1's hierarchy — the PHP form of ROLE_RANK in
     * src/domain/kernel/tenant.ts. guest (0) is the absence of a membership
     * and super_admin (4) is the global users.is_super_admin flag; neither
     * is a membership role, so neither is a case here.
     */
    public function rank(): int
    {
        return match ($this) {
            self::Reader => 1,
            self::Manager => 2,
            self::Admin => 3,
        };
    }

    /** admin ⊃ manager ⊃ reader — no caller lists inherited roles. */
    public function atLeast(self $required): bool
    {
        return $this->rank() >= $required->rank();
    }
}
