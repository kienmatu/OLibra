<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // ── The six parents ───────────────────────────────────────────────
        // (bookshelf_id, id) is trivially unique — id alone is the pk — but
        // the composite index is what a composite FK needs to point at.
        foreach ([
            'parish_units', 'books', 'book_copies',
            'memberships', 'loans', 'borrow_requests',
        ] as $parent) {
            DB::statement("
                ALTER TABLE {$parent}
                ADD CONSTRAINT {$parent}_bookshelf_id_id_key UNIQUE (bookshelf_id, id)
            ");
        }

        // ── The fifteen composite FKs ─────────────────────────────────────
        $fks = [
            // [table, constraint, child cols, parent, on delete]
            ['parish_units', 'parish_units_parent_fk', '(bookshelf_id, parent_id)', 'parish_units', 'RESTRICT'],
            ['memberships', 'memberships_parish_unit_l1_fk', '(bookshelf_id, parish_unit_l1_id)', 'parish_units', 'RESTRICT'],
            ['memberships', 'memberships_parish_unit_l2_fk', '(bookshelf_id, parish_unit_l2_id)', 'parish_units', 'RESTRICT'],
            ['book_copies', 'book_copies_book_fk', '(bookshelf_id, book_id)', 'books', 'CASCADE'],
            ['book_copies', 'book_copies_acquired_from_membership_fk', '(bookshelf_id, acquired_from_membership_id)', 'memberships', 'RESTRICT'],
            ['loans', 'loans_copy_fk', '(bookshelf_id, copy_id)', 'book_copies', 'RESTRICT'],
            ['loans', 'loans_book_fk', '(bookshelf_id, book_id)', 'books', 'RESTRICT'],
            ['loans', 'loans_request_fk', '(bookshelf_id, request_id)', 'borrow_requests', 'RESTRICT'],
            ['borrow_requests', 'borrow_requests_book_fk', '(bookshelf_id, book_id)', 'books', 'CASCADE'],
            ['borrow_requests', 'borrow_requests_copy_fk', '(bookshelf_id, copy_id)', 'book_copies', 'RESTRICT'],
            ['borrow_requests', 'borrow_requests_fulfilled_loan_fk', '(bookshelf_id, fulfilled_loan_id)', 'loans', 'RESTRICT'],
            ['condition_assessments', 'condition_assessments_copy_fk', '(bookshelf_id, copy_id)', 'book_copies', 'RESTRICT'],
            ['condition_assessments', 'condition_assessments_loan_fk', '(bookshelf_id, loan_id)', 'loans', 'RESTRICT'],
            ['comments', 'comments_book_fk', '(bookshelf_id, book_id)', 'books', 'CASCADE'],
            ['book_donations', 'book_donations_donor_membership_fk', '(bookshelf_id, donor_membership_id)', 'memberships', 'RESTRICT'],
        ];

        foreach ($fks as [$table, $name, $cols, $parent, $onDelete]) {
            DB::statement("
                ALTER TABLE {$table}
                ADD CONSTRAINT {$name} FOREIGN KEY {$cols}
                REFERENCES {$parent} (bookshelf_id, id)
                ON DELETE {$onDelete}
            ");
        }
    }

    public function down(): void
    {
        foreach ([
            'parish_units' => ['parish_units_parent_fk'],
            'memberships' => ['memberships_parish_unit_l1_fk', 'memberships_parish_unit_l2_fk'],
            'book_copies' => ['book_copies_book_fk', 'book_copies_acquired_from_membership_fk'],
            'loans' => ['loans_copy_fk', 'loans_book_fk', 'loans_request_fk'],
            'borrow_requests' => ['borrow_requests_book_fk', 'borrow_requests_copy_fk', 'borrow_requests_fulfilled_loan_fk'],
            'condition_assessments' => ['condition_assessments_copy_fk', 'condition_assessments_loan_fk'],
            'comments' => ['comments_book_fk'],
            'book_donations' => ['book_donations_donor_membership_fk'],
        ] as $table => $names) {
            foreach ($names as $name) {
                DB::statement("ALTER TABLE {$table} DROP FOREIGN KEY {$name}");
            }
        }

        foreach ([
            'parish_units', 'books', 'book_copies',
            'memberships', 'loans', 'borrow_requests',
        ] as $parent) {
            DB::statement("ALTER TABLE {$parent} DROP INDEX {$parent}_bookshelf_id_id_key");
        }
    }
};
