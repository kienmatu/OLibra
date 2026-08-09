import { AlertCircle, Archive, CircleCheckBig } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Chip } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { messageFor } from "@/domain/kernel/errors";
import { getLostCopies } from "@/domain/catalogue/queries/get-lost-copies";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { CONDITION_LABELS } from "@/lib/status";
import { markCopyFoundAction, retireCopyAction } from "../../actions";

/** U1 §2. See `../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * BR §16.3's **Sách đã mất**, and that paragraph is unusually explicit about why
 * the screen exists at all:
 *
 * > "Báo mất" appears in three places in the built interface, and marking a copy
 * > found appears in none of them — a copy reported lost has been a one-way door
 * > in practice, even though §7.1 draws `lost → available` and §3 lists "a book
 * > reported lost is found months later" as a case the system must handle.
 * > Finding the one lost copy inside a shelf of a few hundred books, from within
 * > each book's own copy list, is not realistic.
 *
 * So the two buttons on each row are the point of the page, and until this wave
 * they were `<button>`s with no form behind them — the door was still one-way
 * with a picture of a handle on it. They now post `MarkCopyFound` and
 * `RetireCopy`, the two commands BR §7.1 draws out of `lost`, both of which have
 * existed since B1.
 *
 * **"Ngừng dùng" asks for its reason in place**, because
 * `book_copies_retired_has_reason` requires one and OPS §4.1 names
 * `retire_reason_required` for it — "Vui lòng ghi lý do ngừng dùng bản sách
 * này.", distinct from `reason_required`'s *huỷ*, which is cancelling something
 * rather than taking a book off the shelf for good. "Đánh dấu tìm thấy" asks for
 * nothing: a copy that turned up needs no explanation, and `markCopyFound`'s
 * optional note has no column to live in anyway (BR §5.4 gives BookCopy a "time
 * reported lost" and no found-note).
 *
 * **Rows carry the borrower's name and no telephone number.** That is a
 * deliberate difference from `qua-han` one nav entry away: BR §16.3 asks for the
 * phone *there* and gives the reason (it is how books come back), and asks for
 * neither here. A lost copy's way back is this screen, not a call.
 */
export default async function LostCopiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, copies } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      copies: await getLostCopies(tx, ctx),
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
      <div className="space-y-8">
        <PageHeading
          title="Sách đã mất"
          subtitle={`${NUMBER.format(copies.length)} bản đang ở trạng thái Đã mất.`}
        />

        {refused ? (
          <p
            role="alert"
            className="flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
          >
            <AlertCircle
              aria-hidden
              className="size-5 shrink-0"
              strokeWidth={1.75}
            />
            {messageFor(refused)}
          </p>
        ) : null}

        {/* BR §16.3 reaches this view "from the Sách list as a status filter", so
            the pair of chips is the same control on both screens. The count is
            this page's own row count here, and `getLostCopyCount` on the list. */}
        <div className="flex flex-wrap gap-2">
          <Chip href={`${base}/sach`}>Tất cả trạng thái</Chip>
          <Chip href={`${base}/sach/mat`} active>
            Đã mất ({NUMBER.format(copies.length)})
          </Chip>
        </div>

        {copies.length === 0 ? (
          <p className="text-[15px] text-meta">
            Hiện không có bản sách nào ở trạng thái đã mất.
          </p>
        ) : (
          <div className="space-y-4">
            {copies.map((copy) => (
              <Card key={copy.copyId}>
                <div className="flex items-start gap-4">
                  <BookCover title={copy.title} className="w-16 shrink-0 text-lg" />
                  <div className="min-w-0 flex-1">
                    <BookTitle as="p" className="text-[18px] leading-snug">
                      {copy.title}
                    </BookTitle>
                    <span className="mt-1.5 inline-block rounded-control bg-paper px-2 py-0.5 text-[13px] text-meta">
                      {copy.code}
                    </span>
                    {copy.lastBorrowerName ? (
                      <>
                        <p className="mt-2 text-[16px] font-medium">
                          {copy.lastBorrowerName}
                        </p>
                        <p className="mt-0.5 text-[14px] text-meta">
                          Người đang giữ khi báo mất
                        </p>
                      </>
                    ) : (
                      // A copy that reached `lost` without a loan behind it —
                      // reachable by import, or by a loan since voided. Listed
                      // with the fact stated rather than with a name guessed.
                      <p className="mt-2 text-[14px] text-meta">
                        Không rõ ai đang giữ khi báo mất
                      </p>
                    )}
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right md:flex">
                    <StatusBadge status="lost" />
                    {copy.reportedAt ? (
                      <p className="text-[14px] text-meta">
                        {/* `lost_reported_at` is a `timestamptz`, so
                            `formatInstant` — the shelf's own timezone, never
                            `formatDate`, which reads a calendar date. */}
                        Báo mất ngày {formatInstant(copy.reportedAt)}
                      </p>
                    ) : null}
                    <p className="text-[14px] text-meta">
                      Tình trạng {CONDITION_LABELS[copy.condition].toLowerCase()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 md:hidden">
                  <StatusBadge status="lost" />
                  {copy.reportedAt ? (
                    <p className="w-full text-[14px] text-meta">
                      Báo mất ngày {formatInstant(copy.reportedAt)}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-hairline pt-4">
                  <form action={markCopyFoundAction}>
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input type="hidden" name="ban" value={copy.copyId} />
                    <SubmitButton
                      variant="quiet"
                      size="sm"
                      icon={
                        <CircleCheckBig
                          aria-hidden
                          className="size-4"
                          strokeWidth={1.75}
                        />
                      }
                    >
                      Đánh dấu tìm thấy
                    </SubmitButton>
                  </form>

                  <details className="min-w-0">
                    <summary className="inline-flex h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-hairline bg-surface px-4 text-[15px] font-semibold text-ink transition-colors hover:bg-paper [&::-webkit-details-marker]:hidden">
                      <Archive aria-hidden className="size-4" strokeWidth={1.75} />
                      Ngừng dùng
                    </summary>
                    <form
                      action={retireCopyAction}
                      className="mt-3 w-full max-w-md space-y-3"
                    >
                      <input type="hidden" name="tu-sach" value={slug} />
                      <input type="hidden" name="ban" value={copy.copyId} />
                      <Field
                        label="Lý do ngừng dùng"
                        required
                        htmlFor={`ly-do-${copy.copyId}`}
                        hint="Dùng khi biết chắc sách sẽ không quay lại nữa."
                      >
                        <Input id={`ly-do-${copy.copyId}`} name="ly-do" required />
                      </Field>
                      <SubmitButton variant="danger" size="md">
                        Xác nhận ngừng dùng
                      </SubmitButton>
                    </form>
                  </details>

                  <ButtonLink
                    href={`${base}/sach/${copy.bookSlug}`}
                    variant="quiet"
                    size="sm"
                  >
                    Xem bản
                  </ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="text-[14px] text-meta">
          Đánh dấu tìm thấy trả bản sách về Còn sách. Ngừng dùng đưa bản sách ra
          khỏi tủ sách hẳn, dùng khi biết chắc sách sẽ không quay lại nữa.
        </p>
      </div>
    </ManagerShell>
  );
}
