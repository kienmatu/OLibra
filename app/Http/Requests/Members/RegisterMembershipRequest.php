<?php

namespace App\Http\Requests\Members;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The public form's shape rules. authorize() is true — this is the one
 * open door (the Action's own docstring), and the throttle is the gate.
 * The business rules (phone-or-reason, INV-14's pairing, the parish
 * selection, identity reuse) stay in Registration, which refuses them by
 * OPS §4.3's own codes — this request only keeps garbage shapes out.
 */
class RegisterMembershipRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'shelf' => ['required', 'string', 'max:255'],
            'username' => ['nullable', 'string', 'max:255'],
            'password' => ['nullable', 'string', 'min:8', 'confirmed'],
            // Fix round, Task 2: `encoding:UTF-8` closes the same class of
            // gap as Task 1's `bail`, one layer downstream — a name field
            // holding a byte sequence that is not valid UTF-8 (e.g.
            // "\xC3\x28") sailed straight through `string`/`max` (neither
            // inspects encoding) to Registration::createPerson()'s INSERT,
            // where the column's utf8mb4 charset rejects it as MySQL/MariaDB
            // errno 1366 — unmapped by UniqueViolation::translate, rethrown
            // as a raw QueryException, 500ing the request. Because
            // QueryException::formatMessage() inlines bindings, the log
            // line for that crash carried the child's date of birth, both
            // parents' names, and phone. `encoding:UTF-8` uses
            // mb_check_encoding() (never throws) so this is a clean
            // ValidationException instead of a query-layer surprise.
            'saint_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'full_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            // Fix round, Task 13, Minor #1: `date_format:Y-m-d` alone lets
            // through anything checkdate() accepts as a calendar day,
            // including 9999-12-31 — a pending membership got created for
            // a reader "born" in the year 9999. Registration.php's own
            // assertStorableDate() (Task 6, unmodified here) only ever
            // checks the SHAPE of the date, not its plausibility, so
            // nothing downstream of this Form Request catches it either.
            // Two sane, generous bounds, chosen from the domain rather
            // than an arbitrary round number: `before_or_equal:today` — a
            // birth date cannot be in the future, full stop — and
            // `after_or_equal:1900-01-01`, wide enough that no living
            // parishioner is excluded (nobody registering at a parish
            // library today was born before 1900) while still refusing
            // the unbounded date range `date_format` alone permits.
            //
            // Fix round, Task 1: `before_or_equal`/`after_or_equal`
            // delegate to DateTime::createFromFormat() WITHOUT the
            // try/catch that `date_format` itself has (ValidatesAttributes
            // ::getDateTimeWithOptionalFormat(), unlike validateDateFormat,
            // never catches ValueError). Laravel runs every rule for an
            // attribute regardless of earlier failures unless told to
            // stop, so a value that fails `date_format` — e.g. one
            // carrying a NUL byte — still reached those two rules and
            // threw a ValueError, 500ing the request instead of producing
            // a ValidationException. `bail` makes date_of_birth stop at
            // the first failing rule: once `date_format` rejects the
            // shape, the bound checks — which assume a value already
            // known to parse — never run. Reproduced live: POST /register
            // with date_of_birth="09123\x0045678" 500'd before this line
            // was added.
            'date_of_birth' => ['bail', 'required', 'date_format:Y-m-d', 'before_or_equal:today', 'after_or_equal:1900-01-01'],
            'father_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'mother_name' => ['required', 'string', 'max:255', 'encoding:UTF-8'],
            'phone' => ['nullable', 'string', 'max:32'],
            'phone_missing_reason' => ['nullable', 'string', 'max:1000'],
            'email' => ['nullable', 'email', 'max:255'],
            'parish_unit_l1_id' => ['nullable', 'string', 'max:36'],
            'parish_unit_l2_id' => ['nullable', 'string', 'max:36'],
        ];
    }
}
