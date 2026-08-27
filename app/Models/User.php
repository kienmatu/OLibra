<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasUuids, SoftDeletes;

    /**
     * Narrow on purpose. is_super_admin is NOT here — it is set only by a
     * super admin action assigning it directly, never through validated
     * request data. username/password_hash are set only by the credential
     * commands (later phases), which assign directly.
     *
     * @var list<string>
     */
    protected $fillable = [
        'saint_name', 'full_name', 'date_of_birth', 'father_name',
        'mother_name', 'phone', 'phone_missing_reason', 'email',
        'display_name', 'locale', 'avatar_object',
    ];

    /** @var list<string> */
    protected $hidden = ['password_hash'];

    /**
     * The schema keeps the honest column name; Laravel's session guard is
     * told where to look. SoftDeletes on this model is also what signs a
     * deleted user out in substance: the provider's retrieveById excludes
     * trashed rows, so an existing session stops resolving on the very next
     * request (src/auth/session.ts's CRITICAL 1, kept).
     */
    public function getAuthPasswordName(): string
    {
        return 'password_hash';
    }

    /**
     * No remember-me: the schema has no remember_token column and BR names
     * no such feature. An empty name makes the session guard skip token
     * cycling on logout instead of writing a column that does not exist.
     */
    public function getRememberTokenName(): string
    {
        return '';
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'is_super_admin' => 'boolean',
        ];
    }

    /** @return HasMany<Membership, $this> */
    public function memberships(): HasMany
    {
        return $this->hasMany(Membership::class);
    }
}
