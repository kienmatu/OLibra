<?php

namespace App\Http\Requests\Circulation;

use App\Enums\CopyCondition;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class ReceiveReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        // 404, never 403 — BR §5.4's anti-enumeration rule, the backstop
        // behind the role:manager middleware (PR #61 Task 4's shape). This
        // route already sits inside ['auth', 'role:manager'], so this
        // branch is unreachable over HTTP today — see
        // tests/Feature/Circulation/FormRequestAuthorize404Test.php, which
        // exercises it directly rather than through routing.
        abort_unless(Gate::allows('act-as-manager'), 404);

        return true;
    }

    /**
     * "Không giữ chỗ, trả về kệ" posts the empty string — the absence of a
     * choice to hold, not a request id of zero length — and `nullable`
     * does not by itself treat "" as absent for a `uuid` rule.
     *
     * MEASURED, not assumed: over an actual HTTP request this merge is
     * currently redundant. The framework's own global
     * ConvertEmptyStringsToNull middleware (registered by default —
     * Middleware::getGlobalMiddleware(), never removed in
     * bootstrap/app.php) already folds "" to null on BOTH the query bag
     * and, via TransformsRequest::clean()'s isJson() branch, the JSON
     * body Inertia's useForm() posts — before this class's rules() ever
     * runs. UpdateReaderProfileRequest's own docblock names the same
     * middleware for the same reason. Proved by mutation: replacing the
     * condition below with `if (false)` left every ReturnHoldOfferTest
     * green, including "the empty radio value means no hold" — this
     * merge is not what that test is currently pinning.
     *
     * Kept anyway, as the brief directs, for the caller this app's
     * middleware stack does not cover — a FormRequest resolved outside
     * the HTTP kernel (a console command, a queued job, a unit test that
     * new()s this class directly) sees no ConvertEmptyStringsToNull at
     * all, and would hit the uuid rule with a literal "" without this.
     */
    protected function prepareForValidation(): void
    {
        if ($this->input('hold_for_request_id') === '') {
            $this->merge(['hold_for_request_id' => null]);
        }
    }

    /** @return array<string, list<mixed>> */
    public function rules(): array
    {
        return [
            'condition' => ['bail', 'required', 'string', Rule::enum(CopyCondition::class)],
            // bail + encoding:UTF-8 — a NUL byte must fail as validation,
            // never crash a later rule (PR #61 Task 1's lesson).
            'note' => ['bail', 'nullable', 'string', 'max:1000', 'encoding:UTF-8'],
            // uuid behind bail, id-shaped: borrow_requests.id is
            // ascii/ascii_bin (2026_08_26_000008), so an unvalidated emoji
            // here would reach BorrowRequest::query()->find() inside
            // ReceiveReturn as SQLSTATE[HY000] 1267, a 500, not a refusal
            // (the SafeId lesson, PR #62; measured for this field in
            // ReturnHoldOfferTest's emoji test).
            'hold_for_request_id' => ['bail', 'nullable', 'string', 'uuid'],
        ];
    }
}
