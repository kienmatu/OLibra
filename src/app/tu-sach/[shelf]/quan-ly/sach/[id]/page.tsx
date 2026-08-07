import { notFound } from "next/navigation";
import { CircleCheckBig, Pencil, Plus } from "lucide-react";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { ManagerShell } from "@/components/shell/manager-shell";
import { DonorFields } from "@/components/donor-fields";
import { bookBySlug, books, shelfBySlug, shelves } from "@/lib/fixtures";
import type { CopyStatus } from "@/lib/status";

export function generateStaticParams() {
  return shelves.flatMap((s) => books.map((b) => ({ shelf: s.slug, id: b.slug })));
}

// Ngày nhận (below, on the "Thêm bản" form) needs today's date in
// Asia/Ho_Chi_Minh, computed per request — a statically-prerendered page
// cannot do that, since `new Date()` at build time freezes forever. Forced
// dynamic rendering is what keeps this page's default in step with the
// "Thêm sách" form, which reads `searchParams` and is already dynamic for
// that reason (IMPORTANT 1 of the refinements review).
export const dynamic = "force-dynamic";

const COPIES: {
  code: string;
  status: CopyStatus;
  condition: string;
  location: string;
}[] = [
  {
    code: "DT-0140",
    status: "available",
    condition: "Nguyên vẹn",
    location: "Trong tủ",
  },
  {
    code: "DT-0141",
    status: "onloan",
    condition: "Hơi cũ",
    location: "Giuse Trần Minh · hạn 20/08",
  },
  {
    code: "DT-0142",
    status: "lost",
    condition: "Nguyên vẹn",
    location: "Maria Vũ Khánh Linh · báo mất 22/07",
  },
];

const CONDITION_HISTORY = [
  {
    date: "20/07",
    text: "Bản DT-0141 được đánh giá khi cho Giuse Trần Minh mượn.",
    condition: "Hơi cũ",
  },
  {
    date: "05/07",
    text: "Bản DT-0142 được đánh giá khi nhận trả từ Têrêsa Lê Ngọc Ánh.",
    condition: "Nguyên vẹn",
  },
  {
    date: "18/06",
    text: "Bản DT-0140 được đánh giá khi nhận trả từ Anna Phạm Thu Hà.",
    condition: "Nguyên vẹn",
  },
];

const LOAN_HISTORY = [
  {
    code: "DT-0140",
    borrower: "Maria Nguyễn Thị Lan",
    from: "02/06",
    to: "16/06",
    condition: "Nguyên vẹn",
  },
  {
    code: "DT-0141",
    borrower: "Giuse Trần Minh",
    from: "20/06",
    to: "—",
    condition: "Đang mượn",
  },
  {
    code: "DT-0142",
    borrower: "Têrêsa Lê Ngọc Ánh",
    from: "22/06",
    to: "05/07",
    condition: "Nguyên vẹn",
  },
  {
    code: "DT-0142",
    borrower: "Maria Vũ Khánh Linh",
    from: "08/07",
    to: "—",
    condition: "Báo mất 22/07",
  },
  {
    code: "DT-0140",
    borrower: "Anna Phạm Thu Hà",
    from: "04/06",
    to: "18/06",
    condition: "Nguyên vẹn",
  },
];

