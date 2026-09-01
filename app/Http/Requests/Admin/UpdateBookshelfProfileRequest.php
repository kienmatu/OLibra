<?php

namespace App\Http\Requests\Admin;

use App\Models\Bookshelf;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * The profile half of the shelf editor (`PATCH /admin/shelves/{shelf}`) —
 * what the shelf *is*. The lending policy and the contacts are Task 5's own
 * forms with their own submits and their own refusals (spec D2, and D8
 * depends on it: 3b-ii adds a taxonomy section to this same screen, and
 * per-section forms make that an addition rather than a restructure).
 *
 * THERE IS NO `slug` RULE HERE, AND ITS ABSENCE IS THE POINT (spec D1). A
 * validated bag is what the controller hands the command, so a field this
 * class does not name cannot reach the update at all — even if the browser
 * posts one, even if the model would take it. `Bookshelf::$guarded` names
 * only the four generated columns, so `slug` and `status` are both
 * mass-assignable; the two defences that matter are this rule set and
 * App\Actions\Admin\UpdateBookshelfProfile's field-by-field write, and
 * neither one leans on the other.
 *
 * The database has a third defence — a trigger raising SQLSTATE 45000 on a
 * changed slug — and it is emphatically NOT the one under test. If it ever
 * fires from this path, a volunteer got a 500 from a request that should
 * have been ignored in silence; see the command's docblock.
 *
 * The rules that remain are StoreBookshelfRequest's, minus the slug, and its
 * docblock carries the reasoning for each bound (the free-text sweep, the
 * character-vs-byte units on `description`, the `varchar(255)` match on the
 * other three).
 */
class UpdateBookshelfProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        // {bookshelf}, not {shelf} — routes/web.php explains at length why
        // the /admin group cannot use the tenant-bound parameter name.
        /** @var Bookshelf $bookshelf */
        $bookshelf = $this->route('bookshelf');

        // 404, never 403 — StoreBookshelfRequest's reasoning, and the same
        // shape BookshelfPolicy answers in.
        abort_unless(Gate::allows('update', $bookshelf), 404);

        return true;
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'name' => ['bail', 'required', 'string', 'max:255', 'encoding:UTF-8'],
            'location' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'address' => ['bail', 'nullable', 'string', 'max:255', 'encoding:UTF-8'],
            'description' => ['bail', 'nullable', 'string', 'max:16000', 'encoding:UTF-8'],
            'established_on' => ['nullable', 'date'],
        ];
    }
}
