import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AlertCircle,
  ArrowLeft,
  KeyRound,
  Lock,
  LogOut,
  Pencil,
  ShieldAlert,
  Unlock,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { BookCover, BookTitle } from "@/components/ui/book";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { Pill } from "@/components/ui/pill";
import { PhoneLink } from "@/components/ui/phone-link";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import { hasVisibleLevel2, unitOptions } from "@/domain/members/parish-taxonomy";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { getParishUnits } from "@/domain/members/queries/get-parish-units";
import {
  getReaderDetail,
  type ReaderDetail,
} from "@/domain/members/queries/get-reader-detail";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDate, formatDueDate, formatInstant } from "@/lib/dates";
import { MEMBERSHIP_STATUS } from "@/lib/membership-status";
import { loadPage } from "@/lib/page-data";
import { isUuid, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import {
  markMembershipLeftAction,
  reactivateMembershipAction,
  setReaderCredentialsAction,
  suspendMembershipAction,
  updateReaderProfileAction,
} from "../../actions";

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
 * The manager-only fields carry the "Chỉ quản lý thấy" marker the fixture page
 * already used, which is the screen saying out loud what BR:126 (§4, assumption
 * 5) decided. **All four of them**, now: date of birth, parents' names, phone
 * number *and* parish-unit placement. The last was unmarked, which made the
 * marker itself misleading — an unmarked row on a page whose other rows are
 * marked reads as a row that is not manager-only.
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
 * **Administrative actions are wired, as of Task 4.** The paragraph this one
 * replaces blamed an unwired `setPasswordHasher` — stale twice over even when
 * it was written, since `src/instrumentation.ts:45` already called it, and
 * doubly so now that Task 1 rebuilt the mechanism entirely (`ensureCrypto
 * Wired()`, `src/lib/crypto-wiring.ts`, called from every one of `page-data
 * .ts`'s four entry points). See the "Cấp tài khoản đăng nhập" section below
 * for what actually renders and why each control is state-gated.
 *
 * **"Cho mượn sách" is gone too.** It was a `<button>` that submitted nothing,
 * and there is no URL that opens the lend flow with a reader already chosen:
 * `cho-muon/nguoi-doc` takes `?sach=` and picks the reader, `cho-muon/xac-nhan`
 * takes both. A link to the flow's first step would drop the reader on the way,
 * which is a worse affordance than none.
 */

/**
 * Task 4's five controls, gated on the *reader's* state — never on the
 * viewer's role, which `../../actions.ts`'s own header explains is already
 * equal to this page's own floor (every one of the five commands, like the
 * query that reads this page, opens with `requireManager` and nothing
 * higher). "Cấp tài khoản đăng nhập"/"Đặt lại mật khẩu" are mutually
 * exclusive on `hasCredentials`; "Tạm khoá"/"Đánh dấu đã rời" show only
 * `active`, "Mở khoá lại" only `suspended`; "Sửa hồ sơ" always shows.
 *
 * One `<ul>` of bordered rows, the same list shape `co-cau/page.tsx` uses for
 * its own per-unit action rows, rather than five separately-styled blocks —
 * five different visual treatments for five buttons that all do the same
 * *kind* of thing (open a small form, submit, land back here) would be five
 * decisions to keep in step for no reader-facing benefit.
 */
function ReaderActions({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  return (
    <section className="mt-10 max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold">Quản lý tài khoản</h2>
      <ul className="divide-y divide-hairline rounded-card border border-hairline">
        <li className="p-4">
          <CredentialsDisclosure shelfSlug={shelfSlug} reader={reader} />
        </li>
        {reader.status === "active" ? (
          <li className="p-4">
            <SuspendDisclosure shelfSlug={shelfSlug} reader={reader} />
          </li>
        ) : null}
        {reader.status === "active" ? (
          <li className="p-4">
            <MarkLeftDisclosure shelfSlug={shelfSlug} reader={reader} />
          </li>
        ) : null}
        {reader.status === "suspended" ? (
          <li className="p-4">
            <ReactivateDisclosure shelfSlug={shelfSlug} reader={reader} />
          </li>
        ) : null}
        <li className="p-4">
          <EditProfileDisclosure shelfSlug={shelfSlug} reader={reader} />
        </li>
      </ul>
    </section>
  );
}

/**
 * "Cấp tài khoản đăng nhập" when the reader has none, "Đặt lại mật khẩu" when
 * they do — one command, `setReaderCredentialsAction`, behind both branches
 * (`set-reader-credentials.ts`'s own docstring argues for one command over
 * two, "because they are the same act from the volunteer's side"). The
 * brief's one terracotta primary for this screen lives in the first branch
 * only; the second is `quiet`, matching every other non-primary submit here.
 */
function CredentialsDisclosure({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  if (!reader.hasCredentials) {
    return (
      <details>
        <summary
          className={buttonClasses(
            "outline",
            "sm",
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
        >
          <KeyRound aria-hidden className="size-4" strokeWidth={1.75} />
          Cấp tài khoản đăng nhập
        </summary>
        <form
          action={setReaderCredentialsAction}
          className="mt-4 max-w-sm space-y-4"
        >
          <input type="hidden" name="tu-sach" value={shelfSlug} />
          <input type="hidden" name="thanh-vien" value={reader.membershipId} />
          <Field label="Tên đăng nhập" required htmlFor="ten-dang-nhap">
            <Input id="ten-dang-nhap" name="ten-dang-nhap" required />
          </Field>
          <Field
            label="Mật khẩu"
            required
            htmlFor="mat-khau"
            hint="Ít nhất 8 ký tự."
          >
            <Input
              id="mat-khau"
              name="mat-khau"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <p className="text-[14px] text-meta">
            Ghi lại giúp bạn đọc rồi đưa tận tay. Hệ thống không gửi tin nhắn.
          </p>
          <SubmitButton
            variant="primary"
            icon={<KeyRound aria-hidden className="size-5" strokeWidth={1.75} />}
          >
            Cấp tài khoản đăng nhập
          </SubmitButton>
        </form>
      </details>
    );
  }

  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
        Đặt lại mật khẩu
      </summary>
      <form action={setReaderCredentialsAction} className="mt-3 max-w-sm space-y-4">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="thanh-vien" value={reader.membershipId} />
        {/* The username the reader already has, resubmitted unchanged.
            `setReaderCredentials` always writes a username and a password
            together (INV-14) — there is no password-only variant — and
            `reader.username` is never null here, since `hasCredentials` is
            true. Not an editable box: the brief for this disclosure is
            "with `mat-khau` only". */}
        <input type="hidden" name="ten-dang-nhap" value={reader.username ?? ""} />
        <Field
          label="Mật khẩu mới"
          required
          htmlFor="mat-khau"
          hint="Ít nhất 8 ký tự."
        >
          <Input
            id="mat-khau"
            name="mat-khau"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <SubmitButton
          variant="quiet"
          size="sm"
          icon={<KeyRound aria-hidden className="size-4" strokeWidth={1.75} />}
        >
          Đặt lại mật khẩu
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * "Tạm khoá" — `active → suspended`. The reason box is required here even
 * though `suspendMembership` itself treats it as optional; see
 * `NO_SUSPENSION_REASON` in `../../actions.ts` for why that is this screen's
 * decision and not a stricter reading of the command. The helper sentence is
 * `docs/OPERATIONS.md`'s own quoted wording for this exact screen, not
 * reinvented here.
 *
 * **Corrected, QA remediation final fix wave.** The sentence used to read
 * "Tạm khoá chỉ chặn mượn mới. Sách đang mượn vẫn giữ nguyên." — added at
 * `caad879` (Task 4) — and both halves misled. `membershipFor`
 * (`src/auth/guards.ts`) filters `m.status = 'active'`, so a suspended
 * reader's membership stops resolving entirely: `contextFor` demotes them to
 * `guest`, and every page scoped to their shelf 404s, not only borrowing.
 * And `signIn` (`src/auth/session.ts`) never consults `memberships.status`
 * at all, so their password keeps authenticating — a manager reading "Tạm
 * khoá" would reasonably infer sign-in itself is blocked, and it is not; the
 * reader gets a "successful" sign-in that then lands nowhere. That sign-in
 * behaviour is an existing product decision and ships as-is here — only this
 * sentence changes, to describe it rather than contradict it.
 */
function SuspendDisclosure({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  const fieldId = `ly-do-tam-khoa-${reader.membershipId}`;
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] text-brick underline [&::-webkit-details-marker]:hidden">
        Tạm khoá
      </summary>
      <form action={suspendMembershipAction} className="mt-3 max-w-sm space-y-3">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="thanh-vien" value={reader.membershipId} />
        <p className="text-[14px] text-meta">
          Tạm khoá chặn dùng cả tủ sách, không chỉ mượn mới — người đọc vẫn đăng
          nhập được nhưng không vào được trang nào. Sách đang mượn vẫn giữ nguyên
          trong hệ thống.
        </p>
        <Field label="Lý do tạm khoá" required htmlFor={fieldId}>
          <Textarea id={fieldId} name="ly-do" required rows={2} />
        </Field>
        <SubmitButton
          variant="danger"
          size="sm"
          icon={<ShieldAlert aria-hidden className="size-4" strokeWidth={1.75} />}
        >
          Xác nhận tạm khoá
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * "Mở khoá lại" — `suspended → active`. No reason field: clearing
 * `suspension_reason` on the way out is `reactivateMembership`'s own job
 * (see that command's docstring), not a fact this form collects.
 */
function ReactivateDisclosure({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
        Mở khoá lại
      </summary>
      <form action={reactivateMembershipAction} className="mt-3 max-w-sm space-y-3">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="thanh-vien" value={reader.membershipId} />
        <p className="text-[14px] text-meta">
          Bạn đọc có thể mượn sách trở lại ngay sau khi mở khoá.
        </p>
        <SubmitButton
          variant="quiet"
          size="sm"
          icon={<Unlock aria-hidden className="size-4" strokeWidth={1.75} />}
        >
          Xác nhận mở khoá
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * "Đánh dấu đã rời" — any status `→ left`. `markMembershipLeft` itself
 * refuses while `reader.holdingCount` is above zero (`member_has_active_
 * loans`) — the same count this page's own "Đang mượn" section (below this
 * one) already shows — so the form submits and lets the domain answer rather
 * than this component re-deriving "has an active loan" a second time (G5).
 */
function MarkLeftDisclosure({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] text-brick underline [&::-webkit-details-marker]:hidden">
        Đánh dấu đã rời
      </summary>
      <form action={markMembershipLeftAction} className="mt-3 max-w-sm space-y-3">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="thanh-vien" value={reader.membershipId} />
        <p className="text-[14px] text-meta">
          Dùng khi gia đình không còn sinh hoạt ở giáo xứ nữa. Bạn đọc đang mượn
          sách cần được nhận trả trước.
        </p>
        <SubmitButton
          variant="danger"
          size="sm"
          icon={<LogOut aria-hidden className="size-4" strokeWidth={1.75} />}
        >
          Xác nhận đã rời
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * "Sửa hồ sơ" — `updateReaderProfile`'s direct-write path, wrapping the same
 * seven fields the reader's own profile form proposes
 * (`ho-so/page.tsx`'s "Thông tin cá nhân" section), pre-filled with what
 * is on file rather than blank. Field-for-field the same set, including which
 * three carry `required`: full name is, saint name/DOB/father's/mother's
 * names/phone/email are not, matching that sibling form exactly — a manager
 * blanking father's or mother's name still meets `updateReaderProfile`'s own
 * `required_fields_missing` refusal, same as a reader would proposing it.
 *
 * Always rendered, in every status: nothing about this command reads
 * `status`, so a manager can correct a suspended or departed reader's phone
 * number exactly as freely as an active one's.
 */
function EditProfileDisclosure({
  shelfSlug,
  reader,
}: {
  shelfSlug: string;
  reader: ReaderDetail;
}) {
  const idFor = (name: string) => `${name}-${reader.membershipId}`;
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
        Sửa hồ sơ
      </summary>
      <form action={updateReaderProfileAction} className="mt-3 max-w-sm space-y-4">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="thanh-vien" value={reader.membershipId} />

        <Field label="Tên thánh" required htmlFor={idFor("ten-thanh")}>
          <Input
            id={idFor("ten-thanh")}
            name="ten-thanh"
            required
            defaultValue={reader.saintName ?? ""}
          />
        </Field>

        <Field label="Họ và tên" required htmlFor={idFor("ho-ten")}>
          <Input
            id={idFor("ho-ten")}
            name="ho-ten"
            required
            defaultValue={reader.fullName}
          />
        </Field>

        <Field label="Ngày sinh" htmlFor={idFor("ngay-sinh")}>
          <Input
            id={idFor("ngay-sinh")}
            name="ngay-sinh"
            type="date"
            defaultValue={reader.dateOfBirth ?? ""}
          />
        </Field>

        <Field label="Tên cha" htmlFor={idFor("ten-cha")}>
          <Input
            id={idFor("ten-cha")}
            name="ten-cha"
            defaultValue={reader.fatherName}
          />
        </Field>

        <Field label="Tên mẹ" htmlFor={idFor("ten-me")}>
          <Input
            id={idFor("ten-me")}
            name="ten-me"
            defaultValue={reader.motherName}
          />
        </Field>

        <Field label="Số điện thoại" required htmlFor={idFor("dien-thoai")}>
          <Input
            id={idFor("dien-thoai")}
            name="dien-thoai"
            type="tel"
            inputMode="numeric"
            pattern={PHONE_PATTERN}
            required
            defaultValue={reader.phone ?? ""}
          />
        </Field>

        <Field label="Email" htmlFor={idFor("email")}>
          <Input
            id={idFor("email")}
            name="email"
            type="email"
            defaultValue={reader.email ?? ""}
          />
        </Field>

        <SubmitButton
          variant="quiet"
          icon={<Pencil aria-hidden className="size-4" strokeWidth={1.75} />}
        >
          Lưu thay đổi
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * QA remediation Task 25. Mirrors the page component's own two checks before
 * naming a reader in the tab: `isUuid(id)` first, since `memberships.id` is a
 * `uuid` and a non-uuid segment would otherwise reach `getReaderDetail`'s
 * `where membership_id = …` as a raw `22P02` Postgres cast failure rather than
 * a 404 (see the page body's own comment on this exact defect, found live by
 * `bun run check:links`); `getReaderDetail` itself second, through `loadPage`
 * so a guest redirects and a non-manager 404s exactly as the page would.
 *
 * A second query, not a lighter one: `getReaderDetail` is already `GetReader
 * Detail`'s narrow single-row read, and there is no memoization between this
 * function and the page component over a raw SQL call for a second
 * invocation to reuse.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shelf: string; id: string }>;
}): Promise<Metadata> {
  const { shelf: slug, id } = await params;
  if (!isUuid(id)) notFound();

  const { reader } = await loadPage(slug, async (tx, ctx) => ({
    reader: await getReaderDetail(tx, ctx, { membershipId: id }),
  }));

  return { title: `${reader.fullName} — Quản lý tủ sách OLibra` };
}

export default async function ManagerReaderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug, id } = await params;
  const refused = refusalFrom(await searchParams);

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
  const parishRows: {
    label: string;
    value: React.ReactNode;
    private?: boolean;
  }[] = [];
  if (unitOptions(parish.units, 1).length > 0) {
    parishRows.push({
      label: parish.taxonomy.level1Label,
      value: reader.parishUnitL1Name,
      // BR:126 (§4, assumption 5) lists four manager-only fields, not three:
      // "Date of birth, parents' names, phone number, and parish-unit placement
      // (§5.6)". These two rows carried no marker while the other four did, so
      // the screen was saying three of the four decisions out loud and keeping
      // one to itself. Nothing leaked — this whole page is behind
      // `requireManager` — but the marker is what tells a volunteer which lines
      // she must not read out in a room, and an incomplete marker teaches her
      // the unmarked ones are safe to.
      private: true,
    });
  }
  if (hasVisibleLevel2(parish.taxonomy, parish.units)) {
    parishRows.push({
      label: parish.taxonomy.level2Label,
      value: reader.parishUnitL2Name,
      private: true,
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
    {
      label: "Ngày tham gia",
      // **Added because a file was showing it and this page was not.** P1
      // §3.5(b) bounds the readers CSV to what BR §16.3 already shows a manager
      // on screen, and the readers export has carried a "Ngày tham gia" column
      // since it shipped — from `memberships.approved_at`, the same value read
      // here. The bound is only a bound if it holds for every column, so the
      // choice was to render it or to drop it, and rendering is the one that
      // keeps a fact a manager has an ordinary use for: how long this child has
      // been with the shelf, which is the first thing asked about a name nobody
      // on duty recognises.
      //
      // `formatInstant`, never `formatDate`: `approved_at` is a `timestamptz`
      // (0003_identity.sql:97) and not a calendar date, so it is resolved in
      // `Asia/Ho_Chi_Minh` — the same conversion `exportReaders` does in SQL,
      // for the same reason. Reading it as a bare date would file an approval
      // made after 5pm local under the previous day, which is the defect that
      // slice's own test pins.
      //
      // `null` is ordinary rather than missing: a membership created directly
      // by a manager, and every seeded one, has no approval instant at all.
      value: reader.approvedAt ? formatInstant(reader.approvedAt) : "Chưa có",
    },
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

      {/* Where every one of Task 4's five actions lands on a refusal —
          `backToReader` in `../../actions.ts` carries the code back as
          `?loi=`, same shape as every other manager screen's own refusal
          banner (`dang-ky-cho-duyet/page.tsx`, `co-cau/page.tsx`). */}
      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

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
                children never sign in. Shown quietly, never as a gap.
                `getReaderDetail` also returns the username itself now (Task 4,
                for the "Đặt lại mật khẩu" form below to resubmit unchanged) —
                never the hash, on this pill or anywhere else on the page. */}
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

      <ReaderActions shelfSlug={slug} reader={reader} />

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
                <BookCover
                  title={loan.title}
                  coverUrl={loan.coverUrl}
                  className="w-12 text-[1rem]"
                />
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
