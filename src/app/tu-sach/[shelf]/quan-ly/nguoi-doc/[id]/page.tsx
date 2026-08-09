import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, Lock } from "lucide-react";
import { BookCover, BookTitle } from "@/components/ui/book";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pill } from "@/components/ui/pill";
import { PhoneLink } from "@/components/ui/phone-link";
import { ManagerShell } from "@/components/shell/manager-shell";
import { hasVisibleLevel2, unitOptions } from "@/domain/members/parish-taxonomy";
import { getParishUnits } from "@/domain/members/queries/get-parish-units";
import { getReaderDetail } from "@/domain/members/queries/get-reader-detail";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDate, formatDueDate } from "@/lib/dates";
import { MEMBERSHIP_STATUS } from "@/lib/membership-status";
import { loadPage } from "@/lib/page-data";
import { isUuid } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";

/** U1 §2. See `../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * OPS §3.3's `GetReaderDetail` — "a reader's full profile", and **the most
 * identifying read in this system**.
 *
 * BR §5.3 puts a child's date of birth, both parents' names and a family
 * telephone number on the person, and BR §16.3 puts them on this page in as many
 * words ("detail view shows the full profile — including the manager-only
 * fields"). What makes that safe is not this page: `getReaderDetail` opens with
 * `requireManager`, and `users` carries no row-level security at all
 * (`0010_rls.sql` names it among the three global tables that get none), so the
 * scoping is the `join memberships` inside that query and never the row. A
 * reader who types this URL is refused by the domain, and `loadPage` turns the
 * refusal into U1 §3.4's 404 before a byte of HTML exists.
 *
 * The three fields carry the "Chỉ quản lý thấy" marker the fixture page already
 * used, which is the screen saying out loud what BR §5.3 decided.
 *
 * ── What this page does *not* do, and each is a decision ─────────────────────
 *
 * **No loan history.** BR §16.3 asks for "complete history" and no query in this
 * codebase answers it: `getBookDetailManager` has a full loan history *per
 * book*, and there is nothing per reader. The fixture version filled the gap by
 * slicing four titles out of `src/lib/fixtures.ts` and printing them under this
 * reader's name with invented dates and return conditions — a table of loans
 * that never happened, on a page that would otherwise be entirely real. Removed
 * rather than replaced, for U3 §3.1's reason.
 *
 * **No administrative actions.** BR §16.3 asks for them and all five commands
 * exist — `setReaderCredentials`, `suspendMembership`, `reactivateMembership`,
 * `markMembershipLeft`, `updateReaderProfile`. The fixture page drew four
 * `<button>`s with no form and no action behind any of them, which is the shape
 * U2 removed from the reader header and for the same reason. They are not wired
 * here because this wave's scope names this page's query and no command, and
 * because one of them cannot work at all today: nothing in the running
 * application calls `setPasswordHasher`, so any screen that sets a password
 * reaches `NotWired`. Recorded rather than left to be discovered — the buttons
 * are absent, not disabled.
 *
 * **"Cho mượn sách" is gone too.** It was a `<button>` that submitted nothing,
 * and there is no URL that opens the lend flow with a reader already chosen:
 * `cho-muon/nguoi-doc` takes `?sach=` and picks the reader, `cho-muon/xac-nhan`
 * takes both. A link to the flow's first step would drop the reader on the way,
 * which is a worse affordance than none.
 */
