import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button";
import { PageHeading, SectionHeading } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Chip } from "@/components/ui/segmented";
import { ManagerShell } from "@/components/shell/manager-shell";
import {
  AUDIT_GROUPS,
  type AuditGroup,
  auditGroupFromParam,
  auditGroupOf,
  auditSentence,
} from "@/domain/kernel/audit-actions";
import { getAuditActors, getAuditLog } from "@/domain/shelf/queries/get-audit-log";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { AUDIT_GROUP_STYLE, payloadRows } from "@/lib/audit-log";
import { formatInstantParts } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { isUuid, pageNumber, param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { cn } from "@/lib/utils";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Nhật ký — Quản lý tủ sách OLibra" };

/** SDD §6.6. Even a count of three goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The parameters this page reads, in the Vietnamese-slug shape every other
 * filtered list in this application uses (`?q=`, `?trang-thai=`, `?the-loai=`).
 */
const ACTOR = "nguoi";
const GROUP = "viec";
const FROM = "tu";
const TO = "den";
const PAGE = "trang";

/** `?tu=`/`?den=` as a calendar date, or nothing. */
function dateParam(raw: string | undefined): string | undefined {
  // Shape only, never a *valid* date — `2026-02-31` matches this and Postgres
  // refuses it, which is a `22008` from inside the transaction rather than the
  // page. So the value is also checked against `Date` before it travels; the
  // regex is what stops `'; drop`-shaped nonsense reaching a `::date` cast as
  // a `22P02`, the unstructured exception OPS §2 forbids.
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // `2026-02-31` parses as the 3rd of March, so a round trip is what catches it.
  return parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
}

/**
 * BR §14's audit browser, shelf-scoped — OPS §3.3's `GetAuditLog`.
 *
 * **Every entry is a Vietnamese sentence, and this page writes none of them.**
 * `auditSentence` is the domain's (`domain/kernel/audit-actions.ts`), for the
 * reason `errors.ts:11-16` gives about `ERROR_MESSAGES`: a screen does not write
 * its own wording for a fact it did not define. What this page contributes is
 * the two *numbers* in that sentence, formatted through `Intl` in
 * `src/lib/dates.ts` (SDD §6.6) and handed in as a pair — see
 * `formatInstantParts` for why the split runs exactly there.
 *
 * **Nothing on this page renders an action name.** §3.1: `loan.created` in front
 * of a volunteer is a failure, not a fallback. The raw name is a stored value
 * and appears exactly once, inside the `<details>`, beside `before` and `after`
 * — which is BR §14's own placement for raw values, "for when something is
 * genuinely being investigated".
 *
 * **The `<details>` needs no client JavaScript**, like every other disclosure in
 * this application (`ManagerShell`'s mobile menu, the confirm steps). These are
 * server components and stay that way.
 *
 * **The actor filter is a `<select>` of people who have actually done
 * something**, not of the shelf's managers. BR §14's headline is "what has
 * manager A been doing", and a list of managers would offer somebody who has
 * done nothing (an empty page that looks like a bug) while omitting the readers
 * who write their own entries — `profile_change.proposed` and
 * `user.password_changed` are a reader's.
 *
 * **The export panel is here rather than on `cai-dat`.** OPS §3.3 lists
 * `GetAuditLog` and the three exports on four adjacent rows, and P1 groups them
 * as one slice for the same reason: both surfaces are about looking at what
 * happened. `quan-ly/cai-dat` still renders fixtures, and putting a real control
 * on a fixture page is the failure
 * `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` exists to
 * prevent. When a later slice wires the settings page, moving the panel is three
 * forms.
 */
export default async function ManagerAuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  // Not `{ nguoi?: string }`. `?nguoi=a&nguoi=b` arrives as an array — see
  // `src/lib/search-params.ts` for the four pages that shipped a 500 over it.
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;

  const actorParam = param(search, ACTOR);
  const groupParam = param(search, GROUP);
  const group = auditGroupFromParam(groupParam);
  const from = dateParam(param(search, FROM));
  const to = dateParam(param(search, TO));

  const { shelf, viewer, counts, actors, entries } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const actors = await getAuditActors(tx, ctx);
      return {
        shelf: await readShelf(tx, ctx),
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        actors,
        entries: await getAuditLog(tx, ctx, {
          // Resolved against the people this shelf's log actually names, before
          // it reaches SQL. A well-formed uuid naming somebody else narrows to
          // nothing anyway — RLS scopes the rows, never this value — so this is
          // about the page's own links staying honest, not about permission.
          actorId:
            isUuid(actorParam) && actors.some((a) => a.userId === actorParam)
              ? actorParam
              : undefined,
          group,
          from,
          to,
          page: pageNumber(param(search, PAGE)),
        }),
      };
    },
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  const listHref = `${base}/nhat-ky`;
  const actor = actors.some((a) => a.userId === actorParam)
    ? actorParam
    : undefined;

  /**
   * This page's URL with one filter changed and the rest kept — built from the
   * *resolved* values rather than by copying the incoming query string, so a
   * duplicated or hand-edited parameter cannot ride along into a link the page
   * itself emits. `quan-ly/nguoi-doc` does the same and for the same reason.
   * Changing a filter drops `trang`.
   */
  const hrefWith = (over: { group?: string | null; page?: number }): string => {
    const query = new URLSearchParams();
    if (actor) query.set(ACTOR, actor);
    const nextGroup =
      over.group === undefined ? (group ? groupParam : undefined) : over.group;
    if (nextGroup) query.set(GROUP, nextGroup);
    if (from) query.set(FROM, from);
    if (to) query.set(TO, to);
    const trang = over.page ?? 1;
    if (trang > 1) query.set(PAGE, String(trang));
    const string = query.toString();
    return string ? `${listHref}?${string}` : listHref;
  };

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nhat-ky"
      viewer={viewer}
      counts={counts}
    >
      <PageHeading
        title="Nhật ký"
        subtitle={`${NUMBER.format(entries.total)} việc đã làm · Nhật ký không bao giờ bị sửa hoặc xoá.`}
      />

      {/* A GET form, so a filter is in the URL and survives a refresh, a back
          button and a link pasted to another volunteer. The date fields are
          native `type="date"`, which needs no client JavaScript and gives a
          phone its own picker. */}
      <form action={listHref} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="min-w-48 flex-1">
          <span className="text-[13px] text-meta">Người thực hiện</span>
          <Select name={ACTOR} className="mt-1 h-12" defaultValue={actor ?? ""}>
            <option value="">Tất cả</option>
            {actors.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.name} ({NUMBER.format(a.entries)})
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-40">
          <span className="text-[13px] text-meta">Từ ngày</span>
          <input
            type="date"
            name={FROM}
            defaultValue={from ?? ""}
            className="mt-1 h-12 w-full rounded-control border border-hairline bg-surface px-3 text-[16px]"
          />
        </label>
        <label className="min-w-40">
          <span className="text-[13px] text-meta">Đến ngày</span>
          <input
            type="date"
            name={TO}
            defaultValue={to ?? ""}
            className="mt-1 h-12 w-full rounded-control border border-hairline bg-surface px-3 text-[16px]"
          />
        </label>
        {/* The group chips are links, so this hidden field is what keeps the
            chosen family when the form is submitted. */}
        {group && groupParam ? (
          <input type="hidden" name={GROUP} value={groupParam} />
        ) : null}
        <Button type="submit" variant="outline" size="lg">
          Lọc
        </Button>
        {actor || from || to || group ? (
          <ButtonLink href={listHref} variant="quiet" size="lg">
            Xoá bộ lọc
          </ButtonLink>
        ) : null}
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-meta">Loại việc</span>
        <Chip href={hrefWith({ group: null })} active={!group}>
          Tất cả
        </Chip>
        {(Object.keys(AUDIT_GROUPS) as AuditGroup[]).map((key) => (
          <Chip key={key} href={hrefWith({ group: key })} active={group === key}>
            {AUDIT_GROUPS[key]}
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
            // and such an entry gets the neutral settings mark rather than a
            // family it was guessed into.
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
                    {/* BR §14: "the raw before/after values available on
                        expansion… for when something is genuinely being
                        investigated". The stored values, and the stored action
                        name — the one place it appears. */}
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
        <nav className="mt-8 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">
            Trang {NUMBER.format(entries.page)} / {NUMBER.format(entries.pageCount)}
          </p>
          <div className="flex gap-2">
            {/* A disabled <button> at the ends rather than a link to nowhere:
                globals.css withholds the pointer cursor from `:disabled`
                precisely so a control that will not respond does not claim it
                will. */}
            {entries.page > 1 ? (
              <ButtonLink size="sm" href={hrefWith({ page: entries.page - 1 })}>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </ButtonLink>
            ) : (
              <Button size="sm" disabled>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </Button>
            )}
            {entries.page < entries.pageCount ? (
              <ButtonLink size="sm" href={hrefWith({ page: entries.page + 1 })}>
                Sau
                <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
              </ButtonLink>
            ) : (
              <Button size="sm" disabled>
                Sau
                <ChevronRight aria-hidden className="size-5" strokeWidth={1.75} />
              </Button>
            )}
          </div>
        </nav>
      ) : null}

      <section className="mt-12">
        <SectionHeading>Xuất dữ liệu</SectionHeading>
        <p className="mt-1 text-[15px] text-meta">
          Tải về để giữ một bản sao ngoài hệ thống. Tệp mở được bằng Excel.
        </p>
        {/* POST, not a link. P1 §3.5(c): a file holding every child's name,
            date of birth, parents' names and telephone number must not sit in
            the address bar of a shared parish phone, in its history, or in the
            next volunteer's autocomplete. A form leaves none of that behind. */}
        <div className="mt-4 flex flex-wrap gap-3">
          {[
            { kind: "sach", label: "Sách" },
            { kind: "nguoi-doc", label: "Bạn đọc" },
            { kind: "muon-tra", label: "Lượt mượn" },
          ].map(({ kind, label }) => (
            <form key={kind} method="post" action={`${base}/xuat/${kind}`}>
              <button type="submit" className={buttonClasses("outline", "lg")}>
                <Download aria-hidden className="size-5" strokeWidth={1.75} />
                {label}
              </button>
            </form>
          ))}
        </div>
      </section>
    </ManagerShell>
  );
}
