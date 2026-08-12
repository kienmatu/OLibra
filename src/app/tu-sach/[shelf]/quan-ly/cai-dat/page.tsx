import { Download } from "lucide-react";
import { ManagerShell } from "@/components/shell/manager-shell";
import { PageHeading } from "@/components/ui/card";
import { buttonClasses } from "@/components/ui/button";
import { PhoneLink } from "@/components/ui/phone-link";
import type { PolicyField } from "@/domain/admin/policy";
import {
  getShelfSettings,
  type LendingPolicy,
} from "@/domain/shelf/queries/get-shelf-settings";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { readShelf } from "@/lib/shelf";
import { DISPLAYED_POLICY_FIELDS } from "./policy-fields";

/**
 * OPS §3.4's `GetShelfSettings` — "view this shelf's profile and lending
 * policy", read-only, `manager`.
 *
 * **Read-only, and the sentence saying so is now true.** The fixture version
 * printed six policy values as literals — 14 / 3 / 1 / 7 / 3 / 3 — under the
 * line "Chỉ quản trị viên mới đổi được các mục này". Those numbers happened to
 * match the defaults, so a shelf that had overridden `loan_days` to 21 read
 * "14 ngày" here while lending for twenty-one, and nothing anywhere disagreed
 * out loud. That is the failure mode a settings screen has: it is believed.
 *
 * **The defaults are part of the policy, not an absence.** `bookshelves
 * .settings` is a schemaless `jsonb` bag, so a shelf that has never set
 * `loan_days` genuinely lends for fourteen days — `loanDaysFor` says so. The
 * query answers 14 rather than "chưa đặt", and
 * `tests/domain/shelf/shelf-settings.test.ts` compares its six numbers against
 * the shipped readers rather than against literals, so changing a default in one
 * place fails there instead of drifting here.
 *
 * **The three export buttons are forms**, as they already are on the audit page,
 * and for the reason P1 §3.5(c) gives: a CSV of every child's name, date of
 * birth, parents' names and telephone number must not sit in the address bar of
 * a shared parish phone. The fixture version rendered them as `<Button>`s that
 * did nothing at all.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Cài đặt — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** One label/value row with a hairline rule above it. */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-hairline py-4 first:border-t-0">
      <dt className="text-[15px] text-meta">{label}</dt>
      <dd className="mt-1 text-[16px] font-medium text-ink">{children}</dd>
    </div>
  );
}

/** A lending-policy row: plain text, never a control, because a manager cannot edit it. */
function PolicyRow({
  label,
  hint,
  value,
}: {
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline py-4 first:border-t-0">
      <div className="max-w-md min-w-0">
        <p className="text-[16px] font-medium">{label}</p>
        <p className="mt-0.5 text-[14px] text-meta">{hint}</p>
      </div>
      <p className="shrink-0 text-[16px] font-semibold text-ink/85">{value}</p>
    </div>
  );
}

/**
 * Label, hint sentence and formatted value for each of
 * `DISPLAYED_POLICY_FIELDS` — QA remediation Task 23, the same pairing
 * `POLICY_FIELD_META` gives `/quan-tri/tu-sach`'s editor. `Record<PolicyField,
 * …>` rather than a bare array so TypeScript refuses a build that adds a
 * field to `PolicyField` without also giving it a row here.
 */
function policyRowMeta(
  format: (n: number) => string,
): Record<
  PolicyField,
  { label: string; hint: string; read: (policy: LendingPolicy) => string }
> {
  const days = (n: number) => `${format(n)} ngày`;
  return {
    loan_days: {
      label: "Số ngày cho mượn",
      hint: "Số ngày bạn đọc được giữ sách trong một lượt mượn.",
      read: (p) => days(p.loanDays),
    },
    max_concurrent_loans: {
      label: "Số sách mượn cùng lúc",
      hint: "Số cuốn tối đa một bạn đọc được giữ cùng lúc.",
      read: (p) => `${format(p.maxConcurrentLoans)} cuốn`,
    },
    max_renewals: {
      label: "Số lần gia hạn",
      hint: "Số lần bạn đọc được xin gia hạn cho một lượt mượn.",
      read: (p) => `${format(p.maxRenewals)} lần`,
    },
    renewal_days: {
      label: "Số ngày mỗi lần gia hạn",
      hint: "Số ngày được cộng thêm mỗi lần gia hạn.",
      read: (p) => days(p.renewalDays),
    },
    hold_days: {
      label: "Số ngày giữ chỗ",
      hint: "Số ngày tủ sách giữ sách cho bạn đọc đã đăng ký chờ mượn.",
      read: (p) => days(p.holdDays),
    },
    due_soon_days: {
      label: "Báo sắp đến hạn trước",
      hint: "Số ngày trước hạn trả mà hệ thống nhắc bạn đọc.",
      read: (p) => days(p.dueSoonDays),
    },
  };
}

