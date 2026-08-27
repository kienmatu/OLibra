import { markCopiesPrinted } from "@/domain/catalogue/commands/mark-copies-printed";
import { listCopiesForLabels } from "@/domain/catalogue/queries/list-copies-for-labels";
import { loadFile, submitCommand } from "@/lib/page-data";
import { buildLabelSheet } from "@/lib/qr-labels";
import { readShelf } from "@/lib/shelf";

/**
 * The QR label sheet, as a PDF.
 *
 * **A static segment beside `xuat/[loai]`.** Next resolves a static segment
 * before a dynamic one, so the CSV route is untouched and its closed `EXPORTS`
 * map keeps its CSV-only shape instead of growing a content-type conditional
 * for the one export that is not a table.
 *
 * **`POST`, and for a different reason than the CSV exports.** Those are `POST`
 * because P1 §3.5(c) refuses to put a file of children's records behind a
 * bookmarkable URL. A label sheet holds titles and shelf marks and carries no
 * such weight; the reason here is mechanical, and worth stating so nobody
 * "simplifies" it into a `GET` on the grounds that the data is harmless: the
 * selection is up to several hundred copy ids, which does not belong in a query
 * string.
 *
 * `force-dynamic` for the reason U1 §2 gives every page in this seam — a cached
 * response is one shelf's data served to another shelf's manager, with no SQL
 * issued and therefore nothing for RLS to refuse.
 */
export const dynamic = "force-dynamic";

/**
 * Refuse a cross-site form post.
 *
 * Copied from `../[loai]/route.ts` rather than imported: that file's own
 * docstring carries the full reasoning, including the reverse-proxy assumption
 * this shares, and route handlers in this codebase stand alone. See it before
 * changing either copy.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` for the filename — the same reasoning as the CSV route's. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shelf: string }> },
) {
  const { shelf: slug } = await params;

  if (!sameOrigin(request)) {
    return new Response(null, { status: 403 });
  }

  const form = await request.formData();
  // `sach` is a whole title, `ban` an individual copy — the same two Vietnamese
  // words the selection page's checkboxes are named for. Both are expanded and
  // deduplicated by `listCopiesForLabels`, on the side that can still see the
  // table.
  const bookIds = form.getAll("sach").map(String).filter(Boolean);
  const copyIds = form.getAll("ban").map(String).filter(Boolean);

  // One transaction for both reads, so the filename's shelf name and the
  // sheet's contents are the same instant. `loadFile` answers `null` for every
  // refusal — no such shelf, no session, a session with no manager membership
  // here — without telling them apart.
  const found = await loadFile(slug, async (tx, ctx) => ({
    shelf: await readShelf(tx, ctx),
    copies: await listCopiesForLabels(tx, ctx, { bookIds, copyIds }),
  }));

  if (!found) return new Response(null, { status: 404 });

  // Nothing ticked, or everything ticked has been retired since the page was
  // drawn. A PDF of no labels is not a file worth handing back, and marking
  // nothing as printed is not a state worth recording.
  if (found.copies.length === 0) return new Response(null, { status: 400 });

  const body = await buildLabelSheet(found.copies, found.shelf.name);

  // Recorded only once the bytes exist. A generation that throws — a missing
  // font in a misconfigured image, most plausibly — must not leave four hundred
  // copies marked as printed for a sheet nobody ever received.
  await submitCommand(slug, markCopiesPrinted, {
    copyIds: found.copies.map((c) => c.id),
  });

  // One slugged, ASCII-only filename — no `filename*` twin.
  //
  // The CSV exports next door carry two spellings because their real name holds
  // the shelf's own *name*: "Bạn đọc — Tủ sách Đồng Tháp — 2026-08-13.csv"
  // cannot survive a `filename=` parameter, so RFC 6266's `filename*` carries
  // it and an ASCII fold trails behind as the fallback. This file is named from
  // the shelf's **slug**, which `olibra_fold` already guarantees is ASCII —
  // `dong-thap`, never `đồng-tháp` — so there is nothing for the second
  // spelling to rescue, and a name that survives every filesystem, every
  // `ls` and every phone's download list unchanged is worth more here than a
  // prettier one.
  //
  // Sorted-friendly on purpose: the date is last and in `YYYY-MM-DD`, so a
  // folder of print runs sorts chronologically within a shelf.
  const name = `QR-in-sach-${slug}-${today()}.pdf`;

  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      // Built, streamed, discarded. There is no temporary file and no cache,
      // here or anywhere between here and the browser.
      "Cache-Control": "no-store, private",
    },
  });
}
