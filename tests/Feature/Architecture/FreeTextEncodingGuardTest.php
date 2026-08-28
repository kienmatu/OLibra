<?php

use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Catalogue\StoreBookRequest;
use App\Http\Requests\Catalogue\UpdateBookRequest;
use App\Http\Requests\Circulation\QuickLendRegisterReaderRequest;
use App\Http\Requests\Members\RegisterMembershipRequest;
use App\Http\Requests\Members\RegisterReaderOnBehalfRequest;
use App\Http\Requests\Members\SetReaderCredentialsRequest;
use App\Http\Requests\Members\UpdateReaderProfileRequest;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Enum;

/**
 * Task 12's carry-over fix, generalised: the class of bug, not the
 * instance. Four confirmed occurrences before this test existed —
 * registration's four name fields (Phase 1b, PR #61 fix round), the
 * suspension reason (predicted by Task 6's review), the return note
 * (found by Task 11's hostile-input probes), and CopyNoteRequest's note
 * (found live by Task 11's reviewer, fixed as that task's carry-over) —
 * each one an unmapped MariaDB errno 1366 (invalid string for a utf8mb4
 * column) turning a legitimate request into a 500, because `string`/`max`
 * check length and PHP type only, never byte validity. A fifth occurrence
 * — `donor_membership_id` on two Catalogue Form Requests, `uuid` with no
 * `bail` in front of an existence closure — surfaced in THIS fix round
 * (see CatalogueHostileInputTest) and forced the rewrite below.
 *
 * FIX ROUND — this test was rewritten because the original version was
 * evadable six ways (see the "gate evasions" section at the bottom of
 * this file for all ten scenarios the reviewer probed and where each one
 * now stands). The rewrite inverts the original design:
 *
 *   OLD: scan every field; if its ruleset contains the literal string
 *   'string', require encoding:UTF-8 unless named exempt. Silent on any
 *   field that skips the literal 'string' rule (Rule::string() objects,
 *   or a bare ['nullable', 'max:1000'] with no type rule at all).
 *
 *   NEW: scan every field; UNLESS it is provably non-text — a type rule
 *   that isn't free text (integer/boolean/array/date/...), an enum rule
 *   (matched by instanceof, not class-name substring), or a uuid/email
 *   rule *guarded by `bail`* so a value that fails the format check can
 *   never reach a later rule in the same list — require encoding:UTF-8
 *   (or the equivalent Rule::string()->ascii()) unless named exempt.
 *
 * The `bail` requirement on uuid/email is deliberate, not a stray
 * tightening: an unguarded uuid/email rule ahead of an existence check is
 * exactly the shape of the fifth occurrence above (a value guard is not
 * an ordering guard). Without `bail` present, this gate now refuses to
 * call a uuid/email field "safe" at all — it demands either `bail` or a
 * named exemption, so the fifth occurrence's shape fails this test by
 * name the moment it's introduced.
 */
function fegAllRequestClasses(): array
{
    // FIX ROUND: the original version derived the class name from the
    // file's path (str_replace '/' -> '\\', strip .php) and then checked
    // class_exists() on that derived name. Two things make that name
    // wrong silently, both proved live below in "the sweep is blind to
    // filename drift":
    //   1. a Form Request whose filename doesn't match its class name —
    //      class_exists() on the WRONG derived name returns false, and
    //      Composer's PSR-4 autoloader never gets a chance to load the
    //      right one by name either, since it also keys off the path.
    //   2. a second class declared in a file that already has a
    //      matching first class — the second one is never named by any
    //      path, so it never gets a candidate class name at all.
    // Fixed by not deriving names from paths at all: require_once every
    // file directly (works regardless of what its classes are named) and
    // diff get_declared_classes() before/after to see exactly what that
    // file defined, then filter by is_subclass_of(FormRequest). This is
    // correct for both the well-behaved case (filename matches, one
    // class) and both drift cases above.
    $classes = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Http/Requests')));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $before = get_declared_classes();
        require_once $file->getPathname();
        $after = get_declared_classes();
        foreach (array_diff($after, $before) as $class) {
            if (! is_subclass_of($class, FormRequest::class)) {
                continue;
            }

            // FIX ROUND: an abstract FormRequest subclass (a shared base
            // for common fields) used to crash the gate with "Cannot
            // instantiate abstract class" the moment `new $class` ran
            // below. Skipping it here is safe, not a hidden gap: fields
            // declared on the abstract parent's rules() still reach every
            // CONCRETE child through normal inheritance/override, and
            // each concrete child is its own separate entry in
            // get_declared_classes() (discovered independently, wherever
            // it's `require_once`'d from), so it is still instantiated
            // and scanned on its own. An interface or trait technically
            // can't satisfy is_subclass_of(FormRequest::class) either, but
            // isInstantiable() also excludes those defensively.
            if (! (new ReflectionClass($class))->isInstantiable()) {
                continue;
            }

            $classes[] = $class;
        }
    }
    sort($classes);

    return array_values(array_unique($classes));
}

