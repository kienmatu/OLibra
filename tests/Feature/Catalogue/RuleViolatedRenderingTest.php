<?php

use App\Exceptions\RuleViolated;
use Illuminate\Support\Facades\Route;

it('renders a RuleViolated as a redirect back with the translated sentence', function () {
    Route::middleware('web')->post('/_test/rule-violated', function () {
        throw new RuleViolated('duplicate_isbn');
    });

    $response = $this->from('/shelves')->post('/_test/rule-violated');

    $response->assertRedirect('/shelves');
    $response->assertSessionHasErrors(['rule' => 'Mã ISBN này đã tồn tại trong tủ sách.']);
});

it('renders required-field validation in Vietnamese, not as a raw key', function () {
    // The known-gaps entry this task closes: with APP_LOCALE=vi and
    // APP_FALLBACK_LOCALE=vi, a missing lang/vi/validation.php renders the
    // literal string "validation.required". This test fails while that
    // file is absent and passes once it exists — delete the file to see it
    // red.
    expect(__('validation.required', ['attribute' => 'tiêu đề']))
        ->not->toBe('validation.required')
        ->toBe('Vui lòng nhập tiêu đề.');
});
