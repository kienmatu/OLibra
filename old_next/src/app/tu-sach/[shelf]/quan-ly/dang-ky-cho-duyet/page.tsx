import Link from "next/link";
import { AlertCircle, AlertTriangle, Check, Clock } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import { getPendingRegistrations } from "@/domain/members/queries/get-pending-registrations";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDate, formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { approveMembershipAction, rejectMembershipAction } from "../actions";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Đăng ký chờ duyệt — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** One field shown as a meta label above its value — used inside every group. */
function FieldValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[14px] text-meta">{label}</p>
      <p className="mt-0.5 text-[16px]">{value}</p>
    </div>
  );
}

function FieldGroup({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold">{heading}</h3>
      <div className="mt-2 border-t border-hairline" />
      {/* One column below `sm`, two above. The fixture version was
          `grid-cols-2` unconditionally, which at 375px — the manager's primary
          device (BR §17.5) — broke "Giuse Phạm Văn Long" across two lines and
          wrapped a telephone number in the middle of its digits. These are the
          fields BR §16.3 says a manager "must verify in person", read off a
          phone while the family is standing there. */}
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {children}
      </div>
    </div>
  );
}

/**
 * BR §16.3's registration queue: "a review card per application, laying out
 * exactly the fields the manager must verify in person, with prominent Approve
 * and Reject buttons and a required reason on rejection. A similar-name warning
 * appears when an existing member closely matches, to catch duplicate
 * registrations."
 *
 * **Every card, not one card and a drawn stack.** The fixture version rendered a
 * single application — borrowed from an *existing* member's row, with a
 * hand-written "Gửi lúc 09:12 ngày 04/08 · Chờ duyệt 2 ngày" and a warning about
 * a duplicate of itself — and drew a sliver behind it to suggest four more.
 * `getPendingRegistrations` returns the real queue, oldest first, so the sliver
 * is gone and so is the number 5 in the subtitle.
 *
 * **The similar-name warning is `pg_trgm`'s, and it is still only a warning.**
 * The query compares folded names at 0.6 against *active* members and nothing
 * merges, links or rejects on its strength — BR §16.3 asks for a catch a human
 * acts on. The card links to the existing member's own page so the manager can
 * check, which is what the fixture's dead "Xem hồ sơ đã có" button suggested and
 * could not do.
 *
 * **Rejection asks for its reason on the card**, in a `<details>` that opens
 * beside the approve button rather than on a second screen. The reason is
 * required by `memberships_rejected_has_reason` as well as by BR §2, which keeps
 * the row precisely so the person may re-apply — so a rejection with no reason
 * comes back as `errors.ts`' own sentence rather than as a constraint violation.
 *
 * One primary action per card and one card at a time being decided: the approve
 * button is the only solid terracotta on the screen, and reject is the `danger`
 * outline every other refusal in this app uses.
 */
