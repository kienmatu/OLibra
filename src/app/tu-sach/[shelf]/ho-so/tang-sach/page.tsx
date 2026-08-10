import Link from "next/link";
import { Gift } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeading, SectionHeading } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { ReaderTabs } from "@/components/shell/reader-tabs";
import { NotAReaderNotice } from "@/components/shell/reader-not-a-member";
import { messageFor } from "@/domain/kernel/errors";
import { getMyDonations } from "@/domain/community/queries/get-my-donations";
import { isMemberlessSuperAdmin } from "@/lib/reader-area";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { formatInstant } from "@/lib/dates";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { offerDonationAction } from "../../community-actions";

/**
 * Tặng sách — a reader offers books they no longer want.
 *
 * **Deliberately thin**, and OPS §4.4 says why: free text, a rough count,
 * "because a child does not know a publisher or an ISBN, and book data is only
 * worth recording once a volunteer has the book in hand". Asking a nine-year-old
 * for an ISBN is how an offer never gets made.
 *
 * A declined offer shows its reason, because that is the whole point of
 * requiring one — the reader reads it. A received one says so and stops there:
 * `receiveDonation` writes no book row, so there is nothing to link to yet, and
 * inventing a link to a catalogue entry that may never be typed would be the
 * screen promising something the command did not do.
 */
export const dynamic = "force-dynamic";

const STATUS: Record<
  string,
  { label: string; tone: "available" | "onloan" | "overdue" }
> = {
  pending: { label: "Đang chờ", tone: "onloan" },
  received: { label: "Đã nhận", tone: "available" },
  declined: { label: "Chưa nhận", tone: "overdue" },
};

export default async function MyDonationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refusal = refusalFrom(await searchParams);

  const base = `/tu-sach/${slug}`;

  const result = await loadPage(slug, async (tx, ctx, v) => {
    const shelf = await readShelf(tx, ctx);
    // See `src/lib/reader-area.ts`'s `isMemberlessSuperAdmin` — task 10,
    // 2026-08-10 QA remediation. `getMyDonations` compares
    // `ctx.actor.membershipId` (here, unlike `get-my-profile.ts`, with no
    // `?? ""`) to a `donor_membership_id` column, and `= null` matches no
    // row rather than raising — so this branch is for consistency with the
    // other four `/ho-so/*` pages, not to stop a crash: without it a super
    // admin sees an empty "Những lần em đã tặng" list and a donation form
    // that would refuse anything typed into it (`offerDonation` compares the
    // form's `thanh-vien` against `ctx.actor.membershipId` and refuses a
    // mismatch, `not_permitted`) — a form the app should not have offered.
    if (isMemberlessSuperAdmin(ctx)) {
      return { shelf, viewer: v, member: false as const };
    }
    return {
      shelf,
      viewer: v,
      member: true as const,
      donations: await getMyDonations(tx, ctx),
      membershipId: ctx.actor.membershipId,
    };
  });

  const { shelf, viewer } = result;
  const chrome = (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        active="toi"
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />
      <ReaderTabs shelfSlug={slug} pathname={`${base}/ho-so/tang-sach`} />
    </>
  );

  if (!result.member) {
    return (
      <>
        {chrome}
        <NotAReaderNotice />
      </>
    );
  }

  const { donations, membershipId } = result;

  return (
    <>
      {chrome}

      <main className="mx-auto max-w-2xl px-6 py-10">
        <PageHeading
          title="Tặng sách cho tủ sách"
          subtitle="Em có cuốn nào đọc xong rồi, muốn tặng lại cho các bạn khác không?"
        />

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <form action={offerDonationAction} className="mt-8 space-y-5">
          <input type="hidden" name="tu-sach" value={slug} />
          <input type="hidden" name="thanh-vien" value={membershipId ?? ""} />

          <Field label="Em muốn tặng sách gì?" required htmlFor="mo-ta">
            <Textarea
              id="mo-ta"
              name="mo-ta"
              rows={4}
              required
              placeholder="Ví dụ: khoảng mười cuốn truyện tranh, còn khá mới"
            />
          </Field>

          <Field label="Khoảng bao nhiêu cuốn?" htmlFor="so-luong">
            <Input id="so-luong" name="so-luong" inputMode="numeric" />
          </Field>

          <SubmitButton variant="primary" size="lg">
            Gửi lời tặng sách
          </SubmitButton>
        </form>

        {donations.length > 0 ? (
          <section className="mt-12">
            <SectionHeading>Những lần em đã tặng</SectionHeading>
            <ul className="mt-4 divide-y divide-hairline rounded-card border border-hairline bg-surface">
              {donations.map((d) => {
                const status = STATUS[d.status] ?? {
                  label: d.status,
                  tone: "onloan" as const,
                };
                return (
                  <li key={d.donationId} className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-[15px] leading-snug">
                        {d.description}
                      </p>
                      <Pill icon={Gift} label={status.label} tone={status.tone} />
                    </div>
                    <p className="mt-2 text-[13px] text-meta">
                      Gửi {formatInstant(d.offeredAt)}
                      {d.estimatedCount !== null
                        ? ` · khoảng ${d.estimatedCount} cuốn`
                        : ""}
                    </p>
                    {/* The reason a decline required one. */}
                    {d.status === "declined" && d.decisionNote ? (
                      <p className="mt-2 text-[14px] text-ink">{d.decisionNote}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <Link
          href={`${base}/ho-so/tong-quan`}
          className="mt-10 inline-block text-[14px] underline"
        >
          Về trang của tôi
        </Link>
      </main>
    </>
  );
}
