<?php

namespace Database\Factories;

use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Membership> */
class MembershipFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'bookshelf_id' => Bookshelf::factory(),
            'user_id' => User::factory(),
            'role' => 'reader',
            'status' => 'active',
        ];
    }

    public function manager(): static
    {
        return $this->state(fn () => ['role' => 'manager']);
    }

    public function admin(): static
    {
        return $this->state(fn () => ['role' => 'admin']);
    }
}