export default async function PendingApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, applications } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      applications: await getPendingRegistrations(tx, ctx),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="dang-ky-cho-duyet"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Đăng ký chờ duyệt"
          subtitle={
            applications.length === 0
              ? "Quản lý cần gặp mặt và xác nhận thông tin trước khi duyệt."
              : `${NUMBER.format(applications.length)} đơn đang chờ · Quản lý cần gặp mặt và xác nhận thông tin trước khi duyệt.`
          }
        />

        {refused ? (
          <p
            role="alert"
            className="flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
          >
            <AlertCircle
              aria-hidden
              className="size-5 shrink-0"
              strokeWidth={1.75}
            />
            {messageFor(refused)}
          </p>
        ) : null}

        {applications.length === 0 ? (
          <p className="text-[15px] text-meta">
            Hiện không có đơn đăng ký nào đang chờ duyệt.
          </p>
        ) : null}

        {applications.map((application) => (
          <Card key={application.membershipId} className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <span
                  aria-hidden
                  className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
                >
                  {application.fullName.split(" ").at(-1)?.charAt(0) ?? ""}
                </span>
                <div>
                  <p className="text-xl font-semibold">{application.fullName}</p>
                  {/* `memberships.created_at`, through the locale — a
                      `timestamptz`, so `formatInstant` renders it in the shelf's
                      own timezone. The fixture wrote "Gửi lúc 09:12 ngày 04/08 ·
                      Chờ duyệt 2 ngày", both halves invented and the second one
                      stale the day after it shipped. */}
                  <p className="mt-0.5 text-[14px] text-meta">
                    Gửi ngày {formatInstant(application.requestedAt)}
                  </p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-held/10 px-2.5 py-1 text-[14px] font-medium text-held">
                <Clock aria-hidden className="size-[18px]" strokeWidth={1.75} />
                Chờ duyệt
              </span>
            </div>

            {application.similarTo ? (
              <div className="flex gap-3 rounded-card border border-onloan bg-onloan/10 p-4">
                <AlertTriangle
                  aria-hidden
                  className="size-5 shrink-0 text-onloan"
                  strokeWidth={1.75}
                />
                <div>
                  <p className="font-semibold text-onloan">
                    Có thành viên trùng tên
                  </p>
                  <p className="mt-1 text-[15px] text-ink/90">
                    Tủ sách đã có {application.similarTo.fullName}. Kiểm tra xem có
                    phải cùng một người không.
                  </p>
                  <Link
                    href={`${base}/nguoi-doc/${application.similarTo.membershipId}`}
                    className="mt-2 inline-flex min-h-11 items-center text-[15px] font-medium text-sage hover:underline"
                  >
                    Xem hồ sơ đã có
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="space-y-6">
              <FieldGroup heading="Bản thân">
                <FieldValue
                  label="Tên thánh"
                  value={application.saintName ?? "Chưa có"}
                />
                <FieldValue label="Họ và tên" value={application.fullName} />
                <FieldValue
                  label="Ngày sinh"
                  value={
                    application.dateOfBirth
                      ? formatDate(application.dateOfBirth)
                      : "Chưa có"
                  }
                />
              </FieldGroup>

              <FieldGroup heading="Gia đình">
                <FieldValue label="Tên cha" value={application.fatherName} />
                <FieldValue label="Tên mẹ" value={application.motherName} />
                <FieldValue
                  label="Số điện thoại"
                  value={
                    application.phone ? (
                      <PhoneLink phone={application.phone} size="md" />
                    ) : (
                      "Chưa có"
                    )
                  }
                />
              </FieldGroup>

              <FieldGroup heading="Giáo xứ">
                {/* The shelf's own labels, through `describeSelection` inside the
                    query — never the words "Tổ" or "Giáo họ" written here
                    (BR §16.3). Empty is a permanent, legitimate state. */}
                <FieldValue
                  label="Đơn vị"
                  value={application.parishLine || "Chưa có"}
                />
              </FieldGroup>
            </div>

            <div className="flex flex-wrap items-start gap-4 border-t border-hairline pt-6">
              <form action={approveMembershipAction}>
                <input type="hidden" name="tu-sach" value={slug} />
                <input
                  type="hidden"
                  name="thanh-vien"
                  value={application.membershipId}
                />
                <SubmitButton
                  icon={<Check aria-hidden className="size-5" strokeWidth={1.75} />}
                >
                  Duyệt đăng ký
                </SubmitButton>
              </form>

              {/* A `<details>` rather than a second screen: BR §16.3 wants the
                  reason required, and asking for it in place keeps the decision
                  on the card the manager is reading. `summary` carries the
                  button's own classes so it looks like the control it is —
                  `buttonClasses` exists for exactly this, and `<summary>` gets
                  the pointer cursor from `cursor-pointer` here because it is not
                  a `<button>`. */}
              <details className="min-w-0">
                <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-5 text-[16px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
                  Từ chối
                </summary>
                <form
                  action={rejectMembershipAction}
                  className="mt-3 w-full max-w-md space-y-3"
                >
                  <input type="hidden" name="tu-sach" value={slug} />
                  <input
                    type="hidden"
                    name="thanh-vien"
                    value={application.membershipId}
                  />
                  <Field
                    label="Lý do từ chối"
                    required
                    htmlFor={`ly-do-${application.membershipId}`}
                    hint="Được lưu lại để bạn đọc có thể đăng ký lại sau."
                  >
                    <Input
                      id={`ly-do-${application.membershipId}`}
                      name="ly-do"
                      required
                    />
                  </Field>
                  <SubmitButton variant="danger" size="md">
                    Xác nhận từ chối
                  </SubmitButton>
                </form>
              </details>

              <p className="text-[14px] text-meta">Từ chối cần ghi lý do.</p>
            </div>
          </Card>
        ))}
      </div>
    </ManagerShell>
  );
}
