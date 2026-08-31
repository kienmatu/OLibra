<?php

declare(strict_types=1);

namespace App\Http\Controllers\Manage;

use App\Actions\Catalogue\MarkCopiesPrinted;
use App\Http\Controllers\Controller;
use App\Http\Requests\Labels\ExportLabelSheetRequest;
use App\Models\Bookshelf;
use App\Models\User;
use App\Queries\Labels\CopiesForLabelsQuery;
use App\Queries\Labels\TitlesForLabelsQuery;
use App\Support\Fold;
use App\Support\Qr\LabelSheet;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;
use Symfony\Component\HttpFoundation\HeaderUtils;

/**
 * BR §19's QR label workflow — the selection screen (`index`) and the
 * sheet it posts to (`export`). OPS §3.3's ListTitlesForLabels and
 * ExportLabelSheetPDF.
 *
 * `index()` is a bare GET, nothing to refuse beyond the `manage` group's
 * own `['auth', 'role:manager']`. `export()` carries a body — bookIds and
 * copyIds — and so is gated a second time by
 * ExportLabelSheetRequest::authorize()'s `abort_unless`.
 *
 * THE ORDER IN `export()` IS THE POINT, restated from OPS §3.3:
 * `ExportLabelSheetPDF` "writes MarkCopiesPrinted only once the bytes
 * exist." So: expand the selection (CopiesForLabelsQuery) -> render the
 * PDF (LabelSheet::render) -> MarkCopiesPrinted -> return the download.
 * A renderer that throws leaves nothing stamped, so a manager who sees an
 * error and retries is not charged a reprint for a sheet that was never
 * produced.
 *
 * MarkCopiesPrinted RECEIVES THE EXPANDED COPY IDS, already
 * tenancy-scoped by CopiesForLabelsQuery (BookshelfScope, on BookCopy —
 * no bookshelf_id written here or there). That is why, on this HTTP path,
 * the command's own D7 "scopes to zero, succeeds with zero" branch is
 * effectively unreachable: a selection of only foreign ids expands to
 * `[]` here and is refused as `copy_selection_empty` before
 * MarkCopiesPrinted ever runs, rather than reaching it and recording a
 * zero count. MarkCopiesPrinted's own docblock is the place that
 * statement belongs to, not a reason to special-case the empty array
 * here — RuleViolated is left uncaught, exactly as everywhere else in
 * this codebase; bootstrap/app.php renders it once as
 * back()->withErrors(['rule' => …]).
 *
 * NOTHING IS FLASHED ON SUCCESS. The response is the PDF's bytes, not a
 * redirect — a plain HTML `<form method="post">`, not an Inertia
 * `router.post()`, is what Task 11's screen must submit this with, since
 * an Inertia visit cannot consume a binary download. There is nothing to
 * flash into a page that never renders on this leg.
 */
class LabelController extends Controller
{
    public function index(Request $request, Bookshelf $shelf, TitlesForLabelsQuery $titles): InertiaResponse
    {
        $onlyUnprinted = $request->boolean('onlyUnprinted');

        return Inertia::render('manage/labels', [
            'titles' => $titles->run($onlyUnprinted),
            'onlyUnprinted' => $onlyUnprinted,
        ]);
    }

    public function export(
        ExportLabelSheetRequest $request,
        Bookshelf $shelf,
        CopiesForLabelsQuery $copiesQuery,
        LabelSheet $sheet,
        MarkCopiesPrinted $markPrinted,
    ): Response {
        /** @var User $actor */
        $actor = $request->user();

        /** @var list<string> $bookIds */
        $bookIds = $request->validated('bookIds', []);
        /** @var list<string> $copyIds */
        $copyIds = $request->validated('copyIds', []);

        $rows = $copiesQuery->run($bookIds, $copyIds);

        // LabelSheet::render() wants copyId/code/title — the same rows
        // CopiesForLabelsQuery returns, minus printCount.
        $forSheet = array_map(
            fn (array $row): array => [
                'copyId' => $row['copyId'],
                'code' => $row['code'],
                'title' => $row['title'],
            ],
            $rows,
        );

        // THE BYTES FIRST. A render that throws never reaches the write
        // below, so nothing is stamped for a sheet nobody received.
        $pdf = $sheet->render($forSheet);

        // THEN THE STAMP — the expanded ids, not what the form submitted.
        // An empty $rows (both fields empty, or a selection that scoped
        // entirely to another shelf) yields $copyIds === [] here, which
        // MarkCopiesPrinted refuses with copy_selection_empty, uncaught.
        $markPrinted->execute($actor, array_column($rows, 'copyId'));

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => HeaderUtils::makeDisposition(
                HeaderUtils::DISPOSITION_ATTACHMENT,
                "Nhãn QR — {$shelf->name}.pdf",
                'nhan-qr-'.self::dispositionFallback($shelf->slug).'.pdf',
            ),
            // The same reasoning as ExportController's CSVs: a sheet of
            // children's records is never cached, by the browser or
            // anything between it and here.
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /**
     * The ASCII `filenameFallback` argument of HeaderUtils::makeDisposition()
     * throws on non-ASCII bytes and on a bare '/' or '\', the same
     * constraint ExportController::dispositionFallback() documents and
     * folds around. Fold::fold() reduces the slug to [a-z0-9 ]+ first.
     */
    private static function dispositionFallback(string $slug): string
    {
        $folded = str_replace(' ', '-', Fold::fold($slug));

        return $folded === '' ? 'tu-sach' : $folded;
    }
}
