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
     * the lookup must be LOWER() = LOWER() on a binary column — the same
     * semantics src/auth/session.ts::signIn ships — and a missing account
     * must burn a hash verification anyway so an unknown username and a
     * wrong password take the same time to fail.
     *
     * @throws ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        /** @var User|null $user */
        $user = User::query()
            ->whereRaw('LOWER(username) = ?', [Str::lower($this->string('username')->toString())])
            ->first();

        // A dummy hash of a random string nobody knows; verifying against
        // it equalises timing for unknown users and credential-less accounts
        // (INV-14 rows have password_hash null). Generated once per process
        // with the live driver — a pasted literal would be asserted by
        // nobody and could quietly be malformed or the wrong algorithm.
        $stored = $user !== null ? ($user->password_hash ?? self::dummyHash()) : self::dummyHash();

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

    private static ?string $dummyHash = null;

    private static function dummyHash(): string
    {
        return self::$dummyHash ??= Hash::make(Str::random(32));
    }
}
