import { AlertCircle, ArrowRight, Check, Clock } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import type { ProfileField } from "@/domain/members/profile-fields";
import { getPendingProfileChanges } from "@/domain/members/queries/get-pending-profile-changes";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatDate, formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { PROFILE_FIELD_LABELS, proposedFields } from "@/lib/profile-labels";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { approveProfileChangeAction, rejectProfileChangeAction } from "../actions";

/** U1 §2. See `../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

const NUMBER = new Intl.NumberFormat("vi-VN");

/**
 * How a value reads on the card.
 *
 * `null` is not "nothing to show": for `email` or `saint_name` it is a reader
 * asking for the field to be *cleared*, which is a change a manager decides on,
 * and rendering it as a blank space would make the proposal look empty.
 * `date_of_birth` goes through the locale like every other date (SDD §6.6) —
 * it is a `date` column, so `formatDate` and never `formatInstant`.
 */
function readValue(field: ProfileField, value: string | null): string {
  if (value === null || value === "") return "Chưa có";
  if (field === "date_of_birth") return formatDate(value);
  return value;
}

/**
 * BR §16.3's heart of this card: "showing the current value and the proposed one
 * side by side so the manager can see exactly what would change". Nothing is
 * struck through — the current value is still the one in force until a manager
 * approves, which is the sentence beneath every card.
 */
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

/**
 * The one field that is not text.
 *
 * The photograph is rendered, not described, and that is the whole reason it is
 * stored before the decision: OPS §4.3 — "the proposed image is stored when the
 * change is proposed, so the manager can look at it while deciding". The fixture
 * version drew two initial circles and a line reading "Bạn đọc gửi kèm một ảnh
 * mới", which is a card asking somebody to approve a photograph they cannot see.
 */
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
            // A plain <img>, deliberately: `next.config.ts` configures no image
            // optimizer for the object store's host, so `next/image` would refuse
            // the URL outright. This is a manager-only decision screen behind
            // `requireManager`, not a public page whose bytes anybody is
            // optimising. `alt=""` because the row's own label already names
            // what this is, and the photograph carries no text.
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

/**
 * OPS §3.3's `GetPendingProfileChanges` — BR §16.3: "one card per proposed
 * change, showing the current value and the proposed one side by side… Until a
 * decision is made the existing values remain in force, so a phone number
 * waiting for approval is still the number the manager can ring."
 *
 * **The "current" column is live, and that is the whole mechanism.** The query
 * reads `users` in the same transaction rather than trusting the request's own
 * `previous_values` snapshot — `UpdateReaderProfile` lets a manager correct a
 * detail directly without touching a pending request, so a proposal made on
 * Monday against phone A, corrected to B on Tuesday, still carries A in its
 * snapshot on Wednesday. That query's docstring holds the argument; this page
 * simply renders `currentValues` and never `previousValues`.
 *
 * **Which rows appear is the fields the request named, in the domain's order.**
 * `proposed_values` is `jsonb`, so its key order is whatever the writer
 * serialised; iterating `PROFILE_FIELDS` (via `proposedFields`) means two cards
 * proposing the same pair of fields list them the same way round.
 *
 * **Two cards no longer disagree about which one is primary.** The fixture
 * version gave the first card a solid terracotta approve button and the second
 * an outline, to honour "one primary action per screen". With a real queue of
 * unknown length that rule cannot be expressed by ordinal position — the third
 * card would need a third answer. Each card is a decision of its own, so each
 * carries the same pair of controls, and the screen's single strongest emphasis
 * is the card the manager is reading.
 */
export default async function PendingProfileChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, requests } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      requests: await getPendingProfileChanges(tx, ctx),
    }),
  );

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="doi-thong-tin"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Đổi thông tin"
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
          <p className="text-[15px] text-meta">
            Hiện không có đề nghị thay đổi nào đang chờ duyệt.
          </p>
        ) : null}

        {requests.map((request) => {
          // The heading is the *current* full name by construction — there is no
          // separate name on this row, deliberately, so a name corrected an hour
          // ago cannot be shown stale beside a proposal about a phone number.
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
                <form action={approveProfileChangeAction}>
                  <input type="hidden" name="tu-sach" value={slug} />
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
                    action={rejectProfileChangeAction}
                    className="mt-3 w-full max-w-md space-y-3"
                  >
                    <input type="hidden" name="tu-sach" value={slug} />
                    <input
                      type="hidden"
                      name="yeu-cau"
                      value={request.profileChangeRequestId}
                    />
                    <Field
                      label="Lý do từ chối"
                      required
                      htmlFor={`ly-do-${request.profileChangeRequestId}`}
                      hint="Bạn đọc sẽ thấy lý do này."
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
                  Từ chối cần ghi lý do — bạn đọc sẽ thấy lý do này.
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </ManagerShell>
  );
}
