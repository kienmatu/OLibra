import { AlertTriangle, Clock, Hand, Lock, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";

export const metadata = { title: "Các trang lỗi khác — OLibra" };

type Panel = {
  key: string;
  caption: string;
  icon: LucideIcon;
  ink: string;
  heading: string;
  body: string;
  action: string;
};

const PANELS: Panel[] = [
  {
    key: "403",
    caption: "403 — không có quyền",
    icon: Lock,
    ink: "text-leather",
    heading: "Trang này chỉ dành cho quản lý",
    body: "Tài khoản của em không mở được trang này. Nếu em nghĩ đây là nhầm lẫn, nhắn cho quản lý tủ sách giúp nhé.",
    action: "Về trang của em",
  },
  {
    key: "het-phien",
    caption: "Phiên đăng nhập hết hạn",
    icon: Clock,
    ink: "text-leather",
    heading: "Em cần đăng nhập lại",
    body: "Em đã không dùng trang trong một lúc lâu nên tủ sách tự đăng xuất cho an toàn.",
    action: "Đăng nhập lại",
  },
  {
    key: "429",
    caption: "Quá nhiều yêu cầu",
    icon: Hand,
    ink: "text-brick",
    heading: "Chậm lại một chút nhé",
    body: "Em vừa gửi hơi nhiều yêu cầu trong thời gian ngắn. Em chờ khoảng một phút rồi thử lại.",
    action: "Thử lại",
  },
  {
    key: "500",
    caption: "500 — lỗi máy chủ",
    icon: AlertTriangle,
    ink: "text-brick",
    heading: "Tủ sách đang gặp trục trặc",
    body: "Lỗi từ phía tủ sách, không phải do em. Ban quản trị đã được báo và đang xem.",
    action: "Thử lại",
  },
];

export default function ErrorStatesSheetPage() {
  return (
    <>
      <FrontDoorHeader />

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* This is a reference sheet of error states, so the caption below is
            the visible label. The heading exists for structure and screen
            readers. */}
        <h1 className="sr-only">Các trang lỗi</h1>
        <p className="text-[14px] text-meta">Các trang lỗi khác</p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PANELS.map((panel) => (
            <div key={panel.key} className="flex flex-col">
              <p className="text-[13px] text-meta">{panel.caption}</p>
              <div className="mt-3 flex flex-1 flex-col items-start rounded-card border border-hairline bg-surface p-6">
                <panel.icon
                  aria-hidden
                  className={`size-8 ${panel.ink}`}
                  strokeWidth={1.5}
                />
                <h2 className="mt-4 text-[20px] font-semibold">{panel.heading}</h2>
                <p className="mt-2 flex-1 text-[15px] text-meta">{panel.body}</p>
                <ButtonLink
                  href="#"
                  variant="outline"
                  size="sm"
                  className="mt-5 h-11"
                >
                  {panel.action}
                </ButtonLink>
              </div>
            </div>
          ))}
        </div>
      </main>

      <FrontDoorFooter />
    </>
  );
}
