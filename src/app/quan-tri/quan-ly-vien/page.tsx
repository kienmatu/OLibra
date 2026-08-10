import Link from "next/link";
import { KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { PhoneLink } from "@/components/ui/phone-link";
import { Pill, type PillTone } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import {
  getAdminOverview,
  getManagersList,
} from "@/domain/admin/queries/get-admin-overview";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { formatInstant } from "@/lib/dates";
import { loadAdminPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { promoteSuperAdminAction, revokeManagerAction } from "../admin-actions";

/**
 * OPS §3.4's `GetManagersList` — everyone who can do anything, anywhere.
 *
 * **Super administrators are in the list.** They hold the most power in the
 * installation, and a list of "who can act here" that omitted them would be the
 * one place that matters most. They carry no `membershipId`, which is also what
 * makes them unrevocable from this screen — correct, since OPS §4.5 lists no
 * demotion command at all. Removing the last administrator's grant would lock
 * the installation out of its own administration surface, and nothing in the
 * requirements says what should happen instead.
 *
 * **"Last active" is the last thing somebody *did*, from the audit log.** A
 * session would say they signed in, which a phone left logged in also says. The
 * figure is a link into the cross-shelf log filtered to that person, which is
 * the way an administrator answers "stale — or busy elsewhere?".
 *
 * **There is no "add a manager" form here, and that is deliberate rather than
 * missing.** `AssignManager` takes a `userId`, and this screen has no way to
 * find one: OPS §4.5 words the input as "`userId` (or the identifying fields to
 * find/create one)", which is a person-search this slice does not build. The
 * shelf's own manager already registers people; promoting one of them is done
 * from the row below, where the person is already named.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Quản lý viên — Quản trị OLibra" };

const ROLE: Record<string, { label: string; tone: PillTone }> = {
  super_admin: { label: "Quản trị viên", tone: "held" },
  admin: { label: "Quản trị tủ sách", tone: "onloan" },
  manager: { label: "Quản lý", tone: "available" },
};

export default async function AdminManagersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const refusal = refusalFrom(await searchParams);

  const { viewer, unreadFeedback, managers, shelves } = await loadAdminPage(
    async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      managers: await getManagersList(tx, ctx),
      // For the shelf id each revoke has to be scoped to — `auditScopeFor`'s
      // sibling rule, and the reason `submitAdminCommand` takes one.
      shelves: await getAdminOverview(tx, ctx),
    }),
  );

  const shelfIdBySlug = new Map(shelves.map((s) => [s.slug, s.bookshelfId]));

  return (
    <AdminShell
      active="quan-ly-vien"
      viewer={viewer}
      unreadFeedback={unreadFeedback}
    >
      <PageHeading
        title="Quản lý viên"
        subtitle="Những người có quyền trên hệ thống và trên từng tủ sách."
      />

      {refusal ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
          {messageFor(refusal)}
        </p>
      ) : null}

      <ul className="mt-8 divide-y divide-hairline rounded-card border border-hairline">
        {managers.map((m) => {
          const role = ROLE[m.role] ?? { label: m.role, tone: "retired" as const };
          return (
            <li key={`${m.userId}:${m.membershipId ?? "global"}`} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold">{m.fullName}</p>
                  <p className="mt-0.5 text-[14px] text-meta">
                    {m.shelfName ?? "Toàn hệ thống"}
                    {m.phone ? " · " : ""}
                    {m.phone ? <PhoneLink phone={m.phone} size="sm" /> : null}
                  </p>
                  <p className="mt-1 text-[14px] text-meta">
                    {m.lastActiveAt ? (
                      <Link
                        href={`/quan-tri/nhat-ky?nguoi=${m.userId}`}
                        className="underline"
                      >
                        Hoạt động gần nhất {formatInstant(m.lastActiveAt)}
                      </Link>
                    ) : (
                      "Chưa làm việc gì trên hệ thống"
                    )}
                  </p>
                </div>
                <Pill
                  icon={m.role === "super_admin" ? ShieldCheck : UserCog}
                  label={role.label}
                  tone={role.tone}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {m.membershipId && m.shelfSlug ? (
                  <details>
                    <summary className="cursor-pointer list-none text-[14px] text-brick underline [&::-webkit-details-marker]:hidden">
                      Thu hồi quyền quản lý
                    </summary>
                    <form action={revokeManagerAction} className="mt-2 space-y-2">
                      <input
                        type="hidden"
                        name="thanh-vien"
                        value={m.membershipId}
                      />
                      <input
                        type="hidden"
                        name="tu-sach"
                        value={shelfIdBySlug.get(m.shelfSlug) ?? ""}
                      />
                      {/* §16.4's own wording for the confirmation step. */}
                      <p className="max-w-md text-[14px] text-meta">
                        Người này sẽ trở lại làm bạn đọc của tủ sách. Toàn bộ lịch
                        sử được giữ lại.
                      </p>
                      <SubmitButton variant="danger" size="sm">
                        Xác nhận thu hồi
                      </SubmitButton>
                    </form>
                  </details>
                ) : null}

                {m.role === "super_admin" ? null : (
                  <details>
                    <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
                      Giao quyền quản trị hệ thống
                    </summary>
                    <form
                      action={promoteSuperAdminAction}
                      className="mt-2 space-y-2"
                    >
                      <input type="hidden" name="nguoi-dung" value={m.userId} />
                      {/* The one grant with no way back: OPS §4.5 lists no
                          demotion command, so this says so before it happens
                          rather than after. */}
                      <p className="max-w-md text-[14px] text-meta">
                        Người này sẽ thấy và sửa được mọi tủ sách. Hiện chưa có cách
                        thu hồi quyền này.
                      </p>
                      <SubmitButton variant="quiet" size="sm">
                        <KeyRound
                          aria-hidden
                          className="size-4"
                          strokeWidth={1.75}
                        />
                        Xác nhận giao quyền
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {managers.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">
          Chưa có quản lý viên nào. Quản lý của mỗi tủ sách được giao quyền từ trang
          tủ sách đó.
        </p>
      ) : null}
    </AdminShell>
  );
}