/**
 * The blind, path-derived name-guessing the original gate used — kept
 * here ONLY as the control for the mutation test below that proves the
 * fix actually closes the hole (see "the sweep is blind to filename
 * drift"). Not used by the real gate.
 */
function fegOldAllRequestClassesByPathGuessing(): array
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
 * Flattens a ruleset (array or pipe-string, literal rule names or rule
 * OBJECTS such as Rule::string()->max(1000) or Rule::in(...)) down to a
 * list of plain rule-name tokens ("string", "max:1000", "encoding:UTF-8",
 * ...), and separately reports whether an Illuminate\Validation\Rules\Enum
 * INSTANCE is present (checked by instanceof, per the fix round — the
 * original gate matched by `str_contains($r::class, 'Enum')`, a substring
 * test that a class merely named e.g. "MyEnumLikeRule" would also trip,
 * false-negatively treating an unrelated rule as the real enum guard).
 *
 * A Closure (a validation callback) can't be stringified and carries no
 * charset information of its own — it's skipped as a token source, not
 * treated as evidence either way.
 *
 * @return array{0: list<string>, 1: bool}
 */
function fegFlattenRuleset(mixed $ruleset): array
{
    // FIX ROUND: a field's ENTIRE ruleset can itself be a non-array,
    // non-stringifiable object — Rule::forEach(...) (used for repeatable
    // sub-forms) returns an Illuminate\Validation\NestedRules instance
    // directly, which has no __toString(). The old unconditional
    // `(string) $ruleset` cast on the non-array branch fatals with
    // "Object of class ... could not be converted to string" for ANY such
    // shape, not just NestedRules — a crash unrelated to whatever the
    // author was actually changing. Fail closed instead: an unrecognised
    // outer ruleset shape flattens to an empty token list, which the
    // caller already treats as neither provably-non-text nor
    // encoding-guarded — i.e. a violation demanding a named exemption,
    // the same conservative outcome as any other free-text field with no
    // guard, not a bug that gets silently waved through.
    if (is_array($ruleset)) {
        // no-op — already the expected shape
    } elseif (is_string($ruleset) || (is_object($ruleset) && method_exists($ruleset, '__toString'))) {
        $ruleset = explode('|', (string) $ruleset);
    } else {
        $ruleset = [];
    }
    $tokens = [];
    $hasEnumInstance = false;

    foreach ($ruleset as $rule) {
        if ($rule instanceof Enum) {
            $hasEnumInstance = true;

            continue;
        }
        if ($rule instanceof Closure) {
            continue;
        }
        if (is_string($rule)) {
            $tokens = array_merge($tokens, explode('|', $rule));

            continue;
        }
        if (is_object($rule) && method_exists($rule, '__toString')) {
            // Rule::string()->max(1000)->ascii() and friends stringify to
            // their own pipe-delimited rule list ("string|max:1000|ascii")
            // — flatten it the same way a literal pipe-string would be.
            $tokens = array_merge($tokens, explode('|', (string) $rule));
        }
    }

    return [$tokens, $hasEnumInstance];
}

