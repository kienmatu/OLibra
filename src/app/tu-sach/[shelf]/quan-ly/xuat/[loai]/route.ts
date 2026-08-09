import {
  exportBooks,
  exportLoans,
  exportReaders,
} from "@/domain/shelf/queries/exports";
import { readShelf } from "@/lib/shelf";
import { attachmentHeader, CSV_CONTENT_TYPE, toCsvBytes } from "@/lib/csv";
import { booksTable, type CsvTable, loansTable, readersTable } from "@/lib/exports";
import { loadFile } from "@/lib/page-data";

/**
 * OPS §3.3's `ExportBooksCSV`, `ExportReadersCSV` and `ExportLoansCSV`, as the
 * one route they come back through.
 *
 * **`force-dynamic`, and this is the first `route.ts` in the application.** The
 * two architecture guards that enforce it globbed `page|layout` only until this
 * slice, so a route handler reaching Postgres was invisible to both;
 * `tests/architecture/pages-reading-the-database-are-dynamic.test.ts` now globs
 * the wider set that `compose-supplies-storage-env.test.ts` already used. U1
 * §2's argument does not weaken for a route: a cached response here is one
 * shelf's children's records served to another shelf's manager, with no SQL
 * issued and therefore nothing for RLS to refuse.
 *
 * **`POST`, and there is deliberately no `GET`.** P1 §3.5(c): a file holding
 * every child's name, date of birth, parents' names and telephone number must
 * not sit behind a URL "a shared parish phone keeps in its address bar". A
 * `GET` is a link — bookmarkable, in the history, in the autocomplete list of
 * the next volunteer to type "tu-" — and a browser will happily re-issue it.
 * A form `POST` leaves none of that behind. Next.js returns 405 for the verbs a
 * handler does not export, so the absence of `GET` is itself the refusal.
 *
 * **The slug in the URL names a file, never a table.** `sach`, `nguoi-doc` and
 * `muon-tra` are the same Vietnamese slugs the rest of this application's URLs
 * use, and they resolve through `Object.hasOwn` on a closed map — an unknown
 * one is a 404, and `constructor` is an unknown one. Nothing from the URL
 * reaches SQL.
 */
export const dynamic = "force-dynamic";

/**
 * The three exports, each as: the query that reads it, the table that names its
 * columns, and the two spellings of its filename.
 *
 * A `Record` keyed by the URL slug, so adding a fourth export is one entry and
 * cannot half-exist — a query with no filename, or a filename with no query, is
 * not expressible.
 *
 * The ASCII filename is the fallback and is folded by hand rather than by
 * `olibra_fold`, which is a Postgres function and not reachable here; three
 * fixed strings need no algorithm. The real name carries the shelf's own name
 * and the date, and goes in RFC 6266's `filename*` — see `src/lib/csv.ts`.
 */
const EXPORTS = {
  sach: {
    ascii: "sach",
    label: "Sách",
    load: async (
      tx: Parameters<typeof exportBooks>[0],
      ctx: Parameters<typeof exportBooks>[1],
    ): Promise<CsvTable> => booksTable(await exportBooks(tx, ctx)),
  },
  "nguoi-doc": {
    ascii: "nguoi-doc",
    label: "Bạn đọc",
    load: async (
      tx: Parameters<typeof exportReaders>[0],
      ctx: Parameters<typeof exportReaders>[1],
    ): Promise<CsvTable> => readersTable(await exportReaders(tx, ctx)),
  },
  "muon-tra": {
    ascii: "muon-tra",
    label: "Lượt mượn",
    load: async (
      tx: Parameters<typeof exportLoans>[0],
      ctx: Parameters<typeof exportLoans>[1],
    ): Promise<CsvTable> => loansTable(await exportLoans(tx, ctx)),
  },
} as const;

type ExportKind = keyof typeof EXPORTS;

/**
 * `YYYY-MM-DD` for the filename, from the same clock the domain uses.
 *
 * Not `formatDate`: a filename is not read by a locale, it is sorted by one
 * `ls` and one Downloads folder, and `02-04-2015.csv` sorts nowhere useful.
 * This is the same reasoning `src/lib/exports.ts` records for the date columns.
 */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Refuse a cross-site form post.
 *
 * Not the reason this is a `POST` — that is §3.5(c), above — and not a serious
 * exfiltration risk either: a cross-origin form post cannot read the response,
 * so the worst it achieves is a file landing in a signed-in manager's Downloads
 * folder. It is three lines, and a `POST` that any page on the internet can
 * make a volunteer's browser issue against their own library is not a thing to
 * leave standing because the payoff is small. Server actions get this check
 * from the framework; a route handler does not.
 *
 * A missing `Origin` is allowed: browsers send it on every cross-origin form
 * post, so its absence means a caller that is not a browser — `curl`, a health
 * check, a test — and refusing those would be refusing on the strength of a
 * header anybody can omit anyway.
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shelf: string; loai: string }> },
) {
  const { shelf: slug, loai } = await params;

  if (!sameOrigin(request)) {
    return new Response(null, { status: 403 });
  }

  // `Object.hasOwn`, never `in` — `src/lib/search-params.ts`'s `refusalFrom`
  // carries the long version. This map is named by a URL segment, and
  // `"constructor" in EXPORTS` is `true`; the lookup would then return a
  // *function* and `.load` would be `undefined`, which is a 500 rather than the
  // 404 a mistyped address deserves.
  if (!Object.hasOwn(EXPORTS, loai)) {
    return new Response(null, { status: 404 });
  }
  const kind = EXPORTS[loai as ExportKind];

  // One transaction for both reads, so the filename's shelf name and the file's
  // contents are the same instant. `loadFile` answers `null` for every refusal
  // — no such shelf, no session, a session with no manager membership here —
  // see its docstring for why they are not told apart.
  const found = await loadFile(slug, async (tx, ctx) => ({
    shelf: await readShelf(tx, ctx),
    table: await kind.load(tx, ctx),
  }));

  if (!found) return new Response(null, { status: 404 });

  // `.buffer` rather than the `Uint8Array` itself: `BodyInit` accepts an
  // `ArrayBuffer`, and passing the view types cleanly across the DOM lib's
  // `ArrayBufferLike` generic. The bytes are the same bytes — including the
  // three the BOM occupies, which is the whole reason this is a byte array and
  // not a string (see `src/lib/csv.ts`).
  const body = toCsvBytes(found.table.headers, found.table.rows);
  const date = today();

  return new Response(body.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": attachmentHeader(
        `${kind.ascii}-${slug}-${date}.csv`,
        `${kind.label} — ${found.shelf.name} — ${date}.csv`,
      ),
      // A file of children's records is never cached, by the browser or by
      // anything between it and here. `force-dynamic` governs Next's own
      // caches; this governs everybody else's.
      "Cache-Control": "no-store, private",
    },
  });
}
