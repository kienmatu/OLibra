<?php

declare(strict_types=1);

namespace App\Http\Controllers\Manage;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\Exports\BooksExportQuery;
use App\Queries\Exports\LoansExportQuery;
use App\Queries\Exports\ReadersExportQuery;
use App\Support\Clock;
use App\Support\Exports\Csv;
use App\Support\Exports\ExportTables;
use App\Support\Fold;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * OPS §3.3's three CSV exports, one POST route. POST and never GET —
 * the reference's §3.5(c) argument holds unchanged: a GET is a link,
 * bookmarkable, in the history and the autocomplete of a shared parish
 * phone, and a browser will happily re-issue it; a form POST leaves
 * none of that behind. The reference's hand-rolled same-origin check is
 * NOT ported: Laravel's VerifyCsrfToken already refuses a cross-site
 * form post, properly, with a token instead of a Host-header
 * assumption.
 *
 * This route sits inside routes/web.php's `manage` prefix group, whose
 * `['auth', 'role:manager']` middleware already gates every route under
 * it — that group middleware, not a per-query `requireManager` call, IS
 * the structural gate for all three exports here: a reader or a guest
 * never reaches `store()` at all, for any of the three `{kind}` values,
 * because the refusal happens one layer up, before routing picks this
 * method. ExportHttpTest proves each of the three kinds independently
 * rather than trusting that one passing kind implies the others.
 *
 * {kind} resolves through array_key_exists on a closed map — an unknown
 * segment (constructor included) is a 404, and nothing from the URL
 * reaches SQL.
 *
 * Ships SYNCHRONOUS (product-owner ruling, 2026-08-29): response()->stream()
 * still builds the whole CSV body in memory before the first byte is
 * echoed to the client — only the byte concatenation into the output
 * buffer is incremental, not the query or the row-to-CSV conversion. This
 * is not the reference's whole-buffer-then-respond shape only in name; it
 * is the same shape. Do not describe this as streaming the underlying
 * work — it is not.
 */
class ExportController extends Controller
{
    public function store(Bookshelf $shelf, string $kind, Clock $clock): StreamedResponse
    {
        /** @var array<string, array{label: string, table: callable(): array{headers: list<string>, rows: list<list<string>>}}> $kinds */
        $kinds = [
            'books' => ['label' => 'Sách',
                'table' => fn () => ExportTables::books(app(BooksExportQuery::class)->run())],
            'readers' => ['label' => 'Bạn đọc',
                'table' => fn () => ExportTables::readers(app(ReadersExportQuery::class)->run())],
            'loans' => ['label' => 'Lượt mượn',
                'table' => fn () => ExportTables::loans(app(LoansExportQuery::class)->run())],
        ];

        abort_unless(array_key_exists($kind, $kinds), 404);

        $date = $clock->today();
        $table = $kinds[$kind]['table']();

        return response()->stream(function () use ($table): void {
            echo Csv::BOM;
            echo Csv::line($table['headers']);
            foreach ($table['rows'] as $row) {
                echo Csv::line($row);
            }
        }, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            // charset stated although the BOM already says so: the header
            // is what a saving browser reads; the BOM is what Excel reads
            // when the header is long gone in a Downloads folder.
            'Content-Disposition' => HeaderUtils::makeDisposition(
                HeaderUtils::DISPOSITION_ATTACHMENT,
                "{$kinds[$kind]['label']} — ".self::dispositionLabel($shelf->name)." — {$date}.csv",
                "{$kind}-".self::dispositionFallback($shelf->slug)."-{$date}.csv",
            ),
            // A file of children's records is never cached, by the browser
            // or anything between it and here.
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /**
     * HeaderUtils::makeDisposition()'s UTF-8 `filename` argument throws
     * InvalidArgumentException on a bare '/' or '\' — and nothing at the
     * database level stops a shelf name from carrying either
     * ("Giáo xứ Thánh Tâm / Chi nhánh 2" is an ordinary parish name, not a
     * crafted one). Diacritics are fine here (rawurlencode handles them);
     * only the two path separators are dangerous for this argument, so
     * only those are replaced.
     */
    private static function dispositionLabel(string $name): string
    {
        return str_replace(['/', '\\'], '-', $name);
    }

    /**
     * The ASCII `filenameFallback` argument is stricter still: it throws
     * on ANY non-ASCII byte and on a literal '%', on top of the same '/'
     * and '\' ban — a shelf slug is equally unvalidated free text at the
     * database level, so "probe-đông" and "probe-100%" both reach
     * makeDisposition() raw today. Fold::fold() already reduces its input
     * to [a-z0-9 ]+ (Vietnamese diacritics included) and turns everything
     * else — slashes, percents, any other Unicode — into spaces, so
     * routing the slug through it and hyphenating (the same shape
     * App\Support\Catalogue\Slugs::fromTitle() uses for book slugs) yields
     * a fallback makeDisposition() can never reject. A slug that folds to
     * nothing (punctuation-only) falls back to a fixed label rather than
     * an empty filename segment.
     */
    private static function dispositionFallback(string $slug): string
    {
        $folded = str_replace(' ', '-', Fold::fold($slug));

        return $folded === '' ? 'tu-sach' : $folded;
    }
}