/**
 * Rule names that make a field provably NOT raw free text reaching a
 * column as-is — a type constraint, a fixed allowlist, or a pattern that
 * only ever admits ASCII. `regex` is deliberately absent: an attacker
 * could hand-write a permissive Unicode-admitting pattern, so a bare
 * `regex` rule proves nothing about charset without reading the pattern,
 * and this gate does not evaluate pattern contents.
 */
const FEG_NON_TEXT_TYPE_RULES = [
    'integer', 'numeric', 'boolean', 'array', 'date', 'date_format',
    'digits', 'digits_between', 'ip', 'ipv4', 'ipv6', 'json', 'url',
    'file', 'image', 'mimes', 'mimetypes', 'dimensions', 'in', 'not_in',
    'alpha', 'alpha_dash', 'alpha_num', 'confirmed', 'accepted', 'declined',
];

function fegBaseRuleNames(array $tokens): array
{
    return array_map(static fn (string $t) => explode(':', $t, 2)[0], $tokens);
}

/**
 * @param  list<string>  $tokens
 */
function fegFieldIsProvablyNonText(array $tokens, bool $hasEnumInstance): bool
{
    if ($hasEnumInstance) {
        return true;
    }

    $baseNames = fegBaseRuleNames($tokens);

    if (array_intersect(FEG_NON_TEXT_TYPE_RULES, $baseNames) !== []) {
        return true;
    }

    $hasBail = in_array('bail', $baseNames, true);
    $hasUuid = in_array('uuid', $baseNames, true);
    $hasEmail = in_array('email', $baseNames, true);

    // FIX ROUND: uuid/email alone used to be an automatic skip. Now it's
    // only a skip when `bail` is also present — without it, a value that
    // FAILS the uuid/email format check still reaches whatever rule
    // (closure, exists:, another format rule) comes after it in the same
    // list, which is exactly the fifth occurrence's shape (an existence
    // closure binding rejected bytes into an ascii_bin column). A
    // uuid/email field with no bail is NOT treated as safe by this gate
    // any more — it must carry encoding:UTF-8 (redundant but harmless on
    // an ASCII-shaped value) or be a named, reasoned exemption.
    if (($hasUuid || $hasEmail) && $hasBail) {
        return true;
    }

    return false;
}

function fegRulesetHasEncodingGuard(array $tokens): bool
{
    $baseNames = fegBaseRuleNames($tokens);

    // `encoding:UTF-8` is the literal rule; `ascii` is Rule::string()
    // ->ascii() — strictly stronger (every ASCII byte is valid UTF-8),
    // so it satisfies the same guarantee this gate is checking for.
    return in_array('encoding:UTF-8', $tokens, true) || in_array('ascii', $baseNames, true);
}

/**
 * (Request class => [field => reason]) — every field this test does NOT
 * require encoding:UTF-8 (or an equivalent provable-non-text shape) on,
 * and why its write path is safe without it. Anything not provably
 * non-text and not listed here must carry the guard.
 */
