import Link from "next/link";
import { CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PhoneLink } from "@/components/ui/phone-link";
import { SubmitButton } from "@/components/ui/submit-button";
import { FrontDoorHeader } from "@/components/shell/public-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { getSiteContact } from "@/domain/admin/queries/get-admin-overview";
import { messageFor } from "@/domain/kernel/errors";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { loadFrontDoorViewer, loadPublicPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { submitSiteFeedbackAction } from "./actions";

/**
 * OPS §3.1's `GetSiteContact` — guest-callable and Global, and the last page in
 * this application that rendered from `src/lib/fixtures.ts`.
 *
 * **`loadPublicPage`, not `loadAdminPage`.** A parish with no shelf yet is
 * exactly who this page is for: the portal's empty state links here ("liên hệ
 * với ban quản trị để mở một tủ mới"), and there is nobody to authenticate. The
 * query takes no `TenantContext` and calls no policy, which is the signature
 * carrying that — see `runPublicQuery`, whose docstring names this read as the
 * one that would have handed a stranger the whole `users` table under the old,
 * policy-based reasoning.
 *
 * What makes it safe now is a privilege rather than an argument: `olibra_public`
 * holds a **column-level** grant on the three contact fields of
 * `system_settings` and nothing else, so a version of this query that asked for
 * the lending defaults would be refused by the database with `42501`.
 * `tests/db/public-role-privileges.test.ts` sweeps every column of that table.
 *
 * **A fresh installation has nobody to name, and now offers a form instead of
 * a dead end.** Task 6 gave this page the honest sentence — the fixture
 * printed an invented person and telephone number on every deployment, and
 * the fixture-free replacement said only that the contact had not been filled
 * in. That was still a dead end: a parish reaching this page from `/tu-sach`'s
 * own empty state ("liên hệ với ban quản trị để mở một tủ mới") had no way to
 * actually do that. Task 17 (2026-08-10 QA remediation) is what wires the
 * other half — `submitSiteFeedbackAction` posts to `feedback` with
 * `bookshelf_id` null (`20260808_01_feedback_rls.sql` is why that column
 * accepts it), which lands in `/quan-tri/gop-y`, the administration surface's
 * own inbox. An administrator who *has* filled in the contact block still
 * sees the ordinary card below — the form is only for the gap it exists to
 * close.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Liên hệ — OLibra" };

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  const refusal = refusalFrom(search);
  const sent = param(search, "da-gui") === "1";

  const contact = await loadPublicPage((tx) => getSiteContact(tx));
  const hasContact = Boolean(contact.name || contact.phone);
  // Task 6 (2026-08-10 QA remediation), same reason as the portal directory:
  // the header needs to know who is asking, `getSiteContact` above does not,
  // and `loadFrontDoorViewer` is the seam that answers the first without
  // widening the second.
  const viewer = await loadFrontDoorViewer();

  return (
    <>
      <FrontDoorHeader
        viewerName={viewer?.name ?? null}
        isSuperAdmin={viewer?.isSuperAdmin ?? false}
        shelves={viewer?.shelves ?? []}
      />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <PageHeading
          title="Liên hệ ban quản trị"
          subtitle="Muốn mở một tủ sách cho giáo xứ mình, hoặc cần giúp đỡ về hệ thống?"
        />

        {hasContact ? (
          <div className="mt-8 rounded-card border border-hairline bg-surface p-6">
            {contact.name ? (
              <p className="text-[18px] font-semibold">{contact.name}</p>
            ) : null}
            {contact.phone ? (
              <p className="mt-2 text-[16px]">
                <PhoneLink phone={contact.phone} />
              </p>
            ) : null}
            {contact.hours ? (
              <p className="mt-2 text-[15px] text-meta">{contact.hours}</p>
            ) : null}
            <p className="mt-4 flex items-start gap-2 text-[15px] text-meta">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0" />
              Hệ thống không gửi email. Gọi vào số trên là nhanh nhất.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-8 text-[15px] text-meta">
              Ban quản trị chưa điền số điện thoại liên hệ trực tiếp. Gửi lời nhắn
              dưới đây, ban quản trị sẽ đọc được trong hộp góp ý và liên lạc lại
              theo số điện thoại bạn để lại.
            </p>

            {sent ? (
              <p className="mt-6 flex items-start gap-2 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px]">
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-available"
                  aria-hidden
                />
                Đã gửi rồi, cảm ơn anh chị. Ban quản trị sẽ liên lạc lại sớm nhất có
                thể.
              </p>
            ) : null}

            {refusal ? (
              <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
                {messageFor(refusal)}
              </p>
            ) : null}

            <form action={submitSiteFeedbackAction} className="mt-6 space-y-5">
              <Field label="Tên của anh/chị" required htmlFor="ten">
                <Input id="ten" name="ten" required />
              </Field>

              <Field label="Số điện thoại" required htmlFor="dien-thoai">
                <Input
                  id="dien-thoai"
                  name="dien-thoai"
                  type="tel"
                  pattern={PHONE_PATTERN}
                  required
                />
              </Field>

              <Field label="Chủ đề" htmlFor="chu-de">
                <Input id="chu-de" name="chu-de" placeholder="vd: Mở tủ sách mới" />
              </Field>

              <Field label="Nội dung" required htmlFor="noi-dung">
                <Textarea id="noi-dung" name="noi-dung" rows={6} required />
              </Field>

              <p className="flex items-start gap-2 text-[13px] text-meta">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày, để tránh tin rác.
              </p>

              <SubmitButton variant="primary" size="lg">
                Gửi liên hệ
              </SubmitButton>
            </form>
          </>
        )}

        <p className="mt-8 text-[15px]">
          <Link href="/tu-sach" className="underline">
            Xem danh sách tủ sách
          </Link>
        </p>
      </main>

      <SiteFooter contact={contact} />
    </>
  );
}
