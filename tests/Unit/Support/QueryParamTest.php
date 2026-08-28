<?php

use App\Support\QueryParam;
use Illuminate\Http\Request;

// Fix round, Task 13: input()'s own regression pin, direct at the unit
// level rather than only through the register feature tests. Request::
// create() needs no container, so this is a plain Unit test (tests/
// Pest.php only auto-attaches Feature to TestCase — see PhoneTest's
// identical note).
it('input() flattens an array field the same way first() flattens a repeated query key', function () {
    $request = Request::create('/x', 'POST', ['phone' => ['0912345678', '0999999999']]);

    expect(QueryParam::input($request, 'phone'))->toBe('0912345678');
});

it('input() walks a nested array to its leftmost scalar', function () {
    $request = Request::create('/x', 'POST', ['phone' => ['a' => ['b' => '09']]]);

    expect(QueryParam::input($request, 'phone'))->toBe('09');
});

it('input() resolves an empty array to the default, same as an absent key', function () {
    $request = Request::create('/x', 'POST', ['phone' => []]);

    expect(QueryParam::input($request, 'phone'))->toBeNull()
        ->and(QueryParam::input($request, 'phone', 'fallback'))->toBe('fallback')
        ->and(QueryParam::input($request, 'missing', 'fallback'))->toBe('fallback');
});

it('input() reads the request body, not only the query string', function () {
    $request = Request::create('/x?phone=from-query', 'POST', ['phone' => 'from-body']);

    // Symfony's ParameterBag merge for input() prefers the parsed request
    // body over the query string for the same key — the exact difference
    // from first(), which reads $request->query() alone and would see
    // "from-query" here instead.
    expect(QueryParam::input($request, 'phone'))->toBe('from-body')
        ->and(QueryParam::first($request, 'phone'))->toBe('from-query');
});
