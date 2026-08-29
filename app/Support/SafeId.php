<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * PR #62 review, finding 1 (+ finding 2 reusing it): one check for "is this
 * raw string even shaped like a value that could match a stored id?", for
 * every id/xxx_id column in this schema — every migration creating one
 * pins it `charset('ascii')->collation('ascii_bin')` (database/migrations,
 * e.g. `memberships.id`, `memberships.parish_unit_l1_id`). MariaDB refuses
 * to compare an ascii_bin column against a bound parameter carrying
 * non-ASCII bytes at all: SQLSTATE[HY000] errno 1267, "Illegal mix of
 * collations (ascii_bin,IMPLICIT) and (utf8mb4_unicode_ci,COERCIBLE)" —
 * turning an ordinary Vietnamese parish-unit name typed into `?unit=`, or a
 * stray emoji, into an unmapped 500 instead of "matches nothing." Not
 * hypothetical: reproduced live over real HTTP for both
 * `ReadersListQuery`'s `parishUnitId` filter (`?unit=Giáo họ Đức Mẹ`,
 * `?unit=📚`) and, before this fix, would have reproduced for
 * `LendController::confirm`'s `?reader=` the moment its regex guard was
 * lifted.
 *
 * Laravel's OWN route-model-binding layer already carries this exact
 * check: `Illuminate\Database\Eloquent\Concerns\HasUniqueStringIds`
 * (pulled in by every model here via `HasUuids` — `Membership`, `Loan`,
 * `BookCopy`, ...) overrides `resolveRouteBindingQuery()` to call
 * `Str::isUuid()` BEFORE the query ever runs, throwing a clean
 * `ModelNotFoundException` (404) for anything that doesn't look like a
 * UUID — confirmed live: `GET /shelves/{shelf}/manage/readers/Giáo` 404s
 * cleanly, never touching the database, because `{reader}`'s implicit
 * binding goes through that trait. This class is the SAME guard for the
 * two other places a raw id-shaped value reaches a query WITHOUT ever
 * going through route-model-binding: a manual `::find()`/`::where()` call
 * on a value read from a query string. Both of those used to carry their
 * own hand-rolled, weaker checks (a `[0-9a-f-]{36}` regex that accepts
 * plenty of strings that aren't UUIDs, or no check at all) — both now
 * share this one, and both get the SAME strictness Laravel's own binding
 * layer already enforces, rather than a second, possibly-drifting
 * definition of "looks like an id."
 */
final class SafeId
{
    public static function isUuid(?string $value): bool
    {
        return $value !== null && Str::isUuid($value);
    }
}
