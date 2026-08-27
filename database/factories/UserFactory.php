<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        // AGENTS.md's shared fixtures: saint name + Vietnamese full name.
        $people = [
            ['Maria', 'Nguyễn Thị Lan'], ['Giuse', 'Trần Minh'],
            ['Têrêsa', 'Lê Ngọc Ánh'], ['Anna', 'Phạm Thu Hà'],
            ['Phêrô', 'Nguyễn Văn Bình'],
        ];
        [$saint, $name] = $this->faker->randomElement($people);

        return [
            'saint_name' => $saint,
            'full_name' => $name,
            'father_name' => 'Chưa có',
            'mother_name' => 'Chưa có',
            'phone' => null,
            'phone_missing_reason' => 'Trẻ em chưa có điện thoại',
            'locale' => 'vi',
            // No credentials by default: users_credentials_paired's
            // both-or-neither, and most readers are children who never
            // sign in.
            'username' => null,
            'password_hash' => null,
        ];
    }

    public function withCredentials(string $username, string $password = 'mat-khau-123'): static
    {
        return $this->state(fn () => [
            'username' => $username,
            'password_hash' => Hash::make($password),
        ]);
    }

    public function superAdmin(): static
    {
        return $this->state(fn () => ['is_super_admin' => true]);
    }
}