export default async function ManagerReaderDetailPage({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}) {
  const { shelf: slug, id } = await params;

  // **A 404 before any query, and this is the fix for a live 500.** `memberships
  // .id` is a `uuid`, so a segment that is not one reaches Postgres as a failed
  // cast and comes back a raw `22P02` — OPS §2's unstructured exception, shown
  // to a volunteer as a server error. `bun run check:links` found it on the
  // first crawl of this page, following the fixture-era URL
  // `/quan-ly/nguoi-doc/minh`, which is exactly the stale bookmark shape a
  // volunteer reaches after a slice like this one lands.
  //
  // `notFound()` and not an empty state, unlike `readerFromParam`'s `null` for
  // the identical check: this is the *router's* segment rather than a
  // volunteer's query parameter, and a URL naming no reader is a mistyped
  // address. `scripts/check-links.mjs` draws the same line, and `search-params
  // .ts` holds the one copy of the regex.
  if (!isUuid(id)) notFound();

  const { shelf, viewer, counts, parish, reader } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      parish: await getParishUnits(tx, ctx),
      // A membership id from the URL. `getReaderDetail` throws
      // `NotFound("membership_not_found")` for one that names nothing *this
      // shelf can see* — RLS filtered it, nobody compared two shelf ids — and
      // `loadPage` renders that as a 404. A malformed id is a `22P02` and stays
      // a fault, exactly as `lending.ts` records for the same shape.
      reader: await getReaderDetail(tx, ctx, { membershipId: id }),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;
  const state = MEMBERSHIP_STATUS[reader.status];
  // The last word of a Vietnamese name is the given name — the same line the
  // manager sidebar and the public header both carry.
  const initial = reader.fullName.split(" ").at(-1)?.charAt(0) ?? "";

  /**
   * Rows for the shelf's own parish levels — only for a level that actually has
   * units, so a shelf with one level (or none yet) does not show a row that
   * could never have a value. BR §16.3: the label is the shelf's own, never the
   * words "Tổ" or "Giáo họ" written into the screen.
   */
  const parishRows: { label: string; value: React.ReactNode }[] = [];
  if (unitOptions(parish.units, 1).length > 0) {
    parishRows.push({
      label: parish.taxonomy.level1Label,
      value: reader.parishUnitL1Name,
    });
  }
  if (hasVisibleLevel2(parish.taxonomy, parish.units)) {
    parishRows.push({
      label: parish.taxonomy.level2Label,
      value: reader.parishUnitL2Name,
    });
  }

  const info: { label: string; value: React.ReactNode; private?: boolean }[] = [
    { label: "Tên thánh", value: reader.saintName ?? "Chưa có" },
    {
      label: "Ngày sinh",
      // Through the locale (SDD §6.6). `date_of_birth` is a `date` column, so
      // `formatDate` — never `formatInstant`, which would read a calendar date
      // as an instant and render it a day early west of UTC.
      value: reader.dateOfBirth ? formatDate(reader.dateOfBirth) : "Chưa có",
      private: true,
    },
    ...parishRows,
    { label: "Tên cha", value: reader.fatherName, private: true },
    { label: "Tên mẹ", value: reader.motherName, private: true },
    {
      label: "Số điện thoại",
      value: reader.phone ? (
        <PhoneLink phone={reader.phone} size="sm" />
      ) : (
        "Chưa có"
      ),
      private: true,
    },
    { label: "Email", value: reader.email ?? "Chưa có" },
  ];

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nguoi-doc"
      viewer={viewer}
      counts={counts}
    >
      <Link
        href={`${base}/nguoi-doc`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách bạn đọc
      </Link>

      <div className="mt-3 flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-paper text-[24px] font-semibold text-leather"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-semibold">
            {reader.fullName}
          </h1>
          <p className="mt-1 text-[15px] text-meta">
            {reader.parishLine || "Chưa có đơn vị"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Pill icon={state.icon} label={state.label} tone={state.tone} />
            {/* INV-14: an account has either both a username and a password or
                neither, and having neither is a perfectly normal state — most
                children never sign in. Shown quietly, never as a gap. Only the
                boolean reaches this page; `getReaderDetail` returns
                `hasCredentials` and never the hash. */}
            <Pill
              icon={reader.hasCredentials ? KeyRound : Lock}
              label={
                reader.hasCredentials
                  ? "Có tài khoản đăng nhập"
                  : "Chưa có tài khoản đăng nhập"
              }
              tone="neutral"
            />
          </div>
        </div>
      </div>

      {/* BR §2 keeps a rejected application and a suspension with their reasons,
          and this is the only screen that can show them. The fixture page could
          not: its `Reader` type had no such field. */}
      {reader.rejectionReason ? (
        <p className="mt-6 max-w-2xl rounded-card border border-hairline bg-paper px-4 py-3 text-[15px]">
          <span className="text-meta">Lý do từ chối: </span>
          {reader.rejectionReason}
        </p>
      ) : null}
      {reader.suspensionReason ? (
        <p className="mt-3 max-w-2xl rounded-card border border-hairline bg-paper px-4 py-3 text-[15px]">
          <span className="text-meta">Lý do tạm khoá: </span>
          {reader.suspensionReason}
        </p>
      ) : null}

      <section className="mt-10 max-w-2xl">
        <h2 className="text-xl font-semibold">Thông tin</h2>
        <dl className="mt-4 divide-y divide-hairline border-y border-hairline">
          {info.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3"
            >
              <dt className="flex items-center gap-2 text-[14px] text-meta">
                {row.label}
                {row.private ? (
                  <span className="rounded-control bg-paper px-1.5 py-0.5 text-[12px] font-medium text-leather">
                    Chỉ quản lý thấy
                  </span>
                ) : null}
              </dt>
              <dd className="text-right text-[16px]">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 max-w-2xl">
        <h2 className="text-xl font-semibold">
          Đang mượn ({NUMBER.format(reader.holdingCount)} / tối đa{" "}
          {NUMBER.format(shelf.maxConcurrentLoans)})
        </h2>
        {/* BR §5.5's limit, read from this shelf's own settings rather than
            written in as a constant — the fixture page hard-coded 3. */}
        {reader.holdingCount >= shelf.maxConcurrentLoans ? (
          <p className="mt-1 text-[14px] text-meta">
            Bạn đọc này đã mượn tối đa, không thể mượn thêm.
          </p>
        ) : null}

        {reader.currentLoans.length === 0 ? (
          <p className="mt-4 text-[15px] text-meta">Hiện không mượn cuốn nào.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {reader.currentLoans.map((loan) => (
              <li
                key={loan.loanId}
                className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3"
              >
                <BookCover title={loan.title} className="w-12 text-[1rem]" />
                <div className="min-w-0 flex-1">
                  <BookTitle className="block truncate text-[16px] leading-snug">
                    {loan.title}
                  </BookTitle>
                  <p className="mt-0.5 text-[13px] text-meta">{loan.copyCode}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {/* `isOverdue` is `loans_current`'s own derived column,
                      following `ctx.clock` through the `olibra.now` GUC — never
                      recomputed here, which would be a second definition of
                      "overdue" in a second language (G5). */}
                  <StatusBadge
                    status={loan.isOverdue ? "overdue" : "onloan"}
                    size="sm"
                  />
                  <span className="text-[13px] text-meta">
                    Hạn {formatDueDate(loan.dueOn)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ManagerShell>
  );
}
