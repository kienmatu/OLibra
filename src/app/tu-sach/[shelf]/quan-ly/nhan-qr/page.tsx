import { ChevronDown, Printer } from "lucide-react";
import { SelectAllCopies } from "@/components/select-all-copies";
import { ManagerShell } from "@/components/shell/manager-shell";
import { BookTitle } from "@/components/ui/book";
import { PageHeading } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { SubmitButton } from "@/components/ui/submit-button";
import { listTitlesForLabels } from "@/domain/catalogue/queries/list-titles-for-labels";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/** U1 §2. See `../cho-muon/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

export const metadata = { title: "In mã QR — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** `?loc=tat-ca` widens the list; anything else, including absent, means unprinted only. */
const FILTER = "loc";
const ALL = "tat-ca";

/**
 * Named so `SelectAllCopies` can find the form it belongs to.
 *
 * A `document.getElementById` rather than a ref, because the button is a client
 * component and the form around it is server-rendered — there is no shared
 * React tree to pass a ref through, and lifting the whole form into a client
 * component to gain one would trade a screen that works without JavaScript for
 * a convenience.
 */
const FORM_ID = "chon-ban-in-nhan";

/**
 * BR §19's "QR labels per copy", the screen a manager picks from.
 *
 * **The accordion is `<details>`/`<summary>`, not a client component.** A title
 * collapsed shows its name and copy count; opened, it lists its copies. That is
 * exactly what the element does, natively, with no JavaScript, no hydration and
 * no state to get wrong — and it keeps working on the ageing phone in a parish
 * hall with a bad connection.
 *
 * **Ticking a title means "every copy of this title", and it means it at submit
 * time, not at render time.** The form posts book ids and copy ids separately
 * (`sach` and `ban`), and `listCopiesForLabels` expands the titles server-side.
 * A parent checkbox that ticked its children in the browser would need
 * JavaScript and would expand against whatever the page was drawn with — which
 * is stale the moment another manager adds a copy. So the absence of that
 * behaviour is the design, not a limitation being apologised for.
 *
 * **`Chưa in mã` is the default filter** because it is the common case after
 * the first print run: a volunteer who catalogued three books on Sunday wants
 * three stickers, not four hundred. `qr_print_count` — not a boolean — is what
 * makes that filter honest about a reprint.
 */
export default async function NhanQrPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const onlyUnprinted = param(await searchParams, FILTER) !== ALL;

  const { shelf, viewer, counts, titles } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      titles: await listTitlesForLabels(tx, ctx, { onlyUnprinted }),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  const copyTotal = titles.reduce((n, t) => n + t.copies.length, 0);

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="sach"
      viewer={viewer}
      counts={counts}
    >
      <PageHeading
        title="In mã QR"
        subtitle="Chọn sách hoặc từng bản, tải tệp PDF về rồi in và dán lên bìa sách."
      />

      <Segmented
        className="mt-5"
        options={[
          {
            href: `${base}/nhan-qr`,
            label: "Chưa in mã",
            active: onlyUnprinted,
          },
          {
            href: `${base}/nhan-qr?${FILTER}=${ALL}`,
            label: "Tất cả",
            active: !onlyUnprinted,
          },
        ]}
      />

      {titles.length === 0 ? (
        <p className="mt-8 text-[16px] text-meta">
          {onlyUnprinted
            ? "Mọi bản sách trong tủ đều đã in mã QR."
            : "Chưa có bản sách nào trong tủ."}
        </p>
      ) : (
        <form
          id={FORM_ID}
          method="post"
          action={`${base}/xuat/nhan-qr`}
          className="mt-6 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[15px] text-meta">
              {NUMBER.format(titles.length)} đầu sách · {NUMBER.format(copyTotal)}{" "}
              bản
            </p>
            <SelectAllCopies formId={FORM_ID} />
          </div>

          <ul className="space-y-2">
            {titles.map((title) => (
              <li
                key={title.bookId}
                className="rounded-card border border-hairline bg-surface"
              >
                {/* The title's checkbox is a *sibling* of the `<details>`, not
                    a child of its `<summary>`. Nested inside, every tick of the
                    box would also toggle the accordion — the summary swallows
                    the click — and untangling that needs JavaScript this screen
                    otherwise does without entirely. */}
                <div className="flex items-start gap-3 p-3">
                  <Checkbox
                    name="sach"
                    value={title.bookId}
                    label={`Chọn mọi bản của ${title.title}`}
                    labelHidden
                  />

                  <details className="group min-w-0 flex-1">
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <BookTitle className="block text-[17px]">
                          {title.title}
                        </BookTitle>
                        <span className="block text-[14px] text-meta">
                          {title.author ? `${title.author} · ` : ""}
                          {NUMBER.format(title.copies.length)} bản
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden
                        className="size-5 shrink-0 text-meta transition-transform group-open:rotate-180"
                        strokeWidth={1.75}
                      />
                    </summary>

                    <ul className="mt-2 space-y-1 border-t border-hairline pt-2">
                      {title.copies.map((copy) => (
                        <li key={copy.id}>
                          <Checkbox
                            name="ban"
                            value={copy.id}
                            label={copy.code}
                            hint={
                              copy.printCount > 0
                                ? `Đã in ${NUMBER.format(copy.printCount)} lần`
                                : "Chưa in mã"
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </li>
            ))}
          </ul>

          <SubmitButton icon={<Printer aria-hidden className="size-5" />}>
            In mã QR
          </SubmitButton>
          <p className="text-[14px] text-meta">
            Mỗi trang A4 in được 21 mã. Tệp in vừa cả khổ A4 và khổ Letter.
          </p>
        </form>
      )}
    </ManagerShell>
  );
}
