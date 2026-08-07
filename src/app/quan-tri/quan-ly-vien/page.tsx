import {
  AlertTriangle,
  Key,
  Search,
  Shield,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Pill, type PillTone } from "@/components/ui/pill";
import { PhoneLink } from "@/components/ui/phone-link";

export const metadata = { title: "Quản lý viên — Quản trị OLibra" };

type Role = "admin" | "shelf-admin" | "manager";

const ROLE: Record<Role, { label: string; icon: LucideIcon; tone: PillTone }> = {
  admin: {
    label: "Quản trị viên",
    icon: Shield,
    tone: "onloan",
  },
  "shelf-admin": {
    label: "Quản trị tủ sách",
    icon: Key,
    tone: "sage",
  },
  manager: {
    label: "Quản lý",
    icon: UserCheck,
    tone: "held",
  },
};

type ManagerRow = {
  id: string;
  fullName: string;
  initial: string;
  shelfName: string;
  phone: string;
  role: Role;
  lastActive: string;
  lastActiveWarn?: boolean;
  revocable: boolean;
};

const MANAGERS: ManagerRow[] = [
  {
    id: "quoc-anh",
    fullName: "Giuse Trần Quốc Anh",
    initial: "A",
    shelfName: "Toàn hệ thống",
    phone: "0909 111 222",
    role: "admin",
    lastActive: "hôm nay 09:12",
    revocable: false,
  },
  {
    id: "lan",
    fullName: "Maria Nguyễn Thị Lan",
    initial: "L",
    shelfName: "Đồng Tháp",
    phone: "0912 345 678",
    role: "shelf-admin",
    lastActive: "hôm nay 08:40",
    revocable: true,
  },
  {
    id: "mai",
    fullName: "Anna Trần Thị Mai",
    initial: "M",
    shelfName: "Đồng Tháp",
    phone: "0938 222 444",
    role: "manager",
    lastActive: "hôm qua 16:05",
    revocable: true,
  },
  {
    id: "minh-khoi",
    fullName: "Giuse Trần Minh Khôi",
    initial: "K",
    shelfName: "Cần Thơ",
    phone: "0908 222 111",
    role: "shelf-admin",
    lastActive: "hôm nay 07:55",
    revocable: true,
  },
  {
    id: "hanh",
    fullName: "Têrêsa Đỗ Thị Hạnh",
    initial: "H",
    shelfName: "Cần Thơ",
    phone: "0947 333 555",
    role: "manager",
    lastActive: "hôm qua 15:20",
    revocable: true,
  },
  {
    id: "huong",
    fullName: "Anna Lê Thị Hường",
    initial: "H",
    shelfName: "Bến Tre",
    phone: "0977 456 789",
    role: "shelf-admin",
    lastActive: "3 ngày trước",
    revocable: true,
  },
  {
    id: "son",
    fullName: "Phêrô Nguyễn Văn Sơn",
    initial: "S",
    shelfName: "Vĩnh Long",
    phone: "0933 654 321",
    role: "shelf-admin",
    lastActive: "32 ngày trước",
    lastActiveWarn: true,
    revocable: true,
  },
];

function Avatar({ initial }: { initial: string }) {
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
    >
      {initial}
    </span>
  );
}

export default function AdminManagersPage() {
  return (
    <AdminShell active="quan-ly-vien">
      <PageHeading
        title="Quản lý viên"
        subtitle="9 người · 4 tủ sách"
        action={
          <ButtonLink href="#" variant="primary" size="lg">
            <UserPlus aria-hidden className="size-5" strokeWidth={1.75} />
            Giao quyền quản lý
          </ButtonLink>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <Input
            icon={Search}
            className="h-12"
            placeholder="Tìm theo tên hoặc số điện thoại"
            aria-label="Tìm quản lý viên"
          />
        </div>
        <Select
          aria-label="Tủ sách"
          defaultValue="tat-ca"
          className="h-12 w-auto min-w-48"
        >
          <option value="tat-ca">Tủ sách: Tất cả</option>
          <option value="dong-thap">Tủ sách: Đồng Tháp</option>
          <option value="can-tho">Tủ sách: Cần Thơ</option>
          <option value="ben-tre">Tủ sách: Bến Tre</option>
          <option value="vinh-long">Tủ sách: Vĩnh Long</option>
        </Select>
      </div>

      <div className="mt-6 overflow-hidden rounded-card border border-hairline">
        <table className="w-full text-left">
          <thead className="bg-paper">
            <tr>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">Người</th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Tủ sách
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Vai trò
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Hoạt động gần nhất
              </th>
              <th className="px-4 py-3 text-[14px] font-medium text-meta">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {MANAGERS.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar initial={m.initial} />
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-medium">
                        {m.fullName}
                      </p>
                      <PhoneLink phone={m.phone} size="sm" />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[15px] text-ink/85">{m.shelfName}</td>
                <td className="px-4 py-3">
                  <Pill
                    icon={ROLE[m.role].icon}
                    label={ROLE[m.role].label}
                    tone={ROLE[m.role].tone}
                  />
                </td>
                <td className="px-4 py-3 text-[15px]">
                  {m.lastActiveWarn ? (
                    <span className="inline-flex items-center gap-1.5 text-brick">
                      <AlertTriangle
                        aria-hidden
                        className="size-[15px]"
                        strokeWidth={1.75}
                      />
                      {m.lastActive}
                    </span>
                  ) : (
                    <span className="text-ink/85">{m.lastActive}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <ButtonLink
                      href={`/quan-tri/quan-ly-vien/${m.id}`}
                      variant="quiet"
                      size="sm"
                    >
                      Xem hoạt động
                    </ButtonLink>
                    {m.revocable ? (
                      <Button variant="danger" size="sm">
                        Thu hồi quyền
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Example of the revoke confirmation flow, shown inline for review. */}
      <div className="mt-6 rounded-card border border-brick bg-paper p-6">
        <h2 className="text-lg font-semibold">
          Thu hồi quyền của Têrêsa Đỗ Thị Hạnh?
        </h2>
        <p className="mt-2 text-[15px]">
          Người này sẽ trở lại làm bạn đọc bình thường của Tủ sách Cần Thơ.
        </p>
        <p className="mt-1.5 text-[15px] text-meta">
          Toàn bộ lịch sử thao tác của họ vẫn được giữ lại trong nhật ký, không có
          gì bị xoá.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button variant="danger" size="md">
            Thu hồi quyền
          </Button>
          <Button variant="ghost" size="md">
            Huỷ
          </Button>
        </div>
      </div>
    </AdminShell>
  );
}
