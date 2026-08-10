import Link from "next/link";
import { BookCheck } from "lucide-react";
import { BookTitle } from "@/components/ui/book";
import { PageHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { getMyLoanHistory } from "@/domain/circulation/queries/get-my-dashboard";
import { CONDITION_LABELS } from "@/lib/status";
import { isCopyCondition } from "@/domain/catalogue/policy";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";

/**
 * OPS §3.2's `GetMyLoanHistory` — BR §16.2's "Recent history", in full.
 *
 * Every loan, not just returned ones: the one a reader most wants to find is
 * often the one still out. `status` comes from the query so the row can say
 * `Đang mượn`, `Đã trả` or `Đã mất` rather than inferring it from which
 * timestamps happen to be null — the same reason `getMyLoanHistory` returns it.
 */
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  active: "Đang mượn",
  returned: "Đã trả",
  lost: "Đã mất",
  voided: "Đã huỷ",
};

export default async function ReaderHistoryPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, history } = await loadPage(slug, async (tx, ctx, v) => ({
    shelf: await readShelf(tx, ctx),
    viewer: v,
    history: await getMyLoanHistory(tx, ctx, { limit: 200 }),
  }));

  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />
      <ReaderTabs shelfSlug={slug} active="trang-cua-toi" />

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeading
          title="Lịch sử mượn sách"
          subtitle={
            history.length === 0
              ? "Em chưa mượn cuốn nào."
              : `${history.length} lượt mượn, mới nhất trước.`
          }
        />

        {history.length > 0 ? (
          <ul className="mt-8 divide-y divide-hairline rounded-card border border-hairline bg-surface">
            {history.map((h) => (
              <li key={h.loanId} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`${base}/sach/${h.slug}`} className="min-w-0 flex-1">
                    <BookTitle className="block text-[15px] leading-snug">
                      {h.title}
                    </BookTitle>
                  </Link>
                  <span className="shrink-0 text-[13px] text-meta">
                    {STATUS_LABEL[h.status] ?? h.status}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-meta">
                  Mượn {formatInstant(h.lentOn)}
                  {h.returnedOn ? ` · trả ${formatInstant(h.returnedOn)}` : ""}
                </p>
                {h.returnCondition && isCopyCondition(h.returnCondition) ? (
                  <div className="mt-2">
                    <Pill
                      icon={BookCheck}
                      label={`Tình trạng ${CONDITION_LABELS[h.returnCondition]}`}
                      tone="available"
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 text-[14px] text-meta">
            Khi em mượn sách, lượt mượn sẽ hiện ở đây.
          </p>
        )}

        <Link
          href={`${base}/toi`}
          className="mt-8 inline-block text-[14px] underline"
        >
          Về trang của tôi
        </Link>
      </main>
    </>
  );
}
