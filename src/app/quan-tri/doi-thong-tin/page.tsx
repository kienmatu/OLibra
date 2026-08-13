import Link from "next/link";
import { AlertCircle, Archive, ArrowRight, Check, Clock } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { AdminShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import type { ProfileField } from "@/domain/members/profile-fields";
import { countUnreadFeedback } from "@/domain/admin/queries/get-feedback-inbox";
import { getPendingManagerChanges } from "@/domain/admin/queries/get-pending-manager-changes";
import { formatDate, formatInstant } from "@/lib/dates";
import { loadAdminPage } from "@/lib/page-data";
import { PROFILE_FIELD_LABELS, proposedFields } from "@/lib/profile-labels";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import {
  approveManagerProfileChangeAction,
  rejectManagerProfileChangeAction,
} from "../actions";

/**
 * §9 of docs/superpowers/specs/2026-08-12-po-feedback-design.md, PO feedback
 * round 1 Task 10 — the super admin's half of the routing table
 * `../../tu-sach/[shelf]/quan-ly/doi-thong-tin/page.tsx` already renders the
 * other half of. That page is where every row's own docstring lives (the
 * live "current" column, `proposedFields`' ordering, why no card is
 * "primary"); this one follows it rather than inventing a second dialect —
 * see the functions below, copied for the reason that page's own
 * `AvatarCompareRow` gives for its own duplication risk: this route reads
 * from `getPendingManagerChanges`, a different query with a different row
 * shape, so importing the shelf page's private helpers is not on offer, and
 * the shared behaviour is kept identical by eye instead.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Đổi thông tin quản lý — OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

/** Identical to the shelf page's own `readValue` — see its docstring. */
function readValue(field: ProfileField, value: string | null): string {
  if (value === null || value === "") return "Chưa có";
  if (field === "date_of_birth") return formatDate(value);
  return value;
}

/** Identical to the shelf page's own `CompareRow`. */
function CompareRow({
  label,
  current,
  proposed,
}: {
  label: string;
  current: React.ReactNode;
  proposed: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <p className="text-[14px] font-medium text-meta">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-[16px] text-ink/60">{current}</span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-leather"
          strokeWidth={2}
        />
        <span className="rounded-control bg-terracotta/10 px-3 py-1.5 text-[16px] font-semibold text-terracotta-ink">
          {proposed}
        </span>
      </div>
    </div>
  );
}

/** Identical to the shelf page's own `AvatarCompareRow` — see its docstring. */
function AvatarCompareRow({
  label,
  current,
  proposed,
  initial,
}: {
  label: string;
  current: string | null;
  proposed: string | null;
  initial: string;
}) {
  const frame =
    "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-paper text-[18px] font-semibold text-leather";
  return (
    <div className="py-4">
      <p className="text-[14px] font-medium text-meta">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className={frame}>
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </span>
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-leather"
          strokeWidth={2}
        />
        <span className={`${frame} border-2 border-terracotta bg-terracotta/10`}>
          {proposed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proposed} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </span>
      </div>
      {proposed === null ? (
        <p className="mt-2 text-[14px] text-meta">
          Bạn đọc đề nghị bỏ ảnh hiện tại.
        </p>
      ) : null}
    </div>
  );
}

export default async function PendingManagerChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { viewer, unreadFeedback, requests } = await loadAdminPage(
    async (tx, ctx, v) => ({
      viewer: v,
      unreadFeedback: await countUnreadFeedback(tx, ctx),
      requests: await getPendingManagerChanges(tx, ctx),
    }),
  );

  return (
    <AdminShell
      active="doi-thong-tin"
      viewer={viewer}
      counts={{ unreadFeedback, pendingManagerChanges: requests.length }}
    >
      <div className="space-y-8">
        <PageHeading
          title="Đổi thông tin quản lý"
          subtitle={
            requests.length === 0
              ? "Thông tin cũ vẫn có hiệu lực cho tới khi bạn duyệt."
              : `${NUMBER.format(requests.length)} đề nghị đang chờ · Thông tin cũ vẫn có hiệu lực cho tới khi bạn duyệt.`
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

        {requests.length === 0 ? (
          <p className="text-[15px] text-meta">Không có đề nghị nào đang chờ.</p>
        ) : null}

        {requests.map((request) => {
          // The heading is the *current* full name, live, for the identical
          // reason the shelf page's own docstring gives — there is no second
          // copy of it on this row to drift out of step.
          const name = request.currentValues.full_name ?? "";
          const initial = name.split(" ").at(-1)?.charAt(0) ?? "";
          const fields = proposedFields(request.proposedValues);

          return (
            <Card key={request.profileChangeRequestId} className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="flex size-14 shrink-0 items-center justify-center rounded-full bg-paper text-[20px] font-semibold text-leather"
                  >
                    {initial}
                  </span>
                  <div>
                    <p className="text-xl font-semibold">{name}</p>
                    <p className="mt-0.5 text-[14px] text-meta">
                      Gửi ngày {formatInstant(request.requestedAt)}
                    </p>
                    {/* This queue is cross-shelf, unlike the shelf page's own —
                        every card names which parish it belongs to. Linked to
                        the shelf's own editor, the same target
                        `tu-sach/page.tsx`'s own list already links a shelf
                        name to. */}
                    <p className="mt-0.5 flex items-center gap-1.5 text-[14px] text-meta">
                      <Archive
                        aria-hidden
                        className="size-[14px] shrink-0"
                        strokeWidth={1.75}
                      />
                      <Link
                        href={`/quan-tri/tu-sach?tu-sach=${encodeURIComponent(request.shelfSlug)}`}
                        className="hover:underline"
                      >
                        {request.shelfName}
                      </Link>
                    </p>
                  </div>
                </div>
                <Pill icon={Clock} label="Chờ duyệt" tone="held" />
              </div>

              <div className="divide-y divide-hairline border-y border-hairline">
                {fields.map((field) =>
                  field === "avatar_url" ? (
                    <AvatarCompareRow
                      key={field}
                      label={PROFILE_FIELD_LABELS[field]}
                      current={request.currentValues.avatar_url}
                      proposed={request.proposedValues.avatar_url ?? null}
                      initial={initial}
                    />
                  ) : (
                    <CompareRow
                      key={field}
                      label={PROFILE_FIELD_LABELS[field]}
                      current={readValue(field, request.currentValues[field])}
                      proposed={readValue(
                        field,
                        request.proposedValues[field] ?? null,
                      )}
                    />
                  ),
                )}
              </div>

              <p className="text-[14px] text-meta">
                Giá trị hiện tại vẫn dùng được cho tới khi duyệt.
              </p>

              <div className="flex flex-wrap items-start gap-4 border-t border-hairline pt-6">
                <form action={approveManagerProfileChangeAction}>
                  <input type="hidden" name="tu-sach" value={request.bookshelfId} />
                  <input
                    type="hidden"
                    name="yeu-cau"
                    value={request.profileChangeRequestId}
                  />
                  <SubmitButton
                    icon={
                      <Check aria-hidden className="size-5" strokeWidth={1.75} />
                    }
                  >
                    Duyệt thay đổi
                  </SubmitButton>
                </form>

                <details className="min-w-0">
                  <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-brick px-5 text-[16px] font-semibold text-brick transition-colors hover:bg-brick/8 [&::-webkit-details-marker]:hidden">
                    Từ chối
                  </summary>
                  <form
                    action={rejectManagerProfileChangeAction}
                    className="mt-3 w-full max-w-md space-y-3"
                  >
                    <input
                      type="hidden"
                      name="tu-sach"
                      value={request.bookshelfId}
                    />
                    <input
                      type="hidden"
                      name="yeu-cau"
                      value={request.profileChangeRequestId}
                    />
                    <Field
                      label="Lý do từ chối"
                      required
                      htmlFor={`ly-do-${request.profileChangeRequestId}`}
                      hint="Người này sẽ thấy lý do này."
                    >
                      <Input
                        id={`ly-do-${request.profileChangeRequestId}`}
                        name="ly-do"
                        required
                      />
                    </Field>
                    <SubmitButton variant="danger" size="md">
                      Xác nhận từ chối
                    </SubmitButton>
                  </form>
                </details>

                <p className="text-[14px] text-meta">
                  Từ chối cần ghi lý do — người này sẽ thấy lý do này.
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </AdminShell>
  );
}
