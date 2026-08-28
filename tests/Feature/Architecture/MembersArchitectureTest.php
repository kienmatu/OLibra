<?php

use App\Actions\Members\ManagerRegisterReader;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

it('ManagerRegisterReader is wired to NO route — 1c\'s quick-lend is its screen', function () {
    // The DeleteBook precedent: implemented and tested, and adding the
    // route is a DECISION (with the plan-header open question 1 attached),
    // not an accident. No controller may reference the Action at all —
    // stronger than walking the route table, which only sees wired methods.
    $hits = [];
    foreach (glob(app_path('Http/Controllers/{,*/}*.php'), GLOB_BRACE) ?: [] as $file) {
        if (str_contains((string) file_get_contents($file), 'ManagerRegisterReader')) {
            $hits[] = $file;
        }
    }

    expect($hits)->toBe([])
        ->and(class_exists(ManagerRegisterReader::class))->toBeTrue();
});

it('readers/create is declared before readers/{reader}, or "create" binds as an id', function () {
    // Spec §6's route-order rule, the readers half. Matching the literal
    // path must select the create route, not the binding.
    $request = Request::create('/shelves/dong-thap/manage/readers/create', 'GET');
    $route = Route::getRoutes()->match($request);

    expect($route->getName())->toBe('shelves.manage.readers.create');
});

it('only the three sanctioned Actions write a credential or profile column on users', function () {
    // The Laravel form of the reference's INV-13 source walk: profile and
    // credential writes are named, enumerated, and anything new must join
    // this list deliberately.
    $sanctioned = [
        app_path('Actions/Members/Registration.php'),
        app_path('Actions/Members/SetReaderCredentials.php'),
        app_path('Actions/Members/UpdateReaderProfile.php'),
    ];

    $writers = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path()));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $source = (string) file_get_contents($file->getPathname());
        // Three write shapes, because the slice uses all three and a
        // regex that only knows the literal-property one would (a) miss
        // UpdateReaderProfile, whose write is `$person->{$field} = …`,
        // and (b) be trivially bypassed by anything spelling it
        // dynamically. Named columns, dynamic properties, and any
        // query-builder update against `users`.
        //
        // FIX (Task 16 sweep): the brief's own dynamic-property regex —
        // `->\s*\{\s*\$\w+\s*\}\s*=` with no variable-name anchor — is a
        // false-positive machine, not a pin. `App\Actions\Catalogue\
        // UpdateBook::execute()` writes `$book->{$field} = $value` (a
        // Book, never a users-table column) and matched it outright,
        // confirmed live: this test failed with UpdateBook flagged
        // alongside the three sanctioned files before this fix, and a
        // container-run sweep of the whole `app/` tree found exactly two
        // files using dynamic-property-write syntax at all — this one and
        // UpdateReaderProfile. `$person` is this slice's own established
        // name for the `User` instance being written (SetReaderCredentials
        // and UpdateReaderProfile both bind it that way); anchoring the
        // regex to that variable keeps the UpdateReaderProfile catch
        // (verified below by reverting to the unanchored form and
        // re-running: UpdateBook reappears) while dropping the
        // cross-domain false hit.
        $writes = preg_match('/->\s*(password_hash|username)\s*=[^=]/', $source) === 1
            || preg_match('/\$person\s*->\s*\{\s*\$\w+\s*\}\s*=[^=]/', $source) === 1
            || preg_match("/DB::table\(\s*'users'\s*\)|User::query\(\)[^;]*->\s*update\(/s", $source) === 1;

        if ($writes) {
            $writers[] = $file->getPathname();
        }
    }

    sort($writers);
    sort($sanctioned);
    expect($writers)->toBe($sanctioned);
});

it('every RuleViolated code thrown by the members slice has a Vietnamese sentence', function () {
    $codes = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path()));
    foreach ($files as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        if (! str_contains($file->getPathname(), 'Members')) {
            continue;
        }
        preg_match_all("/RuleViolated\\('([a-z0-9_\\-]+)'\\)/", (string) file_get_contents($file->getPathname()), $m);
        foreach ($m[1] as $code) {
            $codes[$code] = true;
        }
    }

    // Plus the codes returned as data rather than thrown directly.
    foreach (['not_active_cannot_suspend', 'not_suspended_cannot_reactivate', 'registration_not_pending',
        'parish_unit_l1_not_found', 'parish_unit_l2_not_found', 'parish_unit_l2_not_in_l1'] as $code) {
        $codes[$code] = true;
    }

    expect($codes)->not->toBe([]);
    foreach (array_keys($codes) as $code) {
        expect(__('rules.'.$code))->not->toBe('rules.'.$code, $code);
    }
});

it('the ten OPS §4.3 commands of this phase exist as final Action classes', function () {
    // The census, pinned: OPS §4.3 has 17 entries — 16 live, 1 retired.
    // These ten are 1b's; the six others are Phase 3's (five
    // profile-change lifecycle + ChangeOwnPassword with the profile page),
    // and UpdateOwnProfile is retired with nothing to port.
    $commands = [
        'RegisterMembership', 'ManagerRegisterReader', 'RegisterMemberOnBehalf',
        'ApproveMembership', 'RejectMembership', 'SuspendMembership',
        'ReactivateMembership', 'MarkMembershipLeft', 'SetReaderCredentials',
        'UpdateReaderProfile',
    ];

    foreach ($commands as $command) {
        $class = 'App\\Actions\\Members\\'.$command;
        expect(class_exists($class))->toBeTrue($command)
            ->and(new ReflectionClass($class)->isFinal())->toBeTrue($command);
    }
});
