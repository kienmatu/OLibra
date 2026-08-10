import { Mail } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/segmented";
import { PhoneLink } from "@/components/ui/phone-link";
import { cn } from "@/lib/utils";

export const metadata = { title: "Góp ý — Quản trị OLibra" };

type Message = {
  key: string;
  sender: string;
  subject: string;
  shelf: string;
  time: string;
  unread: boolean;
  selected?: boolean;
};

const MESSAGES: Message[] = [
  {
    key: "trang",
    sender: "Chị Nguyễn Thu Trang",
    subject: "Xin mở tủ sách ở giáo xứ Long Xuyên",
    shelf: "Toàn hệ thống",
    time: "2 giờ trước",
    unread: true,
    selected: true,
  },
  {
    key: "minh",
    sender: "Giuse Trần Minh",
    subject: "Sách bị thiếu trang",
    shelf: "Đồng Tháp",
    time: "hôm qua",
    unread: true,
  },
  {
    key: "khach",
    sender: "Khách (không đăng nhập)",
    subject: "Hỏi giờ mở cửa",
    shelf: "Cần Thơ",
    time: "2 ngày trước",
    unread: true,
  },
  {
    key: "linh",
    sender: "Maria Vũ Khánh Linh",
    subject: "Cảm ơn tủ sách",
    shelf: "Đồng Tháp",
    time: "4 ngày trước",
    unread: false,
  },
  {
    key: "hoa",
    sender: "Anh Lê Văn Hoà",
    subject: "Muốn tặng sách cũ",
    shelf: "Bến Tre",
    time: "6 ngày trước",
    unread: false,
  },
];

const selected = MESSAGES.find((m) => m.selected) ?? MESSAGES[0];

export default function AdminFeedbackPage() {
  return (
    <AdminShell active="gop-y">
      <div className="flex min-h-[calc(100vh-6.5rem)] flex-col border border-hairline md:flex-row">
        <aside className="flex flex-col border-hairline md:w-[340px] md:shrink-0 md:border-r">
          <div className="border-b border-hairline p-5">
            <h1 className="text-[20px] font-semibold">Góp ý</h1>
            <p className="mt-0.5 text-[14px] text-meta">3 tin mới</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Chip href="#moi" active>
                Mới (3)
              </Chip>
              <Chip href="#da-doc">Đã đọc (12)</Chip>
              <Chip href="#da-xu-ly">Đã xử lý (46)</Chip>
            </div>
          </div>

          <ul className="flex-1 divide-y divide-hairline overflow-y-auto">
            {MESSAGES.map((m) => (
              <li key={m.key} className="relative">
                {m.selected ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-terracotta"
                  />
                ) : null}
                <a
                  href={`#${m.key}`}
                  className={cn(
                    "block px-5 py-3.5",
                    m.unread ? "bg-paper" : "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {m.unread ? (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full bg-terracotta"
                      />
                    ) : null}
                    <p className="truncate text-[15px] font-medium">{m.sender}</p>
                  </div>
                  <p className="mt-0.5 truncate text-[15px]">{m.subject}</p>
                  <p className="mt-0.5 text-[13px] text-meta">
                    {m.shelf} · {m.time}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex-1 p-6 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="max-w-2xl text-[24px] leading-tight font-semibold">
              {selected.subject}
            </h2>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
              <Mail aria-hidden className="size-[16px]" strokeWidth={1.75} />
              Tin mới
            </span>
          </div>

          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-meta">
            <span>{selected.sender}</span>
            <span aria-hidden>·</span>
            <PhoneLink phone="0945 123 678" size="sm" />
            <span aria-hidden>·</span>
            <span>gửi lúc 07:30 hôm nay</span>
            <span aria-hidden>·</span>
            <span>{selected.shelf}</span>
          </p>

          <p className="mt-8 max-w-2xl text-[16px] leading-[1.9]">
            Chào ban quản trị. Em là giáo lý viên ở giáo xứ Long Xuyên. Em thấy tủ
            sách Đồng Tháp hoạt động rất tốt nên muốn hỏi cách mở một tủ sách tương
            tự cho các em thiếu nhi bên em. Bên em có sẵn khoảng 60 cuốn và một
            phòng nhỏ ở nhà xứ. Mong ban quản trị hướng dẫn giúp em. Em cảm ơn.
          </p>

          <p className="mt-8 text-[14px] text-meta">
            Hệ thống không gửi email. Trả lời bằng cách gọi vào số điện thoại ở
            trên.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
            <Button variant="primary" size="lg">
              Đánh dấu đã xử lý
            </Button>
            <Button variant="quiet" size="md">
              Đánh dấu đã đọc
            </Button>
            {/* *Lưu trữ* removed by the product owner (2026-08-09).
                `feedback_status` has exactly three values and the table has no
                `deleted_at`, so the button needed a migration either way — and
                a fourth *status* ("the administrator finished with it") and a
                *soft delete* ("stop showing it at all") are different products
                that nothing in the requirements chose between. `Đã xử lý` is
                the end of the line, and a resolved message drops out of the
                default list. OPS §4.4 listed the command provisionally and can
                now drop it. */}
          </div>
        </main>
      </div>
    </AdminShell>
  );
}
