import Link from "next/link";
import { QrCode } from "lucide-react";
import { ReaderScan } from "@/components/reader-scan";
import { ShelfHeader } from "@/components/shell/public-header";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveCopyById } from "@/domain/catalogue/queries/resolve-copy-by-id";
import { messageFor } from "@/domain/kernel/errors";
import { atLeast } from "@/domain/kernel/tenant";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelfIdentity } from "@/lib/shelf";
import { COPY_STATE_STATUS } from "@/lib/status";
import { confirmScanBorrowAction } from "./actions";

/** U1 §2. See `src/app/tu-sach/[shelf]/page.tsx` for the long version. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Quét mã sách — OLibra" };

/**
 * BR §19's reader half: pick a book off the shelf, scan the sticker on its
 * cover, ask to borrow *that* copy.
 *
 * **Two states in one route, keyed on `?ban=`.** Without it, the scanner.
 * With it, the confirmation naming the copy the scan resolved to. One URL
 * because they are one act interrupted by a decision, and because the back
 * button then means what a reader expects it to.
 *
 * **The confirmation is a real second step, never skipped.** A request created
 * by the act of scanning would make every mis-scan — the sticker on the next
 * book along, a shelf brushed past — a row a manager has to reject.
 *
 * **A copy that is not `available` shows its state and no button.** A control
 * the copy's own state cannot use must not render; that is the same rule
 * `sach/[id]/page.tsx` follows for its copy-state controls, and the reason is
 * the same — a button that always refuses is a dead button with extra steps.
 * The reader can still queue for the *title* from the book page, which is what
 * the link underneath is for.
 */
export default async function QuetMaPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const scanned = param(search, "ban");
  const scannedAt = param(search, "luc");
  const expired = param(search, "qua-han") === "1";
  const refused = refusalFrom(search);

  const { shelf, viewer, copy, membershipId } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelfIdentity(tx, ctx),
      viewer,
      // Taken from the context the seam already resolved, never from the URL —
      // the same route `sach/[slug]/page.tsx` takes it by, and it is checked
      // against `ctx.actor.membershipId` inside the command besides.
      membershipId: ctx.actor.membershipId,
      copy: scanned ? await resolveCopyById(tx, ctx, scanned) : null,
    }),
  );

  const base = `/tu-sach/${slug}`;
  // A guest can reach this page and scan; they simply cannot ask to borrow.
  const lendable = copy?.state === "available" && membershipId !== null;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="danh-muc"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
        canManage={atLeast(viewer.role, "manager")}
        isSuperAdmin={atLeast(viewer.role, "super_admin")}
      />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-[28px] leading-tight font-semibold">Quét mã sách</h1>

        {expired ? (
          <p role="alert" className="mt-4 text-[16px] text-brick">
            Mã đã cũ rồi, bạn quét lại giúp nhé.
          </p>
        ) : null}
        {refused ? (
          <p role="alert" className="mt-4 text-[16px] text-brick">
            {messageFor(refused)}
          </p>
        ) : null}

        {!scanned ? (
          <div className="mt-6 space-y-4">
            <p className="text-[16px] text-meta">
              Cầm cuốn sách bạn muốn mượn, rồi quét ô vuông dán trên bìa.
            </p>
            <ReaderScan basePath={`${base}/quet-ma`} />
          </div>
        ) : !copy ? (
          <div className="mt-6 space-y-4">
            {/* One sentence for every way a scan can fail to resolve — another
                parish's sticker, a copy retired since it was labelled, a QR
                from something that is not a book. Telling them apart would
                tell a stranger what this shelf holds. */}
            <p className="text-[16px]">Mã này không thuộc tủ sách của bạn.</p>
            <ReaderScan basePath={`${base}/quet-ma`} />
          </div>
        ) : (
          <Card className="mt-6">
            <div className="flex items-start gap-4">
              <BookCover title={copy.title} className="w-20 text-[1rem]" />
              <div className="min-w-0 flex-1 space-y-1">
                <BookTitle as="h2" className="text-[20px] leading-snug">
                  {copy.title}
                </BookTitle>
                {copy.author ? (
                  <p className="text-[15px] text-meta">{copy.author}</p>
                ) : null}
                <p className="flex items-center gap-2 text-[15px]">
                  <QrCode aria-hidden className="size-4" strokeWidth={1.75} />
                  {copy.code}
                </p>
                <StatusBadge status={COPY_STATE_STATUS[copy.state]} />
              </div>
            </div>

            {lendable ? (
              <form action={confirmScanBorrowAction} className="mt-6 space-y-3">
                <input type="hidden" name="tu-sach" value={slug} />
                <input type="hidden" name="ban" value={copy.id} />
                <input type="hidden" name="sach-id" value={copy.bookId} />
                <input type="hidden" name="thanh-vien" value={membershipId ?? ""} />
                {/* The moment of the scan. Refused past five minutes by the
                    action — see its docstring for why it is unsigned. */}
                <input type="hidden" name="luc" value={scannedAt ?? ""} />
                <SubmitButton>Xác nhận xin mượn bản này</SubmitButton>
              </form>
            ) : (
              <p className="mt-6 text-[16px]">
                Bản này hiện không cho mượn được.{" "}
                <Link
                  href={`${base}/sach/${copy.bookSlug}`}
                  className="text-sage underline"
                >
                  Xem cuốn sách và xin mượn bản khác
                </Link>
              </p>
            )}
          </Card>
        )}
      </main>
    </>
  );
}
