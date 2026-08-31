<?php

namespace App\Http\Controllers\Reader;

use App\Http\Controllers\Controller;
use App\Models\Bookshelf;
use App\Queries\Labels\CopyByIdQuery;
use App\Support\Qr\LabelPayload;
use App\Support\QueryParam;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The server half of the label round trip (Task 4's docblock names the
 * other half). The camera decodes a QR into a printed payload string
 * entirely in the browser — this controller never touches a frame or a
 * pixel; it only turns whatever string the client hands it into a copy,
 * or into nothing.
 *
 * Two steps, each allowed to answer nothing on its own: `LabelPayload::
 * uuidFrom()` refuses any payload that is not `OLB1:` (a foreign format
 * version, a stray QR from somewhere else in the world) by returning
 * null before a query ever runs; `CopyByIdQuery::run()` then refuses a
 * copy id that is well-formed but points at nothing this shelf can see
 * — unknown, soft-deleted, or another parish's — the same way (OPS
 * §3.3, restated on that query). Both refusals reach the browser as the
 * same `{"copy": null}` shape, and `copy-scanner.tsx` is the one place
 * that turns that into "not a shelf label" versus "not found here" by
 * name, using the fact that it already knows locally whether decoding
 * itself succeeded.
 *
 * DELIBERATELY NOT MANAGER-ONLY, same as the query it calls: this
 * route sits in the `role:reader` group in routes/web.php, gated by
 * shelf membership alone (EnsureShelfRole), because OPS §3.3 requires a
 * reader be able to scan a book on the shelf to ask for it. No
 * Gate::authorize call belongs here for that reason — the membership
 * check the route group already applies is the whole of the gate.
 */
class ScanController extends Controller
{
    public function resolve(Request $request, Bookshelf $shelf, CopyByIdQuery $query): JsonResponse
    {
        $payload = (string) QueryParam::first($request, 'payload', '');
        $copyId = LabelPayload::uuidFrom($payload);

        return response()->json([
            'copy' => $copyId === null ? null : $query->run($copyId),
        ]);
    }
}
