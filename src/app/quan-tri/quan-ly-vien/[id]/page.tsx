import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookDown,
  BookPlus,
  BookUp,
  ClipboardCheck,
  Key,
  MessageSquareText,
  Shield,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PhoneLink } from "@/components/ui/phone-link";
import { Segmented } from "@/components/ui/segmented";
import { BookTitle } from "@/components/ui/book";
import { cn } from "@/lib/utils";

type Role = "admin" | "shelf-admin" | "manager";

const ROLE: Record<
  Role,
  { label: string; icon: LucideIcon; ink: string; fill: string }
> = {
  admin: {
    label: "Quản trị viên",
    icon: Shield,
    ink: "text-terracotta-ink",
    fill: "bg-terracotta/10",
  },
  "shelf-admin": {
    label: "Quản trị tủ sách",
    icon: Key,
    ink: "text-sage",
    fill: "bg-sage/10",
  },
  manager: {
    label: "Quản lý",
    icon: UserCheck,
    ink: "text-held",
    fill: "bg-held/10",
  },
};

type ActivityRow = { text: React.ReactNode; time: string };
type Section = { title: string; count: number; rows: ActivityRow[] };
type Stat = { icon: LucideIcon; label: string; value: number };

type ManagerRecord = {
  id: string;
  fullName: string;
  initial: string;
  shelfName: string;
  since: string;
  phone: string;
  role: Role;
  stats: Stat[];
  sections: Section[];
};

