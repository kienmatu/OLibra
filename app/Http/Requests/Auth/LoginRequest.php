<?php

namespace App\Http\Requests\Auth;

use App\Models\User;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LoginRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, string>> */
    public function rules(): array
    {
        return [
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ];
    }

    /**
     * Username + password against users.password_hash. Not Auth::attempt():
     * the lookup must be case-insensitive — the same semantics
     * src/auth/session.ts::signIn ships — and a missing account must burn a
     * hash verification anyway so an unknown username and a wrong password
     * take the same time to fail.
     *
     * @throws ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        // username_active is the generated column the schema built for
        // exactly this lookup: LOWER(username) when the row is alive and
        // credentialled, NULL otherwise (0001_01_01_000000_create_users_
        // table.php). Querying it directly — not whereRaw('LOWER(username)
        // = ?') — plans as a const lookup against users_username_key
        // instead of a full table scan, and makes the soft-delete and
        // null-username exclusions structural (built into what the column
        // even generates to) rather than incidental to this one query.
        /** @var User|null $user */
        $user = User::query()
            ->where('username_active', Str::lower($this->string('username')->toString()))
            ->first();

        $ok = $user !== null
            && $user->password_hash !== null
            && Hash::check($this->string('password')->toString(), $user->password_hash);

        if (! $ok) {
            // Burn a verification even when there is no row (or no
            // password_hash, INV-14) to check against — otherwise an
            // unknown username or a credential-less account returns near-
            // instantly while a wrong password pays a full argon2id/bcrypt
            // derivation, a trivially measurable username-enumeration
            // oracle. Fixed per-driver LITERALS (self::DUMMY_HASHES below),
            // not a hash computed fresh per request: computing one here
            // would cost a derivation on every miss (worse than the oracle
            // it claims to close, and PHP-FPM has no request-lifetime
            // memoisation to lean on), and it must be a real, well-formed
            // hash for the active driver or BcryptHasher::check() throws
            // outright on a foreign hash format when HASH_VERIFY is on.
            Hash::check($this->string('password')->toString(), self::dummyHashFor((string) config('hashing.driver')));

            RateLimiter::hit($this->throttleKey());

            // One message for every failure mode — never confirm which
            // usernames exist. The string lives in lang/vi/auth.php.
            throw ValidationException::withMessages(['username' => __('auth.failed')]);
        }

        RateLimiter::clear($this->throttleKey());
        Auth::login($user);
    }

    /** @throws ValidationException */
    public function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), 5)) {
            return;
        }

        event(new Lockout($this));

        throw ValidationException::withMessages([
            'username' => __('auth.throttle', ['seconds' => RateLimiter::availableIn($this->throttleKey())]),
        ]);
    }

    public function throttleKey(): string
    {
        return Str::transliterate(Str::lower($this->string('username')->toString()).'|'.$this->ip());
    }

    /**
     * Fixed, precomputed literals — one per supported hashing.driver — never
     * derived at request time. A hash the active driver's Hasher can parse
     * but that matches no real password: src/auth/session.ts's own
     * equivalent uses a hard-coded argon2id literal for the same reason
     * (that file's own comment: "there is nothing to brute force" — the
     * point of a dummy check is never that it's secret, only that it costs
     * the same one derivation a real check would). BcryptHasher::check()
     * throws on a non-bcrypt string when hashing.bcrypt.verify (aliased
     * from HASH_VERIFY) is true, so the literal must match whichever driver
     * is actually configured — a single fixed argon2id literal would make
     * every failed login under the bcrypt fallback a 500, not a redirect.
     *
     * @var array<string, string>
     */
    private const DUMMY_HASHES = [
        'argon2id' => '$argon2id$v=19$m=65536,t=4,p=1$dDgxM29lanB6eVlncUJjYw$/ZvmpGIAbUh9lDf1RskNq4sMX7Xd7agU2U3vvZtvvyA',
        'argon' => '$argon2i$v=19$m=65536,t=4,p=1$QWZGcGszYjc2bkRLVWppUw$R1uLjMzhk1hAEYbPOCSPeJhzQfNWw4jh8lTj4l2WjEg',
        'bcrypt' => '$2y$12$qds7x/2MsNRU2nFoIGQm1eoQfyyrIIjgNb5JKNT1URefJTAexXssW',
    ];

    private static function dummyHashFor(string $driver): string
    {
        return self::DUMMY_HASHES[$driver] ?? self::DUMMY_HASHES['bcrypt'];
    }
}
