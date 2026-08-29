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

it('an ArrayObject is walked through its actual JSON shape, not get_object_vars', function () {
    // ArrayObject/ArrayIterator implement neither JsonSerializable nor
    // expose their storage via get_object_vars() (it is internal to the
    // engine, invisible even from outside the class) — but json_encode()
    // hard-codes both classes as special cases and serialises their
    // CONTENTS directly. json_encode(new ArrayObject(['password_hash' =>
    // 'x'])) emits {"password_hash":"x"}; the old get_object_vars/
    // jsonSerialize-only walk saw an empty array and let it through.
    expect(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => new ArrayObject(['password_hash' => 'x'])]))
        ->toThrow(RuleViolated::class)
        ->and(fn () => AuditSecrets::assertNoSecrets(null, ['credentials' => new ArrayIterator(['token' => 'x'])]))
        ->toThrow(RuleViolated::class);
});

it('an ArrayObject with no forbidden key still passes, proving the walk actually descends', function () {
    // The positive half of the ArrayObject case: an inert instance must
    // not become forbidden just by being an ArrayObject.
    AuditSecrets::assertNoSecrets(null, ['note' => new ArrayObject(['title' => 'Dế Mèn'])]);
    expect(true)->toBeTrue();
});

it('refuses a payload seven arrays deep instead of silently letting it through', function () {
    // Depth 0..6 is seven levels and must still pass; depth 7 is the first
    // one this file's own docstring says is refused. Built with the
    // forbidden key at the very bottom, past where the OLD depth cap
    // (`> 6` returning quietly) stopped looking — a payload this shape
    // used to sail past the guard while json_encode() still persisted
    // password_hash.
    $bag = ['password_hash' => 'x'];
    for ($i = 0; $i < 7; $i++) {
        $bag = ['wrap' => $bag];
    }

    expect(fn () => AuditSecrets::assertNoSecrets(null, $bag))
        ->toThrow(RuleViolated::class, 'audit_nesting_too_deep');
});

it('still allows six levels of ordinary array nesting', function () {
    // The boundary's other side: depth 6 is the documented, sanctioned
    // limit and must not be refused just for existing.
    $bag = ['clean' => 'v'];
    for ($i = 0; $i < 6; $i++) {
        $bag = ['wrap' => $bag];
    }

    AuditSecrets::assertNoSecrets(null, $bag);
    expect(true)->toBeTrue();
});

it('refuses a five-hop object chain instead of silently letting it through', function () {
    // The reference's other fail-open hole, now folded into the same
    // array-depth cap above: a JsonSerializable handing back another
    // JsonSerializable, five hops deep, used to escape the old 4-hop
    // toWalkable() cap entirely (it just stopped converting and returned
    // an object the walk's is_array() check then ignored). json_encode()
    // recurses through the whole chain in one call, so this is now caught
    // by the ordinary depth-6 refusal.
    $leaf = ['password' => 'x'];
    for ($i = 0; $i < 5; $i++) {
        $inner = $leaf;
        $leaf = new class($inner) implements JsonSerializable
        {
            public function __construct(private mixed $inner) {}

            public function jsonSerialize(): mixed
            {
                return $this->inner;
            }
        };
    }

    expect(fn () => AuditSecrets::assertNoSecrets(null, ['chain' => $leaf]))
        ->toThrow(RuleViolated::class);
});

it('every payload shape a shipped writer produces passes', function () {
    // The key sets grepped from app/Actions. If a command's payload
    // changes, this list changes with it — that is the point: the guard
    // must never brick a shipped command. (The full suite re-proves this
    // end-to-end, through the writers themselves; this block is the cheap
    // unit-level echo of it, not the guarantee.)
    //
    // The title used to carry a writer COUNT and the count went stale the
    // moment Phase 2a added the request commands — the failure mode this
    // branch names as "stop counting". The property is what matters: every
    // shape below is one a shipped ->record() call can produce.
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
        // Phase 2a's request writers, added by the wrap-up sweep: the list
        // had carried no request.* shape at all since Task 4, so the guard
        // was being re-proved against a catalogue that predated the phase.
        // The after bags of request.created, .approved, .rejected,
        // .cancelled, .expired and .fulfilled. The before bags need no row
        // of their own: each is a subset of an after bag already listed
        // here (status/copy_id, status, status/copy_id/fulfilled_loan_id),
        // and AuditSecrets judges keys, not values.
        ['status', 'book_id', 'copy_id', 'title', 'userId', 'membership_id'],
        ['status', 'copy_id', 'hold_expires_at', 'userId'],
        ['status', 'title', 'userId', 'reason'],
        ['status', 'title', 'released_copy_id'],
        ['status', 'copy_id', 'title', 'userId'],
        ['status', 'copy_id', 'fulfilled_loan_id'],
    ];
    foreach ($shapes as $keys) {
        AuditSecrets::assertNoSecrets(null, array_fill_keys($keys, 'v'));
    }
    expect(true)->toBeTrue();
});
