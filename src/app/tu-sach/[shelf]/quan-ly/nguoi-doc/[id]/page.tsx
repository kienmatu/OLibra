import { notFound } from "next/navigation";
import {
  Clock,
  HandCoins,
  KeyRound,
  LogOut,
  Lock,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pill } from "@/components/ui/pill";
import { PhoneLink } from "@/components/ui/phone-link";
import { ManagerShell } from "@/components/shell/manager-shell";
import { unitOptions } from "@/domain/members/parish-taxonomy";
import {
  READER_STATUS,
  bookBySlug,
  books,
  loansByReader,
  readers,
  shelfBySlug,
  shelves,
  type Reader,
} from "@/lib/fixtures";

export function generateStaticParams() {
  return shelves.flatMap((s) => readers.map((r) => ({ shelf: s.slug, id: r.id })));
}

const MEMBERSHIP_ICON: Record<Reader["membership"], LucideIcon> = {
  active: UserCheck,
  pending: Clock,
  suspended: Lock,
  left: LogOut,
};

const MAX_HOLDING = 3;

export default async function ManagerReaderDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}) {
  const { shelf: shelfSlug, id } = await params;
  const shelf = shelfBySlug(shelfSlug);
  const reader = readers.find((r) => r.id === id);
  if (!shelf || !reader) notFound();

  const { label, ink, fill } = READER_STATUS[reader.membership];
  const MembershipIcon = MEMBERSHIP_ICON[reader.membership];

  // INV-14: an account has either both a username and a password, or
  // neither — and having neither is a perfectly normal state, not a gap in
  // the data. Shown quietly, without implying anything is wrong.
  const hasCredentials = Boolean(reader.username);

  // Rows for the shelf's own parish levels — only for a level that actually
  // has units, so a shelf with one level (or none yet) doesn't show a row
  // that could never have a value (design §6.1: the field, and its label,
  // come from the shelf's taxonomy, not a fixed "Tổ"/"Giáo họ" pair).
  const parishRows: { label: string; value: React.ReactNode }[] = [];
  if (unitOptions(shelf.parishUnits, 1).length > 0) {
    const unit = shelf.parishUnits.find((u) => u.id === reader.parishUnitL1Id);
    parishRows.push({
      label: shelf.parishTaxonomy.level1Label,
      value: unit?.name ?? "Chưa có",
    });
  }
  if (
    shelf.parishTaxonomy.levels === 2 &&
    unitOptions(shelf.parishUnits, 2).length > 0
  ) {
    const unit = shelf.parishUnits.find((u) => u.id === reader.parishUnitL2Id);
    parishRows.push({
      label: shelf.parishTaxonomy.level2Label,
      value: unit?.name ?? "Chưa có",
    });
  }

  const info: { label: string; value: React.ReactNode; private?: boolean }[] = [
    { label: "Tên thánh", value: reader.saintName },
    { label: "Ngày sinh", value: `${reader.born} (${reader.age} tuổi)` },
    ...parishRows,
    { label: "Tên đăng nhập", value: reader.username },
    { label: "Tên cha", value: reader.father, private: true },
    { label: "Tên mẹ", value: reader.mother, private: true },
    {
      label: "Số điện thoại",
      value: <PhoneLink phone={reader.phone} size="sm" />,
      private: true,
    },
  ];

  /* Derived from the shared loans fixture, not invented here. Slicing the
     catalogue used to hand this reader a copy of a book somebody else was
     holding. */
  const heldBooks = loansByReader(reader.id).flatMap((loan) => {
    const book = bookBySlug(loan.bookSlug);
    return book
      ? [
          {
            book,
            code: loan.code,
            overdue: loan.status === "overdue",
            due: loan.dueOn,
            daysLeft: loan.daysLeft,
          },
        ]
      : [];
  });

  const loanHistory = [
    {
      book: books[0],
      borrower: reader.fullName,
      from: "02/06",
      to: "16/06",
      condition: "Nguyên vẹn",
    },
    {
      book: books[4],
      borrower: reader.fullName,
      from: "10/05",
      to: "24/05",
      condition: "Hơi cũ",
    },
    {
      book: books[8],
      borrower: reader.fullName,
      from: "01/04",
      to: "15/04",
      condition: "Nguyên vẹn",
    },
    {
      book: books[9],
      borrower: reader.fullName,
      from: "12/03",
      to: "26/03",
      condition: "Hơi cũ",
    },
  ];

  return (
    <ManagerShell shelfName={shelf.name} shelfSlug={shelf.slug} active="nguoi-doc">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-paper text-[24px] font-semibold text-leather"
          >
            {reader.name.charAt(0)}
          </span>
          <div>
            <h1 className="text-[28px] leading-tight font-semibold">
              {reader.fullName}
            </h1>
            <p className="mt-1 text-[15px] text-meta">
              Tên thánh {reader.saintName} · sinh {reader.born} ({reader.age} tuổi)
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[14px] font-medium " +
                  fill +
                  " " +
                  ink
                }
              >
                <MembershipIcon
                  aria-hidden
                  className="size-[18px]"
                  strokeWidth={1.75}
                />
                {label}
              </span>
              <Pill
                icon={hasCredentials ? KeyRound : Lock}
                label={
                  hasCredentials
                    ? "Có tài khoản đăng nhập"
                    : "Chưa có tài khoản đăng nhập"
                }
                tone="neutral"
              />
            </div>
          </div>
        </div>
        <Button variant="primary" size="lg">
          <HandCoins aria-hidden className="size-5" strokeWidth={1.75} />
          Cho mượn sách
        </Button>
      </div>

      <section className="mt-10 max-w-2xl">
        <h2 className="text-xl font-semibold">Thông tin</h2>
        <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
          {info.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
            >
              <dt className="flex items-center gap-2 text-[14px] text-meta">
                {row.label}
                {row.private ? (
                  <span className="rounded-control bg-paper px-1.5 py-0.5 text-[12px] font-medium text-leather">
                    Chỉ quản lý thấy
                  </span>
                ) : null}
              </dt>
              <dd className="text-right text-[16px]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">
          Đang mượn ({reader.holding} / tối đa {MAX_HOLDING})
        </h2>
        {reader.holding >= MAX_HOLDING ? (
          <p className="mt-1 text-[14px] text-meta">
            Bạn đọc này đã mượn tối đa, không thể mượn thêm.
          </p>
        ) : null}

        {heldBooks.length === 0 ? (
          <p className="mt-4 text-[15px] text-meta">Hiện không mượn cuốn nào.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {heldBooks.map(({ book, code, overdue, due }) => (
              <li
                key={code}
                className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3"
              >
                <BookCover title={book.title} className="w-12 text-[1rem]" />
                <div className="min-w-0 flex-1">
                  <BookTitle className="block truncate text-[16px] leading-snug">
                    {book.title}
                  </BookTitle>
                  <p className="mt-0.5 text-[13px] text-meta">{code}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusBadge status={overdue ? "overdue" : "onloan"} size="sm" />
                  <span className="text-[13px] text-meta">Hạn {due}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Lịch sử mượn</h2>

        <div className="mt-4 hidden overflow-hidden rounded-card border border-hairline md:block">
          <table className="w-full text-left">
            <thead className="bg-paper">
              <tr>
                <th className="px-4 py-3 text-[14px] font-medium text-meta">
                  Sách
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
              {loanHistory.map((loan, i) => (
                <tr key={loan.book.slug + i}>
                  <td className="px-4 py-3">
                    <BookTitle className="text-[15px]">{loan.book.title}</BookTitle>
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
          {loanHistory.map((loan, i) => (
            <div
              key={loan.book.slug + i}
              className="rounded-card border border-hairline bg-surface p-4"
            >
              <BookTitle className="block text-[15px]">{loan.book.title}</BookTitle>
              <p className="mt-1 text-[14px] text-meta">
                {loan.from} – {loan.to} · {loan.condition}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <Button variant="outline" size="md">
          Đặt / đổi thông tin đăng nhập
        </Button>
        <Button variant="danger" size="md">
          Tạm khoá tài khoản
        </Button>
        <Button variant="outline" size="md">
          Đánh dấu đã rời
        </Button>
        <p className="w-full text-[14px] text-meta">
          Tạm khoá chỉ chặn mượn mới. Sách đang mượn vẫn giữ nguyên.
        </p>
        <p className="w-full text-[14px] text-meta">
          Không có email, nên đây là cách duy nhất để khôi phục mật khẩu. Thao tác
          này cũng dùng để tạo tài khoản đăng nhập cho bạn đọc chưa có. Mỗi lần dùng
          đều được ghi vào nhật ký, quản trị viên hệ thống xem được.
        </p>
      </section>
    </ManagerShell>
  );
}
