<?php

namespace App\Http\Requests\Circulation;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class ApproveBorrowRequestRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — spec §5.4, the PR #61 shape. Defence in depth
        // rather than the producer: the route sits in the manage group's
        // ['auth', 'role:manager'], and EnsureShelfRole::handle abort(404)s
        // before a Form Request is ever resolved — measured for this task by
        // deleting this line and re-running ManagerQueueScreenTest's reader
        // block, which stayed green. FormRequestAuthorize404Test pins the
        // STATUS this branch produces, independently of routing.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // uuid: the empty-select post ('') and a stray emoji are field
            // errors here, never an errno 1267 downstairs (the SafeId
            // lesson) — "a sentence, not a failed uuid cast".
            // ApproveBorrowRequest hands $copyId straight to
            // BookCopy::query()->find(), and book_copies.id is ascii_bin, so
            // an unvalidated multi-byte value is SQLSTATE[HY000] 1267 rather
            // than copy_not_found. `bail` first so a value failing `uuid`
            // cannot reach a later rule (FreeTextEncodingGuardTest treats an
            // unguarded uuid as unsafe for exactly that reason).
            'copy_id' => ['bail', 'required', 'string', 'uuid'],
        ];
    }
}
