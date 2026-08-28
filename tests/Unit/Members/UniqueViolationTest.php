<?php

use App\Exceptions\RuleViolated;
use App\Support\UniqueViolation;
use Illuminate\Database\QueryException;

// PDOException::$errorInfo is what QueryException copies; build it the way
// the driver does rather than subclassing.
function uvBuild(int $errno, string $message): QueryException
{
    $pdo = new PDOException($message);
    $pdo->errorInfo = ['23000', $errno, $message];

    return new QueryException('mariadb', 'insert into users …', [], $pdo);
}

it('translates a 1062 naming a mapped constraint into the mapped code', function () {
    $e = uvBuild(1062, "Duplicate entry 'lan' for key 'users_username_key'");

    expect(fn () => UniqueViolation::translate($e, ['users_username_key' => 'username_taken']))
        ->toThrow(RuleViolated::class, 'username_taken');
});

it('rethrows a 1062 naming an unmapped constraint, and any other errno, untouched', function () {
    $unmapped = uvBuild(1062, "Duplicate entry for key 'books_bookshelf_id_slug_key'");
    $notDup = uvBuild(1906, 'The value specified for generated column …');

    expect(fn () => UniqueViolation::translate($unmapped, ['users_username_key' => 'username_taken']))
        ->toThrow(QueryException::class)
        ->and(fn () => UniqueViolation::translate($notDup, ['users_username_key' => 'username_taken']))
        ->toThrow(QueryException::class);
});
