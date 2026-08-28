<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Circulation\VoidLoan;
use App\Http\Controllers\Controller;
use App\Http\Requests\Circulation\VoidLoanRequest;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\User;
use Illuminate\Http\RedirectResponse;

class LoanController extends Controller
{
    public function void(VoidLoanRequest $request, Bookshelf $shelf, Loan $loan, VoidLoan $voidLoan): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $voidLoan->execute($user, $loan, $request->validated()['reason']);

        return back();
    }
}
