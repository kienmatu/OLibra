<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // INV-11. A loan is voided, never deleted — six months later, "why is
        // there no loan here" must have an answer (BR §11).
        DB::unprepared("
            CREATE TRIGGER loans_no_delete BEFORE DELETE ON loans FOR EACH ROW
                SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'rows in loans cannot be deleted; void the loan instead'
        ");

        // INV-12. Audit records never change or disappear.
        DB::unprepared("
            CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
                SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'rows in audit_log cannot be updated'
        ");
        DB::unprepared("
            CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
                SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'rows in audit_log cannot be deleted'
        ");

        // 20260808_02: the slug is the shelf's public identity — QR labels
        // and printed URLs point at it; renaming a shelf must not orphan them.
        DB::unprepared("
            CREATE TRIGGER bookshelves_slug_immutable BEFORE UPDATE ON bookshelves FOR EACH ROW
                IF NEW.slug <> OLD.slug THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'bookshelves.slug is immutable after creation';
                END IF
        ");

        // 20260808_10: feedback belongs where it was filed, forever — moving
        // it between shelves (or claiming front-door feedback for a shelf)
        // would rewrite who is allowed to read it. <=> is the NULL-safe
        // comparison; bookshelf_id is nullable here.
        DB::unprepared("
            CREATE TRIGGER feedback_bookshelf_immutable BEFORE UPDATE ON feedback FOR EACH ROW
                IF NOT (NEW.bookshelf_id <=> OLD.bookshelf_id) THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'feedback.bookshelf_id is immutable after creation';
                END IF
        ");
    }

    public function down(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS loans_no_delete');
        DB::unprepared('DROP TRIGGER IF EXISTS audit_log_no_update');
        DB::unprepared('DROP TRIGGER IF EXISTS audit_log_no_delete');
        DB::unprepared('DROP TRIGGER IF EXISTS bookshelves_slug_immutable');
        DB::unprepared('DROP TRIGGER IF EXISTS feedback_bookshelf_immutable');
    }
};
