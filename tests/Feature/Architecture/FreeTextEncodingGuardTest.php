<?php

use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Catalogue\StoreBookRequest;
use App\Http\Requests\Catalogue\UpdateBookRequest;
use App\Http\Requests\Circulation\LendCopyRequest;
use App\Http\Requests\Circulation\QuickLendRegisterReaderRequest;
use App\Http\Requests\Circulation\ReceiveReturnRequest;
use App\Http\Requests\Members\RegisterMembershipRequest;
use App\Http\Requests\Members\RegisterReaderOnBehalfRequest;
use App\Http\Requests\Members\SetReaderCredentialsRequest;
use App\Http\Requests\Members\UpdateReaderProfileRequest;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Task 12's carry-over fix, generalised: the class of bug, not the
 * instance. Four confirmed occurrences before this test existed —
 * registration's four name fields (Phase 1b, PR #61 fix round), the
 * suspension reason (predicted by Task 6's review), the return note
 * (found by Task 11's hostile-input probes), and CopyNoteRequest's note
 * (found live by Task 11's reviewer, fixed here as the carry-over) — each
 * one an unmapped MariaDB errno 1366 (invalid string for a utf8mb4
 * column) turning a legitimate request into a 500, because `string`/`max`
 * check length and PHP type only, never byte validity.
 *
 * This test scans EVERY class under app/Http/Requests, calls its rules(),
 * and for every field whose ruleset contains the bare `string` rule,
 * requires `encoding:UTF-8` UNLESS the field is named in EXEMPT below —
 * and every exemption there carries the reason its downstream write path
 * is provably safe without the rule (a WHERE-only lookup, a stricter gate
 * that already rejects non-ASCII bytes before storage, or a value that is
 * hashed rather than stored raw). A sixth Form Request — or a seventh
 * field on an existing one — that adds an unguarded free-text field fails
 * THIS test, by name, without anyone having to rediscover the class of
 * bug by hand.
 */
function fegAllRequestClasses(): array
{
    $classes = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Http/Requests')));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $relative = str_replace(app_path().DIRECTORY_SEPARATOR, '', $file->getPathname());
        $class = 'App\\'.str_replace(['/', '.php'], ['\\', ''], $relative);
        if (class_exists($class) && is_subclass_of($class, FormRequest::class)) {
            $classes[] = $class;
        }
    }
    sort($classes);

    return $classes;
}

/**
 * (Request class => [field => reason]) — every field this test does NOT
 * require `encoding:UTF-8` on, and why its write path is safe without it.
 * Anything with a `string` rule and NOT listed here must carry the guard.
 */
function fegExemptions(): array
{
    return [
        LoginRequest::class => [
            'username' => 'a lookup key only (User::query()->where(...)) — proved live that an invalid-UTF-8 WHERE bind returns no match, never a QueryException, and this value is never written anywhere',
            'password' => 'compared via Hash::check() against a stored hash, never written to a column itself',
        ],
        StoreBookRequest::class => [
            'category_slug' => 'a lookup key only (Category::query()->where(\'slug\', ...)) — an unmatched slug throws category_not_found before CreateBook writes anything; proved live that the WHERE itself does not throw on invalid UTF-8',
        ],
        UpdateBookRequest::class => [
            'category_slug' => 'same lookup-only shape as StoreBookRequest',
        ],
        LendCopyRequest::class => [
            // Already carries the `uuid` rule, which is its own guard
            // (mb_check_encoding is redundant once a value has passed
            // Laravel's uuid format check) — not exempted by name, this
            // class is simply never reached by the sweep below because
            // its fields carry `uuid`, checked automatically.
        ],
        RegisterMembershipRequest::class => [
            'phone' => 'Registration::execute() runs it through Phone::assert() — a strict \d{9,11} regex — before any write; invalid UTF-8 fails that regex cleanly as phone_invalid, never reaching the INSERT',
            'password' => 'hashed via Hash::make() before storage, never written raw',
            'shelf' => 'a lookup key only (RegistrationController::resolveShelf() -> Bookshelf::query()->where(\'slug\', ...)) — same WHERE-only shape as category_slug',
            'parish_unit_l1_id' => 'validated by ParishUnits::validateSelection() against a Collection already loaded into memory (collect($units)->firstWhere(\'id\', $id)) — a plain PHP string comparison, not a DB bind, so invalid UTF-8 simply matches nothing and refuses as parish_unit_l1_not_found before Registration ever inserts it',
            'parish_unit_l2_id' => 'same in-memory ParishUnits::validateSelection() gate as parish_unit_l1_id',
        ],
        RegisterReaderOnBehalfRequest::class => [
            'phone' => 'same Phone::assert() gate as RegisterMembershipRequest',
            'parish_unit_l1_id' => 'same in-memory ParishUnits::validateSelection() gate as RegisterMembershipRequest',
            'parish_unit_l2_id' => 'same in-memory ParishUnits::validateSelection() gate as RegisterMembershipRequest',
        ],
        QuickLendRegisterReaderRequest::class => [
            'parish_unit_l1_id' => 'same in-memory ParishUnits::validateSelection() gate as RegisterMembershipRequest (this request feeds the identical Registration::execute())',
            'parish_unit_l2_id' => 'same in-memory ParishUnits::validateSelection() gate as RegisterMembershipRequest',
            'book' => 'a lookup key only (LendController resolves it via Book::query()->where(\'slug\', ...)) and is stripped via Arr::except() before RegisterMemberOnBehalf::execute() ever sees the array — it only ever also travels as a redirect route parameter, never a column write',
        ],
        ReceiveReturnRequest::class => [
            // `condition` carries `Rule::enum(CopyCondition::class)`
            // alongside the bare `string` rule — caught automatically by
            // the enum-rule check above, not listed here as a named
            // exemption (nothing to document beyond what that check says).
        ],
        SetReaderCredentialsRequest::class => [
            'password' => 'hashed via Hash::make() before storage, never written raw',
        ],
        UpdateReaderProfileRequest::class => [
            'phone' => 'same Phone::assert() gate as RegisterMembershipRequest',
            'date_of_birth' => 'ProfileFields::normalisePatch() regex-validates the Y-m-d shape (and checkdate()s it) before storage; invalid UTF-8 fails that regex cleanly as validation_failed, never reaching the UPDATE',
        ],
    ];
}

it('every free-text `string` field on every Form Request carries encoding:UTF-8, or is a documented exemption', function () {
    $exemptions = fegExemptions();
    $violations = [];

    foreach (fegAllRequestClasses() as $class) {
        /** @var FormRequest $instance */
        $instance = new $class;
        $rules = $instance->rules();

        foreach ($rules as $field => $ruleset) {
            $ruleset = is_array($ruleset) ? $ruleset : explode('|', (string) $ruleset);
            $flat = array_map(fn ($r) => is_string($r) ? $r : null, $ruleset);

            $hasString = in_array('string', $flat, true);
            if (! $hasString) {
                continue; // not a free-text field at all (uuid/integer/boolean/enum/date_format/email-only).
            }

            // `uuid` and `email` are their own charset guards — a value
            // that passes either format check is already ASCII, so
            // mb_check_encoding() on top would be redundant, not a hole.
            if (in_array('uuid', $flat, true) || in_array('email', $flat, true)) {
                continue;
            }

            // Rule::enum(...) is its own charset guard too — the value
            // must equal one of a fixed set of ASCII backing values or the
            // rule itself fails first (ReceiveReturnRequest's `condition`:
            // `['bail', 'required', 'string', Rule::enum(CopyCondition::class)]`).
            $hasEnumRule = (bool) array_filter($ruleset, fn ($r) => is_object($r) && str_contains($r::class, 'Enum'));
            if ($hasEnumRule) {
                continue;
            }

            $hasEncoding = in_array('encoding:UTF-8', $flat, true);
            if ($hasEncoding) {
                continue;
            }

            if (array_key_exists($class, $exemptions) && array_key_exists($field, $exemptions[$class])) {
                continue;
            }

            $violations[] = "{$class}::\${$field}";
        }
    }

    expect($violations)->toBe([]);
});

it('the exemption list itself only names fields that still exist on their Form Request', function () {
    // A field renamed or removed leaves a stale, unfalsifiable exemption
    // behind — this catches that drift so the exemption list stays a
    // living document of real, checked reasoning, not accumulating dead
    // entries nobody re-verifies.
    foreach (fegExemptions() as $class => $fields) {
        $rules = (new $class)->rules();
        foreach (array_keys($fields) as $field) {
            expect(array_key_exists($field, $rules))->toBeTrue("{$class}::\${$field} no longer has a rule — remove the stale exemption");
        }
    }
});