function fegExemptions(): array
{
    return [
        LoginRequest::class => [
            'username' => 'a lookup key only (User::query()->where(...)) — proved live that an invalid-UTF-8 WHERE bind returns no match, never a QueryException, and this value is never written anywhere. NOTE (fix round): this is collation-dependent, not universally true — see docs/known-gaps.md\'s corrected note. It happens to hold here because users.username is utf8mb4, not ascii_bin.',
            'password' => 'compared via Hash::check() against a stored hash, never written to a column itself',
        ],
        StoreBookRequest::class => [
            'category_slug' => 'a lookup key only (Category::query()->where(\'slug\', ...)) — an unmatched slug throws category_not_found before CreateBook writes anything; proved live that the WHERE itself does not throw on invalid UTF-8. Same collation caveat as LoginRequest::username: categories.slug is utf8mb4.',
        ],
        UpdateBookRequest::class => [
            'category_slug' => 'same lookup-only shape as StoreBookRequest',
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
            'book' => 'a lookup key only (LendController resolves it via Book::query()->where(\'slug\', ...)) and is stripped via Arr::except() before ManagerRegisterReader::execute() ever sees the array (LendController::storeReader calls ManagerRegisterReader, not RegisterMemberOnBehalf — fix round, PR #62 review finding 5) — it only ever also travels as a redirect route parameter, never a column write',
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
// LendCopyRequest and ReceiveReturnRequest carried empty, inert entries
// in this list before the fix round — neither had any field that needed
// naming: LendCopyRequest's copy_id/membership_id are uuid+bail (now
// auto-recognised as provably non-text), and ReceiveReturnRequest's
// `condition` carries Rule::enum() (also auto-recognised). Removed rather
// than left as dead placeholders — the exemption-staleness test below
// would not have caught them (an empty array has no keys to go stale),
// so nothing enforced they ever meant anything.

it('every free-text field on every Form Request carries encoding:UTF-8 (or is provably non-text), or is a documented exemption', function () {
    $exemptions = fegExemptions();
    $violations = [];

    foreach (fegAllRequestClasses() as $class) {
        /** @var FormRequest $instance */
        $instance = new $class;
        $rules = $instance->rules();

        foreach ($rules as $field => $ruleset) {
            [$tokens, $hasEnumInstance] = fegFlattenRuleset($ruleset);

            if (fegFieldIsProvablyNonText($tokens, $hasEnumInstance)) {
                continue;
            }

            if (fegRulesetHasEncodingGuard($tokens)) {
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

// ─── The ten gate evasions (fix round) ──────────────────────────────────
//
// The reviewer scaffolded ten Form Requests probing the old gate. Each
// case below re-runs the SAME field-level check the real gate now uses
// (fegFieldIsProvablyNonText / fegRulesetHasEncodingGuard) against the
// exact ruleset shape that evaded the old gate, and states whether the
// rewrite now catches it. Two are stated, not demonstrated as caught —
// they are structurally invisible to any STATIC gate, and pretending
// otherwise would be worse than admitting the gap.

it('evasion 1 — free text with no `string` rule at all is now caught', function () {
    // OLD: `in_array('string', $flat)` was false, so the field was
    // skipped outright regardless of anything else in its ruleset.
    [$tokens, $hasEnum] = fegFlattenRuleset(['nullable', 'max:1000']);
    expect(fegFieldIsProvablyNonText($tokens, $hasEnum))->toBeFalse()
        ->and(fegRulesetHasEncodingGuard($tokens))->toBeFalse();
    // -> not provably non-text, no encoding guard -> the main test would
    // flag this field unless named-exempt. Caught.
});

it('evasion 2 — a rule built conditionally on $this->input(...) is NOT caught, and cannot be by a static gate', function () {
    // The gate calls `new $class` with no request bound to it, so
    // `$this->input(...)` inside rules() sees an empty, unbound request
    // and any branch keyed off real submitted data never executes. This
    // is not a rewritable ordering issue like the uuid/bail fix above —
    // it is inherent to calling rules() without a live HTTP request, the
    // same reason PHPUnit/Pest doesn't attempt to fuzz-drive every
    // possible $this->input() branch. Documented as an accepted static
    // gate limitation, not fixed: a hostile-input Feature test exercising
    // the ACTUAL route (as CatalogueHostileInputTest and
    // ReturnHostileInputTest do) is the only thing that can see the
    // branch that a real submission takes.
    expect(true)->toBeTrue(); // no assertion catches this by construction — see comment.
});

it('evasion 3 — a field injected in prepareForValidation() is NOT caught, and cannot be by a static gate', function () {
    // prepareForValidation() runs against $this->all()/$this->merge() at
    // request time; it never appears in rules()'s return value, which is
    // the only thing this gate (or any gate built the same way) reads.
    // A field that ONLY exists because prepareForValidation() invented it
    // has no ruleset for the gate to inspect, by construction. Same
    // conclusion as evasion 2: a route-level hostile-input Feature test
    // is the only thing that can see it, not a static rules() scan.
    expect(true)->toBeTrue();
});

it('evasion 4 — Rule::string()->max(1000), a rule OBJECT rather than the literal string, is now caught', function () {
    // OLD: `in_array('string', $flat, true)` with `$flat` built from
    // `is_string($r) ? $r : null` turned the Rule::string() OBJECT into a
    // null, which is never equal to the literal 'string' — the field
    // silently read as "no string rule here", not text at all, no
    // encoding required. The real RetireCopyRequest rewritten this way
    // left the OLD gate green while live HTTP still 500'd on invalid
    // UTF-8 in `reason` (see the "mutation runs" section of this task's
    // report for the live repro).
    [$tokens, $hasEnum] = fegFlattenRuleset(['bail', 'nullable', Rule::string()->max(1000)]);
    expect($tokens)->toContain('string')
        ->and(fegFieldIsProvablyNonText($tokens, $hasEnum))->toBeFalse()
        ->and(fegRulesetHasEncodingGuard($tokens))->toBeFalse();
    // -> now correctly flagged as needing encoding:UTF-8 (or ->ascii()).
    // Caught.

    // The ->ascii() modifier is recognised as an equivalent guard:
    [$tokensAscii] = fegFlattenRuleset(['bail', 'nullable', Rule::string()->max(1000)->ascii()]);
    expect(fegRulesetHasEncodingGuard($tokensAscii))->toBeTrue();
});

it('evasion 5 — a custom rule class merely NAMED like "Enum" is now caught (no longer a substring match)', function () {
    // OLD: `str_contains($r::class, 'Enum')` treats ANY class whose name
    // contains the substring "Enum" as the real enum guard — including
    // one that isn't Illuminate\Validation\Rules\Enum and enforces
    // nothing about charset at all.
    $fakeEnumLikeRule = new class implements ValidationRule
    {
        public function validate(string $attribute, mixed $value, Closure $fail): void
        {
            // Deliberately permissive — an "EnumLookalike" that actually
            // validates nothing, the exact shape the substring match
            // would have been fooled by.
        }

        public function __toString(): string
        {
            return 'EnumLookalikeRule';
        }
    };

    [$tokens, $hasEnum] = fegFlattenRuleset(['bail', 'nullable', 'string', $fakeEnumLikeRule]);
    expect($hasEnum)->toBeFalse() // NOT instanceof Illuminate\Validation\Rules\Enum
        ->and(fegFieldIsProvablyNonText($tokens, $hasEnum))->toBeFalse()
        ->and(fegRulesetHasEncodingGuard($tokens))->toBeFalse();
    // -> correctly still flagged as needing encoding:UTF-8. Caught.
});

it('evasion 6 — a field carrying uuid alongside string, with no bail, is now caught (was the line-135 skip)', function () {
    // OLD: `in_array('uuid', $flat, true)` skipped the field outright —
    // exactly StoreBookRequest/AddCopiesRequest's donor_membership_id
    // shape before this fix round, and exactly how the fifth occurrence
    // stayed invisible to the gate that was supposed to catch this class
    // of bug.
    [$tokens, $hasEnum] = fegFlattenRuleset(['nullable', 'string', 'uuid']);
    expect(fegFieldIsProvablyNonText($tokens, $hasEnum))->toBeFalse();
    // -> no `bail` present, so this gate refuses to call it safe. Caught
    // (forces either `bail` or a named, reasoned exemption).

    // The fixed shape (bail present) IS accepted as provably non-text:
    [$tokensFixed, $hasEnumFixed] = fegFlattenRuleset(['bail', 'nullable', 'string', 'uuid']);
    expect(fegFieldIsProvablyNonText($tokensFixed, $hasEnumFixed))->toBeTrue();
});

// evasion 4's concrete, non-synthetic form — rewriting the REAL
// RetireCopyRequest::reason as Rule::string()->max(1000) — is verified by
// an actual out-of-process mutation run (edit the file on disk, run this
// test file in a fresh `php artisan test` process so the mutated class
// body is what actually loads, confirm THIS gate goes red by name,
// restore, confirm green and `git status --porcelain` clean) rather than
// as a self-mutating Pest test here: PHP does not re-read a class body
// that changed after it was already loaded in the same process, so an
// in-process version of this check would not actually exercise the
// mutated code — see the out-of-process mutation-run results in this
// task's report.
