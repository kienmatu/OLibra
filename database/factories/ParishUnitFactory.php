<?php

namespace Database\Factories;

use App\Models\ParishUnit;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ParishUnit> */
class ParishUnitFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        // No bookshelf_id here: BelongsToBookshelf's creating hook refuses
        // a factory that invents its own shelf — call ->for($shelf).
        return [
            'level' => 1,
            'name' => 'Tổ '.$this->faker->unique()->numberBetween(1, 99),
            'sort_order' => 0,
        ];
    }
}
