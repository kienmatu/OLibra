<?php

use App\Exceptions\RuleViolated;
use App\Models\User;
use App\Support\Audit\AuditSecrets;

it('refuses every forbidden token, as a whole word inside a snake_case or camelCase key', function () {
    foreach (['password', 'password_hash', 'passwordHash', 'pwd', 'token', 'session_id',
        'secret', 'mat_khau', 'api_key', 'salt', 'otp', 'reset_token'] as $key) {
        expect(fn () => AuditSecrets::assertNoSecrets(null, [$key => 'x']))
            ->toThrow(RuleViolated::class);
    }
});

it('matches whole tokens only: avatar_object, monkey, keyboard all pass', function () {
    // 'key' as a token is forbidden; 'monkey'/'keyboard' contain it as a
    // substring and must pass — DATABASE.md records avatar_object being
    // NAMED to dodge exactly this list, so the port must split tokens the
    // same way.
    AuditSecrets::assertNoSecrets(['avatar_object' => null], ['monkey' => 1, 'keyboard' => 'qwerty']);
    expect(true)->toBeTrue();
});

it('allows the sanctioned metadata suffixes about a secret', function () {
    AuditSecrets::assertNoSecrets(null, [
        'password_changed_at' => '2026-08-29T00:00:00Z',
        'password_set_at' => '2026-08-29T00:00:00Z',
        'has_password' => true,
        'session_count' => 2,
    ]);
    expect(true)->toBeTrue();
});

it('walks nested objects and arrays — the reference\'s measured bypass', function () {
    expect(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => ['password_hash' => 'x']]))
        ->toThrow(RuleViolated::class)
        ->and(fn () => AuditSecrets::assertNoSecrets(null, ['changes' => [['password_hash' => 'x']]]))
        ->toThrow(RuleViolated::class)
        // A real PHP object, not an array: record() takes array<string,
        // mixed>, so a stdClass VALUE is legal and json_encodes with its
        // property names. An is_array-only walk misses it silently.
        ->and(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => (object) ['password_hash' => 'x']]))
        ->toThrow(RuleViolated::class);
});

it('walks an object nested inside an array nested inside an object', function () {
    // Three shapes deep, mixing both containers, because "arrays only" and
    // "objects only" are each single-hop lessons — this is the hop that
    // catches a walk which handles one container type at every level but
    // forgets to keep normalizing after descending into the other.
    $payload = (object) ['wrapper' => ['inner' => (object) ['token' => 'x']]];

    expect(fn () => AuditSecrets::assertNoSecrets(null, ['after' => $payload]))
        ->toThrow(RuleViolated::class);
});

it('an object with no public properties is not, by that fact alone, safe', function () {
    // get_object_vars() called from OUTSIDE the class only ever returns
    // PUBLIC properties — a property declared private or protected is
    // invisible to it regardless of what the object actually holds. A
    // plain non-JsonSerializable object with a private secret is honestly
    // safe here: json_encode() (what AuditLog's 'array' cast actually
    // calls to build the stored payload) applies the SAME "public
    // properties only" rule to a plain object, so the walk and the real
    // serialization agree — nothing to catch, nothing missed.
    $plain = new class
    {
        private string $password = 'not walked, and json_encode agrees';
    };

    AuditSecrets::assertNoSecrets(null, ['after' => $plain]);
    expect(true)->toBeTrue();
});

it('a JsonSerializable object is the real bypass an object-with-no-public-properties walk misses', function () {
    // Unlike a plain object, json_encode() does NOT apply the "public
    // properties only" rule to a JsonSerializable — it calls
    // jsonSerialize() instead and encodes whatever that returns, private
    // state included. get_object_vars() knows nothing about that method,
    // so a get_object_vars-only walk sees an empty array and lets this
    // through, while the 'array' cast that actually writes audit_log.after
    // calls json_encode() and puts password_hash in the database. Eloquent
    // Model implements JsonSerializable for exactly this reason — this is
    // the concrete shape of "a model" the walk must not miss.
    $leaky = new class implements JsonSerializable
    {
        private string $password_hash = 'leak';

        public function jsonSerialize(): mixed
        {
            return ['password_hash' => $this->password_hash];
        }
    };

    expect(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => $leaky]))
        ->toThrow(RuleViolated::class);
});

it('an Eloquent model value is walked through its actual JSON shape, not its private storage', function () {
    // The concrete "model" case: a real attribute set via the magic
    // __set lives in the model's PROTECTED $attributes array, invisible
    // to get_object_vars(), but Model::jsonSerialize() (via toArray())
    // puts it straight back into the payload the 'array' cast persists.
    $user = new User;
    $user->setRawAttributes(['session_id' => 'abc123']);

    expect(fn () => AuditSecrets::assertNoSecrets(null, ['after' => $user]))
        ->toThrow(RuleViolated::class);
});

it('names the two things it deliberately does not check', function () {
    // KEYS, not values: a secret pasted into an innocuous key is invisible
    // here and stays a code-review matter (the reference's own bound).
    AuditSecrets::assertNoSecrets(null, ['note' => 'mat-khau-123']);
    // And `context`, which AuditRecorder writes as [] on every path today,
    // is not walked — assertNoSecrets takes before/after only. The day a
    // command puts anything in context, this guard must grow a third
    // argument; recorded in docs/known-gaps.md so it is an addition, not
    // a rediscovery.
    expect(true)->toBeTrue();
});

it('every payload shape the 21 shipped writers produce passes', function () {
    // The exact key sets grepped from app/Actions at plan time. If a
    // command's payload changes, this list changes with it — that is the
    // point: the guard must never brick a shipped command. (The full
    // suite re-proves this end-to-end in Step 4, through the writers
    // themselves.)
    $shapes = [
        ['title', 'slug', 'author', 'category', 'isbn', 'isPublished', 'copyCodes'],
        ['code', 'bookId', 'state', 'acquiredOn', 'acquiredFrom', 'acquiredFromMembershipId'],
        ['condition', 'conditionNote'],
        ['state', 'reason'], ['state', 'note'],
        ['deletedAt', 'copiesDeleted', 'copiesRetained'],
        ['copy_state', 'borrower_id', 'membership_id', 'due_on', 'title', 'request_id'],
        ['status', 'copy_state', 'condition', 'title', 'borrower_id'],
        ['due_on', 'renewals_used'],
        ['status', 'copy_state', 'reason'], ['status'],
        ['userId', 'fullName', 'status', 'parishUnitL1Id', 'parishUnitL2Id'],
        ['saint_name', 'full_name', 'date_of_birth', 'father_name', 'mother_name',
            'phone', 'phone_missing_reason', 'email', 'avatar_object'],
    ];
    foreach ($shapes as $keys) {
        AuditSecrets::assertNoSecrets(null, array_fill_keys($keys, 'v'));
    }
    expect(true)->toBeTrue();
});
