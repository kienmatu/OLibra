import Link from "next/link";
import { KeyRound, ShieldCheck, UserCog, UserPlus } from "lucide-react";
import { AdminShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { Pill, type PillTone } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { messageFor } from "@/domain/kernel/errors";
import {
  getAdminOverview,
  getManagerCandidates,
  getManagersList,
} from "@/domain/admin/queries/get-admin-overview";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { formatInstant } from "@/lib/dates";
import { loadAdminPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import {
  assignManagerAction,
  promoteSuperAdminAction,
  revokeManagerAction,
} from "../admin-actions";

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
 * **The appoint form at the top is Task 5 of the 2026-08-10 QA remediation.**
 * `assignManagerAction` (`../admin-actions.ts`) shipped fully wired and fully
 * tested and this screen never rendered it, so a fresh install — whose manager
 * list holds only the super_admin the seed creates — had no way to delegate a
 * single parish; the administrator was left running every shelf personally.
 * The paragraph this replaced argued the gap was deliberate because
 * `AssignManager` takes a `userId` and "this screen has no way to find one".
 * That argument does not survive contact with `assignManager`'s own guard: it
 * accepts *any* `userId` naming an undeleted `users` row, so the missing piece
 * was never a search — it was a list. `getManagerCandidates`
 * (`../../../domain/admin/queries/get-admin-overview.ts`) is that list, one
 * shelf at a time.
 *
 * **Why a shelf has to be chosen before a person can be**, and why that is a
 * second `<select>` fed by a page reload rather than one combined picker: BR
 * §13.3 and OPS's own "no client JavaScript anywhere" hold on every screen in
 * this application, and a `<select>` cannot filter another `<select>`'s
 * options without a script watching it change. The reload is the same
 * mechanism `tu-sach/page.tsx` already uses to bring one shelf's settings into
 * view from `?tu-sach=` — a `GET` form re-requesting this same page — and using
 * it here rather than inventing a second one is what the controller notes for
 * this task asked for by name.
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
  const search = await searchParams;
  const refusal = refusalFrom(search);
  // The appoint form's own GET companion — see this page's docstring above
  // for why a reload, not a script, is what narrows the second `<select>`.
  const chosenShelfId = param(search, "tu-sach") ?? null;

  const { viewer, unreadFeedback, managers, shelves, candidates, chosenShelf } =
    await loadAdminPage(async (tx, ctx, v) => {
      const shelves = await getAdminOverview(tx, ctx);
      // Read only when the id names a shelf this administrator just listed —
      // the same guard `tu-sach/page.tsx` applies to its own `?tu-sach=`, so a
      // stale or hand-edited value renders the picker rather than a 404 or an
      // empty form.
      const chosenShelf =
        shelves.find((s) => s.bookshelfId === chosenShelfId) ?? null;
      return {
        viewer: v,
        unreadFeedback: await countUnreadFeedback(tx, ctx),
        managers: await getManagersList(tx, ctx),
        // For the shelf id each revoke has to be scoped to — `auditScopeFor`'s
        // sibling rule, and the reason `submitAdminCommand` takes one.
        shelves,
        chosenShelf,
        candidates: chosenShelf
          ? await getManagerCandidates(tx, ctx, chosenShelf.bookshelfId)
          : null,
      };
    });

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

      {/* Task 5 (QA remediation) — the appoint form. Above the list, per the
          brief: this is the one action a fresh install actually needs first,
          since a manager list holding only the super_admin has nothing below
          worth scrolling to yet. */}
      <section className="mt-8 max-w-2xl space-y-6 rounded-card border border-hairline bg-surface p-5">
        <h2 className="text-[18px] font-semibold">Giao quyền quản lý</h2>

        {shelves.length === 0 ? (
          <p className="text-[15px] text-meta">Chưa có tủ sách nào.</p>
        ) : (
          <>
            {/* The GET companion this page's docstring explains: choosing a
                shelf here is a full reload, carrying `?tu-sach=` back to this
                same route, which is what lets the reader `<select>` below be
                server-rendered rather than filtered by a script. */}
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Field label="Tủ sách" htmlFor="chon-tu-sach">
                  <Select
                    id="chon-tu-sach"
                    name="tu-sach"
                    defaultValue={chosenShelf?.bookshelfId ?? ""}
                  >
                    <option value="" disabled>
                      Chọn tủ sách
                    </option>
                    {shelves.map((s) => (
                      <option key={s.bookshelfId} value={s.bookshelfId}>
                        {s.name}
                        {s.status === "active" ? "" : " (đã lưu trữ)"}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton variant="quiet" size="md">
                Xem bạn đọc
              </SubmitButton>
            </form>

            {chosenShelf === null ? null : candidates && candidates.length > 0 ? (
              <form
                action={assignManagerAction}
                className="space-y-4 border-t border-hairline pt-6"
              >
                <input
                  type="hidden"
                  name="tu-sach"
                  value={chosenShelf.bookshelfId}
                />
                <Field label="Bạn đọc" htmlFor="chon-nguoi-dung">
                  <Select
                    id="chon-nguoi-dung"
                    name="nguoi-dung"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Chọn bạn đọc
                    </option>
                    {candidates.map((c) => (
                      <option key={c.userId} value={c.userId}>
                        {c.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton variant="primary" size="md">
                  <UserPlus aria-hidden className="size-4" strokeWidth={1.75} />
                  Giao quyền quản lý
                </SubmitButton>
              </form>
            ) : (
              <p className="border-t border-hairline pt-6 text-[15px] text-meta">
                Tủ sách này chưa có bạn đọc nào để giao quyền.
              </p>
            )}
          </>
        )}
      </section>

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
