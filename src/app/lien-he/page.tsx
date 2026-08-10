import Link from "next/link";
import { Mail } from "lucide-react";
import { PageHeading } from "@/components/ui/card";
import { PhoneLink } from "@/components/ui/phone-link";
import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";
import { getSiteContact } from "@/domain/admin/queries/get-admin-overview";
import { loadFrontDoorViewer, loadPublicPage } from "@/lib/page-data";

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
 * **A fresh installation has nobody to name, and says so.** The fixture printed
 * an invented person and telephone number on every deployment; the honest empty
 * state is that the contact has not been filled in, which an administrator fixes
 * on `/quan-tri/cai-dat`.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Liên hệ — OLibra" };

export default async function ContactPage() {
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
          <p className="mt-8 rounded-card border border-hairline bg-surface p-6 text-[16px] text-meta">
            Ban quản trị chưa điền thông tin liên hệ.
          </p>
        )}

        <p className="mt-8 text-[15px]">
          <Link href="/tu-sach" className="underline">
            Xem danh sách tủ sách
          </Link>
        </p>
      </main>

      <FrontDoorFooter />
    </>
  );
}