const MANAGERS: ManagerRecord[] = [
  {
    id: "lan",
    fullName: "Maria Nguyễn Thị Lan",
    initial: "L",
    shelfName: "Tủ sách Đồng Tháp",
    since: "14/03/2026",
    phone: "0912 345 678",
    role: "shelf-admin",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 128 },
      { icon: BookDown, label: "Lượt nhận trả", value: 119 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 14 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 119 },
      { icon: BookPlus, label: "Sách đã thêm", value: 9 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 23 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 128,
        rows: [
          {
            text: (
              <>
                Cho Giuse Trần Minh mượn <BookTitle>Dế Mèn Phiêu Lưu Ký</BookTitle>
              </>
            ),
            time: "06/08 14:32",
          },
          {
            text: (
              <>
                Cho Maria Vũ Khánh Linh mượn{" "}
                <BookTitle>Đất Rừng Phương Nam</BookTitle>
              </>
            ),
            time: "05/08 10:15",
          },
          {
            text: (
              <>
                Cho Têrêsa Lê Ngọc Ánh mượn{" "}
                <BookTitle>Totto-chan Bên Cửa Sổ</BookTitle>
              </>
            ),
            time: "04/08 09:50",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 119,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Hoàng Tử Bé</BookTitle> từ Têrêsa Lê Ngọc Ánh ·
                Nguyên vẹn
              </>
            ),
            time: "06/08 14:05",
          },
          {
            text: (
              <>
                Nhận trả <BookTitle>Chiếc Lược Ngà</BookTitle> từ Giuse Trần Minh ·
                Hơi cũ
              </>
            ),
            time: "03/08 11:20",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 14,
        rows: [
          {
            text: "Duyệt tài khoản của Anna Phạm Thu Hà",
            time: "03/08 11:20",
          },
          {
            text: "Từ chối đăng ký của một bạn trùng tên · lý do: đã có tài khoản",
            time: "28/07 09:40",
          },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 9,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Đất Rừng Phương Nam</BookTitle> · 2 bản
              </>
            ),
            time: "02/08 09:48",
          },
          {
            text: (
              <>
                Thêm <BookTitle>Kính Vạn Hoa tập 4</BookTitle> · 1 bản
              </>
            ),
            time: "30/07 16:10",
          },
        ],
      },
    ],
  },
  {
    id: "quoc-anh",
    fullName: "Giuse Trần Quốc Anh",
    initial: "A",
    shelfName: "Toàn hệ thống",
    since: "01/01/2026",
    phone: "0909 111 222",
    role: "admin",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 4 },
      { icon: BookDown, label: "Lượt nhận trả", value: 4 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 2 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 4 },
      { icon: BookPlus, label: "Sách đã thêm", value: 0 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 3 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 4,
        rows: [
          {
            text: (
              <>
                Cho Phêrô Nguyễn Văn Bình mượn <BookTitle>Không Gia Đình</BookTitle>
              </>
            ),
            time: "20/07 10:00",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 4,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Góc Sân Và Khoảng Trời</BookTitle> từ Anna Phạm
                Thu Hà · Nguyên vẹn
              </>
            ),
            time: "18/07 09:30",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 2,
        rows: [
          { text: "Duyệt tài khoản của Anna Lê Thị Hường", time: "05/01 08:15" },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 0,
        rows: [
          {
            text: "Chưa tự thêm sách nào — công việc này do quản lý từng tủ sách phụ trách.",
            time: "",
          },
        ],
      },
    ],
  },
  {
    id: "mai",
    fullName: "Anna Trần Thị Mai",
    initial: "M",
    shelfName: "Tủ sách Đồng Tháp",
    since: "02/04/2026",
    phone: "0938 222 444",
    role: "manager",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 41 },
      { icon: BookDown, label: "Lượt nhận trả", value: 38 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 3 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 38 },
      { icon: BookPlus, label: "Sách đã thêm", value: 2 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 6 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 41,
        rows: [
          {
            text: (
              <>
                Cho Têrêsa Lê Ngọc Ánh mượn{" "}
                <BookTitle>Cho Tôi Xin Một Vé Đi Tuổi Thơ</BookTitle>
              </>
            ),
            time: "05/08 09:12",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 38,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Tuổi Thơ Dữ Dội</BookTitle> từ Giuse Trần Minh ·
                Nguyên vẹn
              </>
            ),
            time: "02/08 16:40",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 3,
        rows: [
          { text: "Duyệt tài khoản của Maria Vũ Khánh Linh", time: "20/07 10:05" },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 2,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Góc Sân Và Khoảng Trời</BookTitle> · 1 bản
              </>
            ),
            time: "15/07 14:00",
          },
        ],
      },
    ],
  },
  {
    id: "minh-khoi",
    fullName: "Giuse Trần Minh Khôi",
    initial: "K",
    shelfName: "Tủ sách Cần Thơ",
    since: "10/02/2026",
    phone: "0908 222 111",
    role: "shelf-admin",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 96 },
      { icon: BookDown, label: "Lượt nhận trả", value: 90 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 11 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 90 },
      { icon: BookPlus, label: "Sách đã thêm", value: 14 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 17 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 96,
        rows: [
          {
            text: (
              <>
                Cho Nguyễn Thị Bích Ngọc mượn{" "}
                <BookTitle>Những Tấm Lòng Cao Cả</BookTitle>
              </>
            ),
            time: "06/08 15:10",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 90,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Kính Vạn Hoa tập 4</BookTitle> từ Phạm Văn Đức ·
                Cũ
              </>
            ),
            time: "04/08 08:45",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 11,
        rows: [
          { text: "Duyệt tài khoản của Trần Thị Kim Chi", time: "30/07 09:00" },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 14,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Chuyện Con Mèo Dạy Hải Âu Bay</BookTitle> · 1 bản
              </>
            ),
            time: "22/07 11:30",
          },
        ],
      },
    ],
  },
  {
    id: "hanh",
    fullName: "Têrêsa Đỗ Thị Hạnh",
    initial: "H",
    shelfName: "Tủ sách Cần Thơ",
    since: "18/03/2026",
    phone: "0947 333 555",
    role: "manager",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 52 },
      { icon: BookDown, label: "Lượt nhận trả", value: 49 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 5 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 49 },
      { icon: BookPlus, label: "Sách đã thêm", value: 3 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 8 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 52,
        rows: [
          {
            text: (
              <>
                Cho Lê Minh Thư mượn <BookTitle>Không Gia Đình</BookTitle>
              </>
            ),
            time: "05/08 10:50",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 49,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Đất Rừng Phương Nam</BookTitle> từ Nguyễn Văn
                Phát · Nguyên vẹn
              </>
            ),
            time: "01/08 09:20",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 5,
        rows: [
          { text: "Duyệt tài khoản của Đặng Thị Thu Hương", time: "25/07 08:30" },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 3,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Tuổi Thơ Dữ Dội</BookTitle> · 1 bản
              </>
            ),
            time: "10/07 15:15",
          },
        ],
      },
    ],
  },
  {
    id: "huong",
    fullName: "Anna Lê Thị Hường",
    initial: "H",
    shelfName: "Tủ sách Bến Tre",
    since: "05/01/2026",
    phone: "0977 456 789",
    role: "shelf-admin",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 70 },
      { icon: BookDown, label: "Lượt nhận trả", value: 66 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 9 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 66 },
      { icon: BookPlus, label: "Sách đã thêm", value: 6 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 12 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 70,
        rows: [
          {
            text: (
              <>
                Cho Bùi Thanh Tâm mượn{" "}
                <BookTitle>Chuyện Con Mèo Dạy Hải Âu Bay</BookTitle>
              </>
            ),
            time: "06/08 08:20",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 66,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Hoàng Tử Bé</BookTitle> từ Ngô Gia Bảo · Hơi cũ
              </>
            ),
            time: "03/08 17:00",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 9,
        rows: [
          { text: "Duyệt tài khoản của Vũ Thị Ngọc Trâm", time: "28/07 10:40" },
        ],
      },
      {
        title: "Sách đã thêm",
        count: 6,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Cho Tôi Xin Một Vé Đi Tuổi Thơ</BookTitle> · 2 bản
              </>
            ),
            time: "12/07 09:05",
          },
        ],
      },
    ],
  },
  {
    id: "son",
    fullName: "Phêrô Nguyễn Văn Sơn",
    initial: "S",
    shelfName: "Tủ sách Vĩnh Long",
    since: "20/01/2026",
    phone: "0933 654 321",
    role: "shelf-admin",
    stats: [
      { icon: BookUp, label: "Lượt cho mượn", value: 33 },
      { icon: BookDown, label: "Lượt nhận trả", value: 31 },
      { icon: UserCheck, label: "Đăng ký đã duyệt", value: 4 },
      { icon: ClipboardCheck, label: "Lần đánh giá tình trạng", value: 31 },
      { icon: BookPlus, label: "Sách đã thêm", value: 2 },
      { icon: MessageSquareText, label: "Bình luận đã duyệt", value: 5 },
    ],
    sections: [
      {
        title: "Cho mượn",
        count: 33,
        rows: [
          {
            text: (
              <>
                Cho Trịnh Hoài An mượn <BookTitle>Chiếc Lược Ngà</BookTitle>
              </>
            ),
            time: "06/07 09:40",
          },
        ],
      },
      {
        title: "Nhận trả",
        count: 31,
        rows: [
          {
            text: (
              <>
                Nhận trả <BookTitle>Kính Vạn Hoa tập 4</BookTitle> từ Đoàn Thị Mỹ
                Linh · Nguyên vẹn
              </>
            ),
            time: "01/07 11:10",
          },
        ],
      },
      {
        title: "Duyệt đăng ký",
        count: 4,
        rows: [{ text: "Duyệt tài khoản của Lâm Quốc Huy", time: "15/06 08:50" }],
      },
      {
        title: "Sách đã thêm",
        count: 2,
        rows: [
          {
            text: (
              <>
                Thêm <BookTitle>Những Tấm Lòng Cao Cả</BookTitle> · 1 bản
              </>
            ),
            time: "02/06 14:20",
          },
        ],
      },
    ],
  },
];

