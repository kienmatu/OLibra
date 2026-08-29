<?php

use Illuminate\Support\Facades\Gate;

/**
 * Task 3 review, should-fix 3. AppServiceProvider::boot() ends with five
 * Gate::policy() calls, and every one of them looked decorative: Laravel's
 * convention discovery (App\Models\X -> App\Policies\XPolicy) already finds
 * all five, so deleting any line leaves the whole suite green — measured,
 * 1071 passed with the BorrowRequest line removed.
 *
 * It is not decorative, and the measurement that shows it is the one that
 * moves the class instead of deleting the line: with
 * BorrowRequestPolicy in App\Policies\Circulation, discovery finds nothing
 * and the registration is the ONLY thing wiring the model (18 green with
 * the line, 5 red without). Renaming the class is caught immediately by
 * Larastan (class.notFound), and moving it is caught by this file; deleting
 * the line was the one hazard nothing caught, and a comment calling the
 * line redundant is an invitation to delete it.
 *
 * DERIVED, not transcribed. The list walks app/Policies rather than naming
 * the five, so policy number six is covered the day it lands instead of the
 * day somebody remembers this file — the "beware guards that cannot grow"
 * rule, applied to a census that would otherwise freeze at five.
 */
it('resolves every policy class under app/Policies for its model', function () {
    /** @var list<string> $files */
    $files = glob(app_path('Policies/*.php')) ?: [];

    // A walk with no matches passes vacuously; pin that the glob itself
    // still finds policies, so moving the directory fails loudly here.
    expect($files)->not->toBeEmpty();

    foreach ($files as $file) {
        $short = basename($file, '.php');
        $policy = 'App\\Policies\\'.$short;
        $model = 'App\\Models\\'.substr($short, 0, -strlen('Policy'));

        expect(class_exists($policy))->toBeTrue("missing policy class: {$policy}")
            ->and(class_exists($model))->toBeTrue("policy {$short} names no model {$model}");

        // getPolicyFor() answers with whatever actually wires the two —
        // an explicit Gate::policy() call or convention discovery. Either
        // is fine; NEITHER is the failure this catches.
        expect(Gate::getPolicyFor($model))
            ->toBeInstanceOf($policy, "no policy resolved for {$model}");
    }
});

it('covers every model that AppServiceProvider registers a policy for', function () {
    // The other direction, so a policy moved OUT of app/Policies (the exact
    // mutation that proves the registrations load-bearing) cannot vanish
    // from the walk above and take its coverage with it. Read off the
    // provider's source rather than a hand-kept list, for the same
    // grows-by-itself reason.
    $source = (string) file_get_contents(app_path('Providers/AppServiceProvider.php'));

    preg_match_all('/Gate::policy\(\s*([A-Za-z]+)::class/', $source, $matches);
    $registered = $matches[1];

    expect($registered)->not->toBeEmpty()
        ->and(count($registered))->toBe(count(array_unique($registered)), 'a model is registered twice');

    foreach ($registered as $short) {
        $model = 'App\\Models\\'.$short;

        expect(class_exists($model))->toBeTrue("registered policy names no model {$model}")
            ->and(Gate::getPolicyFor($model))->not->toBeNull("no policy resolved for {$model}");
    }
});
