<?php

use App\Support\Qr\LabelPayload;
use Illuminate\Support\Str;

it('round-trips a uuid through the payload', function () {
    $uuid = (string) Str::uuid();

    expect(LabelPayload::uuidFrom(LabelPayload::encode($uuid)))->toBe($uuid);
});

it('encodes to the prefix plus exactly 22 unpadded base64url characters', function () {
    $payload = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');

    expect($payload)->toStartWith('OLB1:')
        ->and(strlen($payload))->toBe(27)
        ->and(substr($payload, 5))->toMatch('/^[A-Za-z0-9_-]{22}$/')
        ->and($payload)->not->toContain('=');
});

it('refuses a future format by name rather than decoding it into a wrong uuid', function () {
    // The whole reason the version prefix exists. An OLB2 payload must come
    // back as null, NOT as some uuid derived from bytes meant for another
    // format — a wrong copy is worse than an unreadable label.
    $olb1 = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');
    $olb2 = 'OLB2:'.substr($olb1, 5);

    expect(LabelPayload::uuidFrom($olb2))->toBeNull();
});

it('refuses rubbish, a bare uuid, an empty string and a truncated payload', function (string $input) {
    expect(LabelPayload::uuidFrom($input))->toBeNull();
})->with([
    'empty' => [''],
    'rubbish' => ['hello'],
    // A bare uuid is NOT a payload. Accepting one would mean a QR carrying
    // plain uuid text silently worked, and the format version would stop
    // being a guarantee.
    'bare uuid' => ['0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f'],
    'prefix only' => ['OLB1:'],
    'truncated body' => ['OLB1:njd5uYXrSmuisq41J9Tr'],
    'body with padding' => ['OLB1:njd5uYXrSmuisq41J9TrLw=='],
    'wrong alphabet' => ['OLB1:njd5uYXrSmuisq41J9Tr+w'],
]);

it('is case-sensitive about its prefix', function () {
    $olb1 = LabelPayload::encode('0191f1e3-0f7a-7c31-9b2e-6a4b1d2c3e4f');

    expect(LabelPayload::uuidFrom('olb1:'.substr($olb1, 5)))->toBeNull();
});
