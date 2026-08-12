import Link from "next/link";
import { AdminShell } from "@/components/shell/manager-shell";
import { ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Chip } from "@/components/ui/segmented";
import {
  AUDIT_GROUPS,
  auditGroupFromParam,
  auditGroupOf,
  auditSentence,
} from "@/domain/kernel/audit-actions";
import { getAuditLog } from "@/domain/shelf/queries/get-audit-log";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { countPendingManagerChanges } from "@/domain/admin/queries/get-pending-manager-changes";
import { AUDIT_GROUP_STYLE, payloadRows } from "@/lib/audit-log";
import { formatInstantParts } from "@/lib/dates";
import { loadAdminPage } from "@/lib/page-data";
import { pageNumber, param, type SearchParams } from "@/lib/search-params";
import { cn } from "@/lib/utils";

/**
 * OPS §3.4's **cross-shelf** `GetAuditLog`.
 *
 * **It is `getAuditLog` — the shelf's own query — run through
 * `runAdminQuery`.** That is not a shortcut. The query names no shelf: it is
 * scoped entirely by RLS, which is the property `manager-dashboard.test.ts`
 * pins by running its counts under `olibra_admin` and watching them grow. So
 * the same function, under the role that bypasses RLS, *is* the cross-shelf
 * view — every parish's entries plus the null-`bookshelf_id` ones that no
 * shelf-scoped caller can reach at all.
 *
 * A second query would have been a second definition of what an audit entry is,
 * with its own joins for the actor and the subject, and the two would come to
 * disagree about a sentence the day one of them grew a case. `requireManager`
 * inside it admits a `super_admin` on rank — the same admission every other
 * manager query makes.
 *
 * **Which shelf an entry belongs to is not shown, and that is a gap worth
 * naming rather than leaving to be noticed.** `AuditEntryRow` carries no
 * `bookshelf_id`, so an administrator reading "đã cho mượn Dế Mèn" cannot tell
 * which parish from this page. Adding it means widening the shelf's own row type
 * for a field that page would never render. Filtering by actor is the way
 * through today — a manager belongs to one shelf — and the managers list links
 * here with the actor already set.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Nhật ký hệ thống — Quản trị OLibra" };

const GROUP = "nhom";
const PAGE = "trang";
const ACTOR = "nguoi";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const groupParam = param(search, GROUP);
  const group = auditGroupFromParam(groupParam);
  const actorParam = param(search, ACTOR);
  // Shape-checked here so a non-uuid cannot reach a `::uuid` cast and raise a
  // raw 22P02 from inside the transaction. RLS is not what bounds this value on
  // this surface, so the check is about the fault rather than about scope.
  const actor = actorParam && UUID.test(actorParam) ? actorParam : undefined;

  const { viewer, unreadFeedback, pendingManagerChanges, entries } =
    await loadAdminPage(async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      pendingManagerChanges: await countPendingManagerChanges(tx, ctx),
      entries: await getAuditLog(tx, ctx, {
        actorId: actor,
        group,
        page: pageNumber(param(search, PAGE)),
      }),
    }));

  const listHref = "/quan-tri/nhat-ky";
  const hrefWith = (over: { group?: string | null; page?: number }): string => {
    const query = new URLSearchParams();
    if (actor) query.set(ACTOR, actor);
    const nextGroup =
      over.group === undefined ? (group ? groupParam : undefined) : over.group;
    if (nextGroup) query.set(GROUP, nextGroup);
    const trang = over.page ?? 1;
    if (trang > 1) query.set(PAGE, String(trang));
    const string = query.toString();
    return string ? `${listHref}?${string}` : listHref;
  };

  return (
    <AdminShell
      active="nhat-ky"
      viewer={viewer}
      counts={{ unreadFeedback, pendingManagerChanges }}
    >
      <PageHeading
        title="Nhật ký hệ thống"
        subtitle="Mọi việc đã làm, trên tất cả các tủ sách. Trang này đọc từ nhật ký."
      />

      {actor ? (
        <p className="mt-4 text-[15px] text-meta">
          Đang lọc theo một người.{" "}
          <Link href={listHref} className="underline">
            Bỏ lọc
          </Link>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2.5">
        <Chip href={hrefWith({ group: null })} active={!group}>
          Tất cả
        </Chip>
        {Object.entries(AUDIT_GROUPS).map(([key, label]) => (
          <Chip key={key} href={hrefWith({ group: key })} active={group === key}>
            {label}
          </Chip>
        ))}
      </div>

      {entries.rows.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">Chưa có việc nào được ghi lại.</p>
      ) : (
        <div className="mt-6 divide-y divide-hairline border-y border-hairline">
          {entries.rows.map((entry) => {
            const when = formatInstantParts(entry.occurredAt);
            // `auditGroupOf` answers `null` for a stored action this build has
            // no sentence for — the same real state `auditSentence` handles —
            // and such an entry gets the neutral mark rather than a family it
            // was guessed into.
            const style =
              AUDIT_GROUP_STYLE[auditGroupOf(entry.action) ?? "cai-dat"];
            const diff = payloadRows(entry.facts.before, entry.facts.after);
            return (
              <div key={entry.id} className="py-4">
                <div className="flex items-start gap-4">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      style.fill,
                    )}
                  >
                    <style.icon
                      aria-hidden
                      className={cn("size-5", style.ink)}
                      strokeWidth={1.75}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px]">
                      {auditSentence(entry.action, entry.facts, when)}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer list-none text-[13px] text-meta underline underline-offset-2">
                        Xem dữ liệu gốc
                      </summary>
                      <div className="mt-2 rounded-card border border-hairline bg-paper p-3">
                        <p className="font-mono text-[13px] text-meta">
                          {entry.action} · {entry.entityType}
                          {entry.entityId ? ` · ${entry.entityId}` : ""}
                        </p>
                        {diff.length === 0 ? (
                          <p className="mt-2 text-[13px] text-meta">
                            Việc này không ghi lại giá trị nào.
                          </p>
                        ) : (
                          <dl className="mt-2 divide-y divide-hairline">
                            {diff.map((row) => (
                              <div
                                key={row.field}
                                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 py-1.5"
                              >
                                <dt className="truncate font-mono text-[13px] text-meta">
                                  {row.field}
                                </dt>
                                <dd className="truncate font-mono text-[13px] text-ink/70">
                                  {row.before}
                                </dd>
                                <dd className="truncate font-mono text-[13px] text-ink/70">
                                  {row.after}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {entries.pageCount > 1 ? (
        <div className="mt-6 flex items-center justify-between gap-4">
          {entries.page > 1 ? (
            <ButtonLink size="sm" href={hrefWith({ page: entries.page - 1 })}>
              Trang trước
            </ButtonLink>
          ) : (
            <span />
          )}
          <p className="text-[14px] text-meta">
            Trang {entries.page} / {entries.pageCount}
          </p>
          {entries.page < entries.pageCount ? (
            <ButtonLink size="sm" href={hrefWith({ page: entries.page + 1 })}>
              Trang sau
            </ButtonLink>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </AdminShell>
  );
}
