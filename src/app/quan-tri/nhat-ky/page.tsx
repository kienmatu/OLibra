import {
  AlertTriangle,
  BookDown,
  BookUp,
  ChevronDown,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { BookTitle } from "@/components/ui/book";
import { cn } from "@/lib/utils";

export const metadata = { title: "Nhật ký hoạt động — Quản trị OLibra" };

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-44 flex-1">
      <p className="text-[13px] text-meta">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

type LogEntry = {
  key: string;
  icon: LucideIcon;
  ink: string;
  fill: string;
  sentence: React.ReactNode;
  meta: string;
  time: string;
};

const LOG: LogEntry[] = [
  {
    key: "loan-4821",
    icon: BookUp,
    ink: "text-onloan",
    fill: "bg-onloan/10",
    sentence: (
      <>
        Quản lý Maria Lan đã cho Giuse Minh mượn{" "}
        <BookTitle>Dế Mèn Phiêu Lưu Ký</BookTitle> lúc 14:32 ngày 03/08
      </>
    ),
    meta: "Tủ sách Đồng Tháp · Loan #4821",
    time: "14:32 · 03/08",
  },
  {
    key: "loan-4788",
    icon: BookDown,
    ink: "text-available",
    fill: "bg-available/10",
    sentence: (
      <>
        Quản lý Maria Lan đã nhận trả <BookTitle>Hoàng Tử Bé</BookTitle> từ Têrêsa
        Lê Ngọc Ánh, tình trạng Nguyên vẹn, lúc 14:05 ngày 03/08
      </>
    ),
    meta: "Tủ sách Đồng Tháp · Loan #4788",
    time: "14:05 · 03/08",
  },
  {
    key: "membership-312",
    icon: UserCheck,
    ink: "text-held",
    fill: "bg-held/10",
    sentence: (
      <>
        Quản lý Maria Lan đã duyệt tài khoản của Anna Phạm Thu Hà lúc 11:20 ngày
        03/08
      </>
    ),
    meta: "Tủ sách Đồng Tháp · Membership #312",
    time: "11:20 · 03/08",
  },
  {
    key: "loan-4402",
    icon: AlertTriangle,
    ink: "text-overdue",
    fill: "bg-overdue/10",
    sentence: (
      <>
        Hệ thống ghi nhận <BookTitle>Đất Rừng Phương Nam</BookTitle> quá hạn 21 ngày
        lúc 00:05 ngày 03/08
      </>
    ),
    meta: "Tủ sách Đồng Tháp · Loan #4402",
    time: "00:05 · 03/08",
  },
];

const DIFF = [
  { field: "status", before: "active", after: "returned" },
  { field: "returned_at", before: "null", after: "2026-08-03 14:05" },
  { field: "return_condition", before: "null", after: "perfect" },
];

function DiffColumn({
  heading,
  value,
}: {
  heading: string;
  value: "before" | "after";
}) {
  return (
    <div>
      <p className="text-[13px] font-medium text-meta">{heading}</p>
      <dl className="mt-2 divide-y divide-hairline">
        {DIFF.map((row) => (
          <div
            key={row.field}
            className="flex items-baseline justify-between gap-3 py-1.5"
          >
            <dt className="font-mono text-[13px] text-meta">{row.field}</dt>
            <dd className="font-mono text-[13px] text-ink/70">{row[value]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function AdminAuditLogPage() {
  return (
    <AdminShell active="nhat-ky" viewer={null} unreadFeedback={null}>
      <PageHeading
        title="Nhật ký hoạt động"
        subtitle="1.248 bản ghi · Nhật ký không bao giờ bị sửa hoặc xoá."
      />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterField label="Tủ sách">
          <Select aria-label="Tủ sách" className="h-12" defaultValue="dong-thap">
            <option value="dong-thap">Tủ sách Đồng Tháp</option>
            <option value="can-tho">Tủ sách Cần Thơ</option>
            <option value="ben-tre">Tủ sách Bến Tre</option>
            <option value="vinh-long">Tủ sách Vĩnh Long</option>
          </Select>
        </FilterField>
        <FilterField label="Người thực hiện">
          <Select
            aria-label="Người thực hiện"
            className="h-12"
            defaultValue="tat-ca"
          >
            <option value="tat-ca">Tất cả</option>
            <option value="lan">Maria Nguyễn Thị Lan</option>
          </Select>
        </FilterField>
        <FilterField label="Hành động">
          <Select aria-label="Hành động" className="h-12" defaultValue="tat-ca">
            <option value="tat-ca">Tất cả</option>
            <option value="cho-muon">Cho mượn</option>
            <option value="nhan-tra">Nhận trả</option>
          </Select>
        </FilterField>
        <FilterField label="Khoảng thời gian">
          <Input
            className="h-12"
            defaultValue="01/08 đến 06/08"
            aria-label="Khoảng thời gian"
          />
        </FilterField>
        <Button variant="outline" size="sm" className="h-11">
          Xoá bộ lọc
        </Button>
      </div>

      <div className="mt-8 divide-y divide-hairline border-y border-hairline">
        {LOG.map((entry, i) => {
          const expanded = i === 1;
          return (
            <div key={entry.key} className="py-4">
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    entry.fill,
                  )}
                >
                  <entry.icon
                    aria-hidden
                    className={cn("size-5", entry.ink)}
                    strokeWidth={1.75}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px]">{entry.sentence}</p>
                  <p className="mt-1 text-[13px] text-meta">{entry.meta}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[14px] text-meta">{entry.time}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-5 text-meta transition-transform",
                      expanded && "rotate-180",
                    )}
                    strokeWidth={1.75}
                  />
                </div>
              </div>

              {expanded ? (
                <div className="mt-4 ml-14 rounded-card bg-paper p-4">
                  <p className="text-[13px] text-meta">
                    Giá trị gốc, chỉ dùng khi cần tra cứu.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <DiffColumn heading="Trước" value="before" />
                    <DiffColumn heading="Sau" value="after" />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <nav className="mt-8 flex items-center justify-between gap-4">
        <p className="text-[15px] text-meta">Trang 1 / 63</p>
        <div className="flex gap-2">
          <Button size="sm" disabled>
            Trước
          </Button>
          <Button size="sm">Sau</Button>
        </div>
      </nav>
    </AdminShell>
  );
}
