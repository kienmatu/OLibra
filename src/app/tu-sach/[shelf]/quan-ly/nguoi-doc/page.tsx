import { ChevronLeft, ChevronRight, Search, UserPlus } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { FilterChips } from "@/components/ui/filter-chips";
import { ManagerShell } from "@/components/shell/manager-shell";
import { describeSelection, unitOptions } from "@/domain/members/parish-taxonomy";
import { getParishUnits } from "@/domain/members/queries/get-parish-units";
import {
  type ReadersListInput,
  getReadersList,
} from "@/domain/members/queries/get-readers-list";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import {
  MEMBERSHIP_STATUS,
  STATUS_PARAM,
  statusFromParam,
} from "@/lib/membership-status";
import { loadPage } from "@/lib/page-data";
import { pageNumber, param, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

/** SDD §6.6. Even a count of three goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * The parameters this page reads. `q`, `trang` and the Vietnamese-slug shape of
 * the filters are the spellings `danh-muc` and `quan-ly/sach` already use, so
 * the three list screens in this app read their URLs alike.
 */
const QUERY = "q";
const STATUS = "trang-thai";
const UNIT = "don-vi";
const PAGE = "trang";

/**
 * BR §16.3's Người đọc: "searchable list with status and parish-unit filters
 * (§5.6) — the filter free text could never support (§5.3), and the reason the
 * unit reference exists at all."
 *
 * **Every control is a link or a `GET` form.** These are server components with
 * no client JavaScript, so the fixture version's `<Input>` with no form around
 * it discarded whatever a volunteer typed into it, and its five status chips all
 * pointed at the same unfiltered URL.
 *
 * **The chips carry no counts, and the fixture's did** — `Tất cả (108)`,
 * `Đang hoạt động (96)`, `Chờ duyệt (5)`, `Tạm khoá (4)`, `Đã rời (3)`, beside a
 * heading reading "96 bạn đọc đang hoạt động · 5 đơn chờ duyệt". Six numbers,
 * none of them from anywhere. `getReadersList` returns `total` for the filter
 * actually applied and nothing about the other four, so showing them would mean
 * five more counting queries on every render of this page — and until somebody
 * writes them, U3 §3.1's rule holds exactly as it did for the sidebar: an
 * invented number mixed into a screen whose other half is real is
 * indistinguishable from data. The heading shows the one count that was
 * measured, for the filter in force.
 *
 * **The parish-unit chips are `getParishUnits`', not the taxonomy alone.**
 * `getReadersList` returns `taxonomy` and no units — it uses them to build each
 * row's `parishLine` and hands back the labels a filter header needs, not the
 * list a filter bar needs. Both run on the one transaction `loadPage` opened.
 *
 * **The `rejected` chip is new**, and it is the enum rather than new copy: the
 * fixture's `Reader` type had four membership states and `membership_status` has
 * five, so a reader whose application `RejectMembership` turned down was
 * unreachable from this screen even though BR §2 keeps the row on purpose ("may
 * re-apply"). `src/lib/membership-status.ts` records where its word comes from.
 *
 * **The chips themselves moved to `FilterChips`** (Task 14, 2026-08-10 QA
 * remediation), which draws them from `{ label, href, active, count? }[]`
 * instead of one `<Chip>` per line here. Nothing about how they look or behave
 * changes — `count` is simply never passed, matching the no-counts decision two
 * paragraphs up — except that `Chip` (`src/components/ui/segmented.tsx`) gained
 * `aria-current="page"` on the active one in the same move, so these chips carry
 * it now too, alongside `/quan-ly/thong-bao`'s and `/quan-ly/binh-luan`'s new
 * ones, which is the whole reason the extraction happened rather than a fourth
 * inline copy being written.
 */
export default async function ManagerReadersPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  // Not `{ parishUnitId?: string }`. `?q=a&q=b` arrives as an array — see
  // `src/lib/search-params.ts` for the four pages that shipped a 500 over it.
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;

  const query = param(search, QUERY) ?? "";
  const statusParam = param(search, STATUS);
  const status = statusFromParam(statusParam);
  // A unit id that names nothing narrows to nothing, which is what
  // `getReadersList`'s own `m.parish_unit_l1_id = …` already does with it — an
  // empty table, never an error. A *malformed* one would be a `22P02` from the
  // `::uuid` cast, so the value only travels when it matches a unit this shelf
  // actually has; see `unitFilter` below.
  const unitParam = param(search, UNIT);

  const input: ReadersListInput = {
    q: query,
    status,
    page: pageNumber(param(search, PAGE)),
  };

  const { shelf, viewer, counts, parish, page } = await loadPage(
    slug,
    async (tx, ctx, viewer) => {
      const parish = await getParishUnits(tx, ctx);
      return {
        shelf: await readShelf(tx, ctx),
        viewer,
        counts: await getManagerBadgeCounts(tx, ctx),
        parish,
        page: await getReadersList(tx, ctx, {
          ...input,
          // Resolved against the shelf's own units before it reaches SQL.
          parishUnitId: parish.units.some((u) => u.id === unitParam)
            ? unitParam
            : undefined,
        }),
      };
    },
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  const listHref = `${base}/nguoi-doc`;

  /**
   * One chip per live unit — the payoff BR §16.3 names, and the reason the unit
   * reference exists at all. Level 2 is labelled through `describeSelection`,
   * the same function every other screen writes a parish line with, so two units
   * sharing a name under different parents ("Tổ 1" under two giáo họ) still read
   * as distinct choices.
   */
  const level1 = unitOptions(parish.units, 1);
  const unitChips: { id: string; label: string }[] = level1.map((u) => ({
    id: u.id,
    label: u.name,
  }));
  if (parish.showLevel2) {
    if (parish.taxonomy.nested) {
      for (const parent of level1) {
        for (const child of unitOptions(parish.units, 2, parent.id)) {
          unitChips.push({
            id: child.id,
            label: describeSelection(parish.taxonomy, parish.units, {
              l1: parent.id,
              l2: child.id,
            }),
          });
        }
      }
    } else {
      for (const child of unitOptions(parish.units, 2)) {
        unitChips.push({ id: child.id, label: child.name });
      }
    }
  }
  const unit = unitChips.some((u) => u.id === unitParam) ? unitParam : undefined;

  /**
   * This page's URL with one filter changed and the rest kept — built from the
   * *resolved* values rather than by copying the incoming query string, so a
   * duplicated or hand-edited parameter cannot ride along into a link the page
   * itself emits. `quan-ly/sach` does the same and for the same reason. Changing
   * a filter drops `trang`.
   */
  const hrefWith = (over: {
    status?: string | null;
    unit?: string | null;
    page?: number;
  }): string => {
    const params = new URLSearchParams();
    if (query) params.set(QUERY, query);
    const nextStatus =
      over.status === undefined ? (status ? statusParam : undefined) : over.status;
    if (nextStatus) params.set(STATUS, nextStatus);
    const nextUnit = over.unit === undefined ? unit : over.unit;
    if (nextUnit) params.set(UNIT, nextUnit);
    const trang = over.page ?? 1;
    if (trang > 1) params.set(PAGE, String(trang));
    const string = params.toString();
    return string ? `${listHref}?${string}` : listHref;
  };

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nguoi-doc"
      viewer={viewer}
      counts={counts}
    >
      <PageHeading
        title="Người đọc"
        subtitle={`${NUMBER.format(page.total)} bạn đọc`}
        action={
          <ButtonLink href={`${listHref}/moi`} variant="primary" size="lg">
            <UserPlus aria-hidden className="size-5" strokeWidth={1.75} />
            Đăng ký người đọc mới
          </ButtonLink>
        }
      />

      {/* A GET form, so the search is in the URL and survives a refresh, a back
          button and a link pasted to another volunteer. The hidden fields carry
          the filters already on, so searching inside a unit does not drop it. */}
      <form action={listHref} className="mt-6 flex flex-wrap gap-3">
        <div className="w-full flex-1 sm:min-w-64">
          <Input
            name={QUERY}
            icon={Search}
            className="h-11"
            defaultValue={query}
            placeholder="Tìm tên bạn đọc"
            aria-label="Tìm tên bạn đọc"
          />
        </div>
        {status && statusParam ? (
          <input type="hidden" name={STATUS} value={statusParam} />
        ) : null}
        {unit ? <input type="hidden" name={UNIT} value={unit} /> : null}
      </form>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-meta">Trạng thái</span>
          <FilterChips
            chips={[
              {
                label: "Tất cả",
                href: hrefWith({ status: null }),
                active: !status,
              },
              ...Object.entries(STATUS_PARAM).map(([value, key]) => ({
                label: MEMBERSHIP_STATUS[key].label,
                href: hrefWith({ status: value }),
                active: statusParam === value,
              })),
            ]}
          />
        </div>

        {/* Only when the shelf has units at all: a bar with one chip that cannot
            be turned off beside a "Tất cả" meaning the same thing is two
            controls for no choice — `quan-ly/sach` makes the same call. */}
        {unitChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] text-meta">
              {parish.taxonomy.level1Label}
            </span>
            <FilterChips
              chips={[
                {
                  label: "Tất cả đơn vị",
                  href: hrefWith({ unit: null }),
                  active: !unit,
                },
                ...unitChips.map((u) => ({
                  label: u.label,
                  href: hrefWith({ unit: u.id }),
                  active: unit === u.id,
                })),
              ]}
            />
          </div>
        ) : null}
      </div>

      {/* The empty state's full stop is deliberate and matches `qua-han`'s
          "Không có cuốn nào quá hạn." — the two empty states this slice actually
          wrote. ("Không tìm thấy sách nào", a few files over, is a shipped
          string reused verbatim rather than a new one, so it keeps its own
          punctuation.) */}
      {page.rows.length === 0 ? (
        <p className="mt-8 text-[15px] text-meta">Không tìm thấy bạn đọc nào.</p>
      ) : (
        <>
          {/* Table on md and up — hairline rules, never a horizontal scroll. */}
          <div className="mt-6 hidden overflow-hidden rounded-card border border-hairline md:block">
            <table className="w-full text-left">
              <thead className="bg-paper">
                <tr>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Bạn đọc
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    {parish.taxonomy.level1Label}
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Đang mượn
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Trạng thái
                  </th>
                  <th className="px-4 py-3 text-[14px] font-medium text-meta">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {page.rows.map((reader) => {
                  const state = MEMBERSHIP_STATUS[reader.status];
                  return (
                    <tr key={reader.membershipId}>
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-[16px] font-medium">
                            {reader.fullName}
                          </p>
                          {/* The saint name, not a date of birth. The fixture
                              row printed `reader.born` here, and BR:126 (§4,
                              assumption 5) makes a date of birth a manager-only
                              field a manager reaches on the detail page — not
                              one this list puts beside a hundred names at once.
                              §5.3 is where the field is *defined*; the
                              manager-only rule is the assumption. */}
                          {reader.saintName ? (
                            <p className="mt-0.5 text-[13px] text-meta">
                              {reader.saintName}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {/* `describeSelection` returns "" when nothing is set —
                            a real and permanent state (BR §5.6), so it reads as
                            "Chưa có" rather than as an empty cell. */}
                        {reader.parishLine || "Chưa có"}
                      </td>
                      <td className="px-4 py-3 text-[15px] text-ink/85">
                        {NUMBER.format(reader.holdingCount)}
                      </td>
                      <td className="px-4 py-3">
                        <Pill
                          icon={state.icon}
                          label={state.label}
                          tone={state.tone}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <ButtonLink
                          href={`${listHref}/${reader.membershipId}`}
                          variant="quiet"
                          size="sm"
                        >
                          Xem hồ sơ
                        </ButtonLink>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Stacked cards below md — the same data, never a scrolling table. */}
          <div className="mt-6 space-y-3 md:hidden">
            {page.rows.map((reader) => {
              const state = MEMBERSHIP_STATUS[reader.status];
              return (
                <div
                  key={reader.membershipId}
                  className="rounded-card border border-hairline bg-surface p-4"
                >
                  <p className="truncate text-[16px] font-medium">
                    {reader.fullName}
                  </p>
                  <p className="mt-0.5 truncate text-[14px] text-meta">
                    {reader.parishLine || "Chưa có"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Pill icon={state.icon} label={state.label} tone={state.tone} />
                    <span className="text-[14px] text-meta">
                      Đang mượn {NUMBER.format(reader.holdingCount)}
                    </span>
                  </div>
                  <ButtonLink
                    href={`${listHref}/${reader.membershipId}`}
                    variant="quiet"
                    size="sm"
                    className="mt-3 w-full"
                  >
                    Xem hồ sơ
                  </ButtonLink>
                </div>
              );
            })}
          </div>
        </>
      )}

      {page.pageCount > 1 ? (
        <nav className="mt-8 flex items-center justify-between gap-4">
          <p className="text-[15px] text-meta">
            Trang {NUMBER.format(page.page)} / {NUMBER.format(page.pageCount)}
          </p>
          <div className="flex gap-2">
            {/* A disabled <button> at the ends rather than a link to nowhere:
                globals.css withholds the pointer cursor from `:disabled`
                precisely so a control that will not respond does not claim it
                will. */}
            {page.page > 1 ? (
              <ButtonLink size="sm" href={hrefWith({ page: page.page - 1 })}>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </ButtonLink>
            ) : (
              <Button size="sm" disabled>
                <ChevronLeft aria-hidden className="size-5" strokeWidth={1.75} />
                Trước
              </Button>
            )}
            {page.page < page.pageCount ? (
              <ButtonLink size="sm" href={hrefWith({ page: page.page + 1 })}>
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
    </ManagerShell>
  );
}
