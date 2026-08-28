<?php

namespace App\Http\Controllers\Manage;

use App\Actions\Catalogue\AddCopies;
use App\Actions\Catalogue\AssessCondition;
use App\Actions\Catalogue\MarkCopyFound;
use App\Actions\Catalogue\ReportCopyLost;
use App\Actions\Catalogue\RetireCopy;
use App\Enums\CopyCondition;
use App\Http\Controllers\Controller;
use App\Http\Requests\Catalogue\AddCopiesRequest;
use App\Http\Requests\Catalogue\AssessConditionRequest;
use App\Http\Requests\Catalogue\CopyNoteRequest;
use App\Http\Requests\Catalogue\RetireCopyRequest;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;

class CopyController extends Controller
{
    public function store(AddCopiesRequest $request, Bookshelf $shelf, Book $book, AddCopies $addCopies): RedirectResponse
    {
        // Every action below is reached only through the 'auth' + role:manager
        // group middleware, so user() is never null at runtime — the
        // annotations exist for the analyser, which cannot see through the
        // middleware stack.
        /** @var User $user */
        $user = $request->user();
        /** @var array{count: int, donor_membership_id?: ?string, donor_name?: ?string, acquired_on?: ?string} $validated */
        $validated = $request->validated();

        $addCopies->execute($user, $book, $validated);

        return redirect()->route('shelves.manage.books.show', ['shelf' => $shelf->slug, 'book' => $book->slug]);
    }

    public function assess(AssessConditionRequest $request, Bookshelf $shelf, BookCopy $bookCopy, AssessCondition $assess): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();
        $assess->execute(
            $user,
            $bookCopy,
            CopyCondition::from($validated['condition']),
            $validated['note'] ?? null,
        );

        return back();
    }

    public function retire(RetireCopyRequest $request, Bookshelf $shelf, BookCopy $bookCopy, RetireCopy $retire): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();

        $retire->execute($user, $bookCopy, $request->validated()['reason']);

        return back();
    }

    public function reportLost(CopyNoteRequest $request, Bookshelf $shelf, BookCopy $bookCopy, ReportCopyLost $report): RedirectResponse
    {
        // CopyNoteRequest validates shape only; the ability differs between
        // this route and mark-found, so it is authorized here by name.
        Gate::authorize('reportLost', $bookCopy);
        /** @var User $user */
        $user = $request->user();

        $report->execute($user, $bookCopy, $request->validated()['note'] ?? null);

        return back();
    }

    public function markFound(CopyNoteRequest $request, Bookshelf $shelf, BookCopy $bookCopy, MarkCopyFound $found): RedirectResponse
    {
        Gate::authorize('markFound', $bookCopy);
        /** @var User $user */
        $user = $request->user();

        $found->execute($user, $bookCopy, $request->validated()['note'] ?? null);

        return back();
    }
}
