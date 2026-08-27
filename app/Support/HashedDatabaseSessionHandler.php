<?php

namespace App\Support;

use Illuminate\Session\DatabaseSessionHandler;

/**
 * Laravel's database session store, with one change: the table is keyed on
 * sha256(session id), never the raw id. A database dump (or dump + .env —
 * the same cPanel home directory holds both) must not be a stack of usable
 * sessions; the raw id exists only in the browser's cookie. Everything else
 * — payload encoding, last_activity, user_id attribution, gc — is the
 * parent's, untouched.
 */
class HashedDatabaseSessionHandler extends DatabaseSessionHandler
{
    public function read($sessionId): string|false
    {
        return parent::read($this->hashId($sessionId));
    }

    public function write($sessionId, $data): bool
    {
        return parent::write($this->hashId($sessionId), $data);
    }

    public function destroy($sessionId): bool
    {
        return parent::destroy($this->hashId($sessionId));
    }

    private function hashId(string $sessionId): string
    {
        return hash('sha256', $sessionId);
    }
}
