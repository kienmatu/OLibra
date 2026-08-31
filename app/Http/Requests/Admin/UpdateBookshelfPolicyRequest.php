<?php

namespace App\Http\Requests\Admin;

use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The lending-policy half of the shelf editor
 * (`PATCH /admin/shelves/{bookshelf}/policy`) — how borrowing behaves, as
 * opposed to what the shelf *is*. Its own route, its own submit and its own
 * refusal (spec D2): a typo in a loan period must not block correcting an
 * address, and a shelf with no contact on file must still be able to change
 * how long a book may be borrowed.
 *
 * EXACTLY EIGHT FIELDS — the reference's own list, whose docstring calls
 * them "the six lending-policy numbers and the two comment toggles"
 * (old_next/src/app/quan-tri/admin-actions.ts:256). BR §5.5 names four more
 * and this form deliberately carries none of them: two of those four
 * (`public_show_current_borrower`, `public_name_display`) are live and
 * uneditable, recorded in docs/known-gaps.md rather than fixed by widening
 * a form the reference kept at eight; the other two are stale requirements
 * text consumed by nothing.
 *
 * THE COMMENT KEY IS `comments_enabled`, NOT BR §5.5's `allow_comments`.
 * App\Support\Community\CommentSettings carries a warning about exactly this
 * mistake and its reader coalesces `comments_enabled` to true, so a form
 * posting the other spelling would report success, write a key nothing
 * reads, and leave commenting exactly as it was. The field names below are
 * the storage keys, taken from that class and from
 * App\Support\Circulation\LendingSettings rather than from the requirements.
 *
 * THE BOUNDS ARE THE REFERENCE'S, field by field
 * (old_next/src/domain/admin/policy.ts:63-71), and the two floors of 0 are
 * not oversights: BR §5.5 lets a shelf configure "no renewals allowed", and
 * the nightly sweep may legitimately be told to warn a reader on the due
 * date itself. Every other number floors at 1 — the defect that table
 * closes is a shelf whose loan period was saved as 0, making every loan fall
 * due the day it was made.
 *
 * BOTH TOGGLES ARE `boolean` AND REQUIRED. An HTML checkbox posts nothing
 * when it is clear, so the form sends explicit `true`/`false` rather than
 * relying on presence; `nullable` here would turn "the volunteer unticked
 * it" into "leave it as it was", which is the one thing a settings form must
 * not do.
 */
class UpdateBookshelfPolicyRequest extends FormRequest
{
    public function authorize(): bool
    {
        // {bookshelf}, not {shelf} — routes/web.php explains why the /admin
        // group cannot use the tenant-bound parameter name.
        /** @var Bookshelf $bookshelf */
        $bookshelf = $this->route('bookshelf');

        // 404, never 403 — BookshelfPolicy's shape, and the profile form's.
        abort_unless(Gate::allows('update', $bookshelf), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'loan_days' => ['bail', 'required', 'integer', 'min:1', 'max:365'],
            'max_concurrent_loans' => ['bail', 'required', 'integer', 'min:1', 'max:50'],
            'max_renewals' => ['bail', 'required', 'integer', 'min:0', 'max:10'],
            'renewal_days' => ['bail', 'required', 'integer', 'min:1', 'max:365'],
            'hold_days' => ['bail', 'required', 'integer', 'min:1', 'max:30'],
            'due_soon_days' => ['bail', 'required', 'integer', 'min:0', 'max:30'],
            'comments_enabled' => ['required', 'boolean'],
            'comments_require_approval' => ['required', 'boolean'],
        ];
    }
}