export default async function ManagerSettingsPage({
  params,
}: {
  params: Promise<{ shelf: string }>;
}) {
  const { shelf: slug } = await params;

  const { shelf, viewer, counts, settings } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      settings: await getShelfSettings(tx, ctx),
    }),
  );

  const { profile, policy } = settings;
  const base = `/tu-sach/${slug}/quan-ly`;
  const policyMeta = policyRowMeta((n) => NUMBER.format(n));

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="cai-dat"
      viewer={viewer}
      counts={counts}
    >
      <PageHeading title="Cài đặt" subtitle={`Cài đặt của ${profile.name}.`} />

      <div className="mt-8 max-w-2xl space-y-12">
        <section>
          <h2 className="text-xl font-semibold">Thông tin tủ sách</h2>
          <dl className="mt-4">
            <InfoRow label="Tên tủ sách">{profile.name}</InfoRow>
            {/* "Chưa có" rather than an empty row: every one of these is
                nullable, and a blank line reads as a rendering bug. */}
            {/* QA remediation Task 22: this row used to be labelled "Địa
                chỉ" over `profile.location`'s value — measured live on
                2026-08-10, a manager read "Nhà xứ Thánh Tâm" (the landmark in
                `location`) under a label that promised a street address,
                while `profile.address` (the actual street address an
                administrator had typed in) rendered nowhere on this page or
                any other. "Địa điểm" is the true label for `location`; the
                row below it is the one that now carries `address`. */}
            <InfoRow label="Địa điểm">{profile.location ?? "Chưa có"}</InfoRow>
            <InfoRow label="Địa chỉ">{profile.address ?? "Chưa có"}</InfoRow>
            {profile.contacts.length === 0 ? (
              <InfoRow label="Người liên hệ">Chưa có</InfoRow>
            ) : (
              profile.contacts.map((contact) => (
                <InfoRow
                  key={contact.position}
                  label={contact.roleLabel ?? "Người liên hệ"}
                >
                  <span className="flex flex-wrap items-center gap-x-2">
                    {contact.name}
                    {contact.phone ? (
                      <PhoneLink phone={contact.phone} size="sm" />
                    ) : null}
                  </span>
                </InfoRow>
              ))
            )}
          </dl>
          <p className="mt-3 text-[14px] text-meta">
            Muốn đổi những thông tin này thì nhờ quản trị viên giúp.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Quy định cho mượn</h2>
          {/* Mapped from `DISPLAYED_POLICY_FIELDS` (`./policy-fields.ts`)
              rather than six literal `<PolicyRow>` calls here (QA
              remediation Task 23): that file is what `tests/architecture/
              every-shown-policy-is-editable.test.ts` compares against
              `/quan-tri/tu-sach`'s own field list, and the comparison is
              only honest if this is the array actually driving what a
              manager sees. */}
          <div className="mt-4">
            {DISPLAYED_POLICY_FIELDS.map((field) => {
              const meta = policyMeta[field];
              return (
                <PolicyRow
                  key={field}
                  label={meta.label}
                  hint={meta.hint}
                  value={meta.read(policy)}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[14px] text-meta">
            Chỉ quản trị viên mới đổi được các mục này.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Bình luận</h2>
          <dl className="mt-4">
            <InfoRow label="Cho phép bình luận">
              {policy.commentsEnabled ? "Có" : "Không"}
            </InfoRow>
            <InfoRow label="Bình luận cần duyệt">
              {policy.commentsRequireApproval ? "Có" : "Không"}
            </InfoRow>
          </dl>
        </section>

        <section>
          <h2 className="text-xl font-semibold">Xuất dữ liệu</h2>
          <p className="mt-2 text-[15px] text-meta">
            Tải toàn bộ dữ liệu về máy để phòng khi cần. Tệp mở được bằng Excel.
          </p>
          {/* POST, not a link — see this file's header, and the identical block
              on the audit page. */}
          <div className="mt-4 flex flex-wrap gap-3">
            {[
              { kind: "sach", label: "Xuất danh sách sách" },
              { kind: "nguoi-doc", label: "Xuất danh sách bạn đọc" },
              { kind: "muon-tra", label: "Xuất lịch sử mượn" },
            ].map(({ kind, label }) => (
              <form key={kind} method="post" action={`${base}/xuat/${kind}`}>
                <button type="submit" className={buttonClasses("quiet", "sm")}>
                  <Download
                    aria-hidden
                    className="size-[18px]"
                    strokeWidth={1.75}
                  />
                  {label}
                </button>
              </form>
            ))}
          </div>
        </section>
      </div>
    </ManagerShell>
  );
}
