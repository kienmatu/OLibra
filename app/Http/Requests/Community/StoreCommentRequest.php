<?php

namespace App\Http\Requests\Community;

use App\Models\Book;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class StoreCommentRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403: a refusal here must not tell a stranger which
        // shelf URLs are real (spec §5.4). Two independent doors produce
        // this route's 404 — the group's role:reader (EnsureShelfRole
        // abort(404)s on the same ability) and this line — and EITHER
        // ALONE is sufficient, measured both ways in Task 2 (see
        // routes/web.php beside the route).
        abort_unless(Gate::allows('act-as-reader'), 404);

        // THE DRAFT GUARD LIVES HERE, NOT IN THE CONTROLLER, and the
        // position is the whole point. authorize() and rules() both run
        // during argument resolution, BEFORE the controller body — Task
        // 2's own mutation 4 measured that ordering empirically, since
        // removing role:reader still produced a 404 from this class. With
        // the guard one layer later, in the controller, a draft slug with
        // an EMPTY body answered 302 with a field error while a
        // nonexistent slug answered 404: the existence oracle closed for
        // a well-formed body and open for a malformed one. Ahead of the
        // rules, both shapes answer 404.
        //
        // Why the guard is needed at all: {book} is a slug and the
        // binding resolves drafts (the manager route shares the model),
        // and neither CreateComment nor CommentPolicy reads is_published.
        // The sibling POST's docblock (App\Http\Controllers\Reader\
        // BorrowRequestController::store) records the same reasoning; its
        // guard genuinely is first, because that route has no Form
        // Request in front of it.
        $book = $this->route('book');
        abort_unless($book instanceof Book && $book->is_published, 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            // Free text, so it leads with bail and carries the encoding
            // rule — FreeTextEncodingGuardTest sweeps every Form Request
            // for exactly that, and the class of bug it exists for is an
            // unmapped MariaDB errno 1366 turning a legitimate POST into
            // a 500. max:2000 is the length ceiling a comment is held
            // to; the column behind it is TEXT, which stops at 65,535
            // bytes.
            //
            // CORRECTED IN TASK 7'S FIX ROUND 1, on a measurement Task
            // 7 itself made. This sentence used to say the empty case
            // was CreateComment's own empty_body "because a body of
            // three spaces passes required". It does not pass:
            // Illuminate\Validation\Concerns\ValidatesAttributes::
            // validateRequired (opened and read at that commit) returns
            // false for
            // `is_string($value) && trim($value) === ''`, so `required`
            // on this line refuses a whitespace-only body and the reader
            // gets errors.body beside the textarea rather than the
            // errors.rule banner. BookCommentsScreenTest pins both
            // shapes over HTTP — empty and three spaces — key by key.
            //
            // CreateComment::execute's own trim is NOT made redundant by
            // that. It guards the direct execute() call
            // CreateCommentTest makes, where no Form Request runs at
            // all; this route is simply not the door that reaches it.
            'body' => ['bail', 'required', 'string', 'max:2000', 'encoding:UTF-8'],
        ];
    }
}
