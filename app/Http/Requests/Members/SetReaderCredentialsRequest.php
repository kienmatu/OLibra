<?php

namespace App\Http\Requests\Members;

use App\Models\Membership;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class SetReaderCredentialsRequest extends FormRequest
{
    public function authorize(): bool
    {
        $membership = $this->route('reader');

        return $membership instanceof Membership && Gate::allows('setCredentials', $membership);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        // min:8 counts multibyte characters (Laravel measures strings with
        // mb_strlen) — the same code-point rule the Action re-asserts.
        return [
            'username' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'min:8'],
        ];
    }
}