export function generateStaticParams() {
  return MANAGERS.map((m) => ({ id: m.id }));
}

function managerById(id: string) {
  return MANAGERS.find((m) => m.id === id);
}

function QuietStat({ icon: Icon, label, value }: Stat) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-0.5 size-5 text-leather" strokeWidth={1.75} />
      <div>
        <p className="text-[14px] text-meta">{label}</p>
        <p className="text-[28px] leading-none font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ActivitySection({ section }: { section: Section }) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2 border-b border-hairline pb-3">
        <h2 className="text-xl font-semibold">{section.title}</h2>
        <span className="rounded-control bg-paper px-2 py-0.5 text-[13px] font-medium text-leather">
          {section.count}
        </span>
      </div>
      <ul className="divide-y divide-hairline">
        {section.rows.map((row, i) => (
          <li key={i} className="flex items-start justify-between gap-6 py-3.5">
            <p className="text-[16px]">{row.text}</p>
            {row.time ? (
              <span className="shrink-0 text-[14px] text-meta">{row.time}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <Link
        href="#"
        className="mt-4 inline-block text-[15px] font-medium text-sage hover:underline"
      >
        Xem tất cả
      </Link>
    </section>
  );
}

export default async function AdminManagerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manager = managerById(id);
  if (!manager) notFound();

  const { label: roleLabel, icon: RoleIcon, ink, fill } = ROLE[manager.role];

  return (
    <AdminShell active="quan-ly-vien">
      <Link
        href="/quan-tri/quan-ly-vien"
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách quản lý viên
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-paper text-[22px] font-semibold text-leather"
          >
            {manager.initial}
          </span>
          <div>
            <h1 className="text-[28px] leading-tight font-semibold">
              {manager.fullName}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-meta">
              <span>
                {manager.shelfName} · nhận quyền từ {manager.since}
              </span>
              <PhoneLink phone={manager.phone} size="sm" />
            </p>
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[14px] font-medium",
                ink,
                fill,
              )}
            >
              <RoleIcon aria-hidden className="size-[18px]" strokeWidth={1.75} />
              {roleLabel}
            </span>
          </div>
        </div>

        <Segmented
          options={[
            { href: "#tuan", label: "Tuần" },
            { href: "#thang", label: "Tháng", active: true },
            { href: "#nam", label: "Năm" },
            { href: "#tu-dau", label: "Từ đầu" },
          ]}
        />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-8 border-y border-hairline py-8 sm:grid-cols-3">
        {manager.stats.map((stat) => (
          <QuietStat key={stat.label} {...stat} />
        ))}
      </div>

      {manager.sections.map((section) => (
        <ActivitySection key={section.title} section={section} />
      ))}

      <p className="mt-10 border-t border-hairline pt-6 text-[14px] text-meta">
        Trang này đọc từ nhật ký. Không có bản ghi nào bị sửa hay xoá.
      </p>
    </AdminShell>
  );
}
