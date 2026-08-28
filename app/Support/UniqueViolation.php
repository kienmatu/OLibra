<?php

namespace App\Support;

use App\Exceptions\RuleViolated;
use Illuminate\Database\QueryException;

/**
 * BR §2: "one of them must fail cleanly and see a plain message, never a
 * silently corrupted record." The generated-column uniques are the
 * structural half (spec §4.1); this is the sentence half — errno 1062,
 * matched BY CONSTRAINT NAME so an unrelated collision is never dressed up
 * as the wrong refusal, becomes the RuleViolated code the map names.
 *
 * The same translation 0009_invariant_constraints.sql performed for
 * Postgres's 23505, and the reference's isUniqueViolation catch blocks.
 */
final class UniqueViolation
{
    /** @param array<string, string> $map constraint name → RuleViolated code */
    public static function translate(QueryException $e, array $map): never
    {
        if (($e->errorInfo[1] ?? null) === 1062) {
            foreach ($map as $constraint => $code) {
                if (str_contains($e->getMessage(), $constraint)) {
                    throw new RuleViolated($code);
                }
            }
        }

        throw $e;
    }
}
