import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { BookFields, PublishedToggle } from "@/components/book-fields";
import { DonorFields } from "@/components/donor-fields";
import { messageFor } from "@/domain/kernel/errors";
import { getReadersList } from "@/domain/members/queries/get-readers-list";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { readCategoryOptions } from "@/lib/catalogue";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { createBookAction } from "../../actions";

/** U1 §2. See `../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

/**
 * How many members the donor picker offers.
 *
 * `getReadersList` is paged and its own ceiling is 100. A shelf with more active
 * members than that has a picker that cannot reach all of them, and the outsider
 * text field beside it is not the answer for a member who exists. Recorded
 * rather than hidden: making this a search is the wave that also makes the
 * donation queue real (B3), and `DonorFields`' own docstring already carries the
 * argument for why the member id, not a typed name, is what
 * `book_copies.acquired_from_membership_id` needs.
 */
const DONOR_PAGE_SIZE = 100;

/**
 * `?nam-xb=`/`?so-trang=` back to a number for `BookFields`' `defaultValues`,
 * or `null` for anything that is not one — including "not present at all",
 * which is the ordinary case (Task 13, 2026-08-10 QA remediation). Not
 * `wholeNumber` from `../../actions.ts`: that helper reads a `FormData` field
 * by name, and this reads a query-string value already in hand.
 */
function numberOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * BR §16.3's create form: "the create and edit form is single-column with the
 * cover uploader first, since a photograph is the strongest recognition cue."
 *
 * ── The cover uploader is gone, and it is the one part of that sentence this
 * page cannot honour ────────────────────────────────────────────────────────
 *
 * `createBook` takes a `coverUrl` — a URL to an object *already* in storage —
 * and nothing in this application puts one there. The only upload path that
 * exists is the avatar's (`src/lib/avatar.ts`), which is built around a
 * `ProfileChangeRequest` and its lifecycle of proposal, decision and deletion; a
 * book cover has none of that and would need its own size limit, its own
 * content-type list, its own answer for what a failed `put` does to the rest of
 * the form, and its own retention story. U1 §6.1 recorded the identical gap for
 * the return photo and deferred it for the identical reasons. So the dashed
 * "Tải ảnh bìa" box is removed rather than left inert — `BookCover` already
 * draws the kraft cover its caption promised, everywhere in the app.
 *
 * ── And the three copy codes it previewed are gone ──────────────────────────
 *
 * The fixture showed `DT-0215 DT-0216 DT-0217` beside the copy-count field.
 * `allocateCopyCodes` assigns them inside the command's own transaction, under a
 * per-shelf advisory lock, precisely so two managers cataloguing at once cannot
 * both claim the same code — so a preview rendered before the form is submitted
 * is a guess this page has no way to make true. The hint keeps saying that codes
 * are assigned; it no longer says which.
 *
 * That last sentence was not true when it was written. The hint still ended
 * "ví dụ DT-0215" — the same code, minus two of the three, still named before
 * anything had been allocated. It made a second claim as well, and a worse one:
 * `copyCodePrefix` (`src/domain/catalogue/policy.ts:183`) derives the prefix
 * from the shelf's slug, so `vinh-long` mints `VL-`, `can-tho` `CT-` and
 * `ben-tre` `BT-`. On three of the four seeded shelves the form promised a
 * prefix the system will not mint. It is a `hint=` attribute rather than a
 * rendered record, so `a-wired-page-renders-no-fixtures` was never going to see
 * it; it was a hand-typed factual claim about this shelf all the same.
 *
 * ── What is real ───────────────────────────────────────────────────────────
 *
 * The category `<select>` is `readCategoryOptions` — **every** global category,
 * not the ones this shelf already stocks, because the first book of a new kind
 * is exactly the one that could not otherwise be catalogued (that helper's
 * docstring holds the distinction against the filter bar's list). The donor
 * picker is this shelf's own members, which is what `DonorFields` was waiting
 * for: it shipped rendering eleven invented children from `src/lib/fixtures.ts`,
 * on a page one tap from writing a fabricated membership id into
 * `book_copies.acquired_from_membership_id`.
 *
 * Refusals come back through `?loi=` and render as `ERROR_MESSAGES`' own
 * sentences — `duplicate_isbn`, `category_not_found`, `copy_count_invalid`,
 * `required_fields_missing`.
 *
 * **`BookFields` now repopulates itself on a refusal** (Task 13, 2026-08-10 QA
 * remediation), which this docstring used to say was not worth doing: "a title
 * and an author are quick to retype and a query string carrying a description is
 * not." The second half is still true and is why this page is more conservative
 * than `dang-ky`'s — no field here is a fact about a child, so there was never a
 * privacy cost to weigh, only a convenience one, and a 300-character "Mô tả" does
 * travel in the query string now. What changed is that `createBookAction` reuses
 * `BookFields`' own `defaultValues` prop, the same one `sach/[id]/sua` already
 * fills from `getBookForEdit` — wiring it from `?ten-sach=` and its seven
 * siblings instead of from a row is a few lines, not a new mechanism, once the
 * identical fix was already going into `dang-ky` and `nguoi-doc/moi` for their
 * own, heavier reasons. `so-ban`, the donor picker and "Hiện sách này" stay out
 * of it: each already defaults to something reasonable, and none of the four
 * refusal codes above is caused by any of the three.
 */
export default async function NewBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);
  // BR §16.3's donation queue opens this form with the donor already known.
  // B3 owns that queue; the parameter is read now so the two halves agree when
  // it arrives, and it is a membership id the picker either has or ignores.
  const donorParam = param(search, "nguoi-tang");

  // Task 13 (2026-08-10 QA remediation): what a manager typed, read back after
  // a refusal — `createBookAction` writes these seven, and only these seven,
  // in its own `?ten-sach=…` query string. `BookFields`' `defaultValues` prop
  // already exists for `sach/[id]/sua`'s edit form; this is the same shape from
  // a different source, not a new one. `Number(...)` rather than `wholeNumber`
  // (which lives in `../../actions.ts` and reads a `FormData`, not a query
  // string): a box the manager left blank reads back `undefined` here, and
  // `Number(undefined)` is `NaN`, so an absent field renders empty rather than
  // as the literal text "NaN".
  const bookDefaults = {
    title: param(search, "ten-sach") ?? "",
    author: param(search, "tac-gia") ?? null,
    categorySlug: param(search, "the-loai") ?? null,
    publisher: param(search, "nxb") ?? null,
    publishedYear: numberOrNull(param(search, "nam-xb")),
    pageCount: numberOrNull(param(search, "so-trang")),
    isbn: param(search, "isbn") ?? null,
    description: param(search, "mo-ta") ?? null,
  };

  const { shelf, viewer, counts, categories, donors } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      categories: await readCategoryOptions(tx, ctx),
      // Only members who could plausibly be standing at the shelf handing over
      // a book — `DonorFields` states the rule and this is a caller applying it.
      // Somebody who has left has no ongoing relationship to link the gift to,
      // and somebody still `pending` is not yet a member at all.
      donors: await getReadersList(tx, ctx, {
        status: "active",
        pageSize: DONOR_PAGE_SIZE,
      }),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="sach"
      viewer={viewer}
      counts={counts}
    >
      <Link
        href={`${base}/sach`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách sách
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">
        Thêm sách mới
      </h1>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      <form action={createBookAction} className="mt-8 max-w-2xl space-y-10">
        <input type="hidden" name="tu-sach" value={slug} />

        <BookFields categories={categories} defaultValues={bookDefaults} />

        {/* A code is assigned per copy, inside the command's own transaction.
            See this page's docstring for why no codes are previewed here — and
            why the hint no longer names a prefix either: `copyCodePrefix`
            derives it from the shelf slug, so `DT-` was true on one of the four
            seeded shelves and a promise the system would break on `vinh-long`,
            `can-tho` and `ben-tre`. */}
        <div className="space-y-3 rounded-card border border-hairline bg-surface p-5">
          <Field
            label="Số bản sách"
            required
            htmlFor="so-ban"
            hint="Tủ sách tự đặt mã cho từng bản, không cần điền."
          >
            <Input
              id="so-ban"
              name="so-ban"
              type="number"
              min={1}
              defaultValue={1}
              required
              className="max-w-32"
            />
          </Field>
        </div>

        <DonorFields
          idPrefix="nguoi-tang"
          selectedMemberId={donorParam}
          donors={donors.rows.map((r) => ({
            id: r.membershipId,
            fullName: r.fullName,
          }))}
        />

        {/* Checked by default, matching `createBook`'s own
            `input.published ?? true`. */}
        <PublishedToggle />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Lưu sách</SubmitButton>
          <ButtonLink href={`${base}/sach`} variant="ghost" size="lg">
            Huỷ
          </ButtonLink>
        </div>
      </form>
    </ManagerShell>
  );
}
