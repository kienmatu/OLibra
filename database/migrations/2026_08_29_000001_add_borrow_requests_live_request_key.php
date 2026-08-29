<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Divergence 2. "One live place in this title's queue per reader"
        // was going to be a FOR UPDATE on the books row; that closes a real
        // AB-BA cycle against UpdateBook (which X-locks bookshelves, then
        // writes the book row, while every insert here wants S on that same
        // bookshelves row through its RESTRICT foreign keys). The rule
        // becomes a constraint instead — the single-column-predicate form
        // loans.active_copy_id and profile_change_requests.pending_user_id
        // already use: the key exists only while the row is LIVE and
        // undecided, NULLs are distinct, so every terminal status and a soft
        // delete free the slot and the reader may queue for that title again.
        //
        // 73 = 36 + 1 + 36, ascii_bin to match book_id and member_id exactly
        // (a differing collation on either side would compare, and index,
        // wrongly).
        DB::statement("
            ALTER TABLE borrow_requests ADD COLUMN live_request_key VARCHAR(73)
                CHARACTER SET ascii COLLATE ascii_bin
                GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL AND status IN ('pending', 'approved'),
                       CONCAT(book_id, ':', member_id), NULL)
                ) STORED
        ");
        DB::statement('
            ALTER TABLE borrow_requests
            ADD CONSTRAINT borrow_requests_one_live_per_title_member UNIQUE (live_request_key)
        ');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE borrow_requests DROP INDEX borrow_requests_one_live_per_title_member');
        DB::statement('ALTER TABLE borrow_requests DROP COLUMN live_request_key');
    }
};