export default async function ManagerBookDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}) {
  const { shelf: shelfSlug, id } = await params;
  const shelf = shelfBySlug(shelfSlug);
  const book = bookBySlug(id);
  if (!shelf || !book) notFound();

  const base = `/tu-sach/${shelf.slug}/quan-ly`;

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="sach">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4">
          <BookCover title={book.title} className="w-24 text-[1.6rem]" />
          <div>
            <BookTitle as="h1" className="block text-[28px] leading-tight">
              {book.title}
            </BookTitle>
            <p className="mt-1 text-[16px] text-meta">{book.author}</p>
            <p className="mt-1 text-[14px] text-meta">
              {book.category} · {book.publisher} · {book.year} · {book.pages} trang
            </p>
          </div>
        </div>
        <ButtonLink href={`${base}/sach`} variant="primary" size="lg">
          <Pencil aria-hidden className="size-5" strokeWidth={1.75} />
          Sửa sách
        </ButtonLink>
      </div>

      <section className="mt-10">
        {/* A title receives more donated copies over time, so the copy count
            has to be able to grow after cataloguing. This is the only entry
            point for that — "Sửa sách" edits the title, not the shelf. */}
        {/* items-start, not items-center: the disclosure's body grows tall
            once opened, and centring against it left the heading floating
            in the middle of that height instead of sitting at the top. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="pt-2.5 text-xl font-semibold">
            Các bản sách ({COPIES.length})
          </h2>
          {/* A <details> disclosure, not a separate page: adding more copies
              to a title already catalogued is only two fields beyond the
              count, so a whole route and a "quay lại" trip back here would be
              more navigation than the task needs. It needs no client
              JavaScript, matching every other static page in this shell. */}
          <details className="group">
            {/* A `<summary>` cannot render as `<Button>` — it isn't a button
                or a link — so it reuses the exact same class builder instead
                of a hand-rolled copy that would drift from it (M1/M2). */}
            <summary
              className={buttonClasses(
                "quiet",
                "sm",
                "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              <Plus aria-hidden className="size-4" strokeWidth={2} />
              Thêm bản
            </summary>

            <form className="mt-4 max-w-md space-y-5 rounded-card border border-hairline bg-paper p-5">
              <Field
                label="Số bản muốn thêm"
                required
                htmlFor="them-so-ban"
                hint="Hệ thống sẽ tự sinh mã tiếp theo, ví dụ DT-0143."
              >
                <Input
                  id="them-so-ban"
                  type="number"
                  min={1}
                  defaultValue={1}
                  className="max-w-32"
                />
              </Field>

              <DonorFields idPrefix="them-nguoi-tang" />

              {/* Outline, not solid: "Sửa sách" above is already this
                  screen's one primary action (AGENTS.md/button.tsx — "if two
                  things on a screen are terracotta, one of them is wrong").
                  This form only exists once the disclosure is open, at which
                  point both buttons are on screen at once. */}
              <Button type="submit" variant="outline" size="md">
                Lưu bản mới
              </Button>
            </form>
          </details>
        </div>

        <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
          <table className="w-full text-left">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Mã bản
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Tình trạng
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Chất lượng
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Đang ở đâu
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {COPIES.map((copy) => (
                <tr key={copy.code}>
                  <td className="px-4 py-3 text-[15px] font-medium">{copy.code}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={copy.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    {copy.condition}
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    {copy.location}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {copy.status === "lost" ? (
                        <Button variant="quiet" size="sm">
                          <CircleCheckBig
                            aria-hidden
                            className="size-4"
                            strokeWidth={1.75}
                          />
                          Đánh dấu tìm thấy
                        </Button>
                      ) : (
                        <>
                          <Button variant="quiet" size="sm">
                            Đánh giá
                          </Button>
                          <Button variant="quiet" size="sm">
                            Báo mất
                          </Button>
                        </>
                      )}
                      <Button variant="quiet" size="sm">
                        Ngừng dùng
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {COPIES.map((copy) => (
            <div
              key={copy.code}
              className="rounded-card border border-hairline bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium">{copy.code}</span>
                <StatusBadge status={copy.status} size="sm" />
              </div>
              <p className="mt-1.5 text-[14px] text-meta">
                {copy.condition} · {copy.location}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {copy.status === "lost" ? (
                  <Button variant="quiet" size="sm" className="flex-1">
                    <CircleCheckBig
                      aria-hidden
                      className="size-4"
                      strokeWidth={1.75}
                    />
                    Đánh dấu tìm thấy
                  </Button>
                ) : (
                  <>
                    <Button variant="quiet" size="sm" className="flex-1">
                      Đánh giá
                    </Button>
                    <Button variant="quiet" size="sm" className="flex-1">
                      Báo mất
                    </Button>
                  </>
                )}
                <Button variant="quiet" size="sm" className="flex-1">
                  Ngừng dùng
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Lịch sử đánh giá tình trạng</h2>
        <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
          {CONDITION_HISTORY.map((entry) => (
            <li
              key={entry.date + entry.text}
              className="flex flex-wrap items-center gap-2 py-3 text-[15px]"
            >
              <span className="text-meta">{entry.date}</span>
              <span>{entry.text}</span>
              <span className="rounded-control bg-paper px-2 py-0.5 text-[13px] font-medium text-leather">
                {entry.condition}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Lịch sử mượn</h2>

        <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
          <table className="w-full text-left">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">Bản</th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Người mượn
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Mượn ngày
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Trả ngày
                </th>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Tình trạng khi trả
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {LOAN_HISTORY.map((loan, i) => (
                <tr key={loan.code + loan.from + i}>
                  <td className="px-4 py-3 text-[15px] font-medium">{loan.code}</td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    {loan.borrower}
                  </td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">{loan.from}</td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">{loan.to}</td>
                  <td className="px-4 py-3 text-[15px] text-ink/85">
                    {loan.condition}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {LOAN_HISTORY.map((loan, i) => (
            <div
              key={loan.code + loan.from + i}
              className="rounded-card border border-hairline bg-surface p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium">{loan.code}</span>
                <span className="text-[14px] text-meta">{loan.condition}</span>
              </div>
              <p className="mt-1 text-[15px]">{loan.borrower}</p>
              <p className="mt-0.5 text-[14px] text-meta">
                {loan.from} – {loan.to}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-[14px] text-meta">
          Lịch sử mượn không bao giờ bị xoá, kể cả khi bản sách đã ngừng dùng.
        </p>
      </section>
    </ManagerShell>
  );
}
