<?php

namespace App\Http\Requests\Catalogue;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shared by report-lost and mark-found, which differ only in the policy
 * ability — the controller authorizes each route by name (Task 12), so
 * this request validates shape only.
 */
class CopyNoteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;   // the controller's Gate::authorize is the gate
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // bail + encoding:UTF-8 — Task 12 carry-over fix: a manager posting
        // invalid UTF-8 here reached ReportCopyLost/MarkCopyFound's write
        // to book_copies, tripped MariaDB errno 1366 (invalid string for
        // the utf8mb4 column), unmapped, and 500'd — reproduced live and
        // proved by CatalogueHostileInputTest. Same shape as
        // ReceiveReturnRequest (Task 11) and VoidLoanRequest (Task 12).
        return [
            'note' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
        ];
    }
}
