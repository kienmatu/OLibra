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

        // EXACTLY ONE Hash::check, on every path, found necessary in
        // review after round 1 accidentally restored the timing oracle in
        // the opposite direction: an earlier shape called Hash::check on
        // the found-user branch AND AGAIN inside `if (! $ok)` for every
        // miss, so a wrong password paid two derivations against an
        // unknown username's one — fast now meant "no such user", if
        // anything an easier signal for an enumerator than the original.
        // $stored falls back to a fixed per-driver literal (self::
        // DUMMY_HASHES below) exactly when there is nothing real to check
        // against — no row, or a credential-less account (INV-14) — so the
        // one derivation below always happens, on identical input shape,
        // whether or not a user was found. The `&&` chain only gates the
        // *result*; it must not gate whether the check itself runs.
        $dummy = self::dummyHashFor((string) config('hashing.driver'));
        $stored = $user !== null ? ($user->password_hash ?? $dummy) : $dummy;

        $ok = Hash::check($this->string('password')->toString(), $stored)
            && $user !== null
            && $user->password_hash !== null;

        if (! $ok) {
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

    /**
     * @throws \RuntimeException when hashing.driver names a driver this
     *                           class carries no literal for. Found in review: silently falling
     *                           back to the bcrypt literal for an unrecognised driver would hand
     *                           a foreign-format hash to whatever Hasher IS configured — under a
     *                           future custom driver with HASH_VERIFY-equivalent checking on,
     *                           that throws inside the very code path meant to avoid one. A
     *                           clear, named configuration error here is a deploy-time signal to
     *                           add the missing literal, not a runtime 500 discovered by a user
     *                           typing a wrong password.
     */
    private static function dummyHashFor(string $driver): string
    {
        return self::DUMMY_HASHES[$driver]
            ?? throw new \RuntimeException(
                "LoginRequest::DUMMY_HASHES has no literal for hashing driver [{$driver}]. ".
                'Add one (a real hash for that driver, at production-strength cost, that '.
                'matches no real password) before deploying with this driver configured.'
            );
    }
}
