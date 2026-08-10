import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { ShelfHeader } from "@/components/shell/public-header";
import { messageFor } from "@/domain/kernel/errors";
import { readShelf } from "@/lib/shelf";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { submitFeedbackAction } from "../community-actions";

/**
 * Góp ý — a message to the people who keep the shelf.
 *
 * **The shelf is not named in the form**, and that is the safer default this
 * slice chose: `submitFeedback` files against the shelf in scope unless a
 * caller passes an explicit `null`. Under OPS §4.4's literal reading a form
 * that forgot the field would have filed a parish's message into the
 * administrator's site-wide inbox, silently and in the wrong direction.
 *
 * **Nothing is repopulated after a refusal.** The fields are a person's name,
 * phone number and message; a query string carrying them goes into browser
 * history, proxy logs and the address bar of a shared parish phone. Same call
 * U3 made for the on-behalf registration form, and the cost is the same — a
 * short message retyped.
 */
export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refusal = refusalFrom(search);
  const sent = param(search, "da-gui") === "1";

  const { shelf, viewer } = await loadPage(slug, async (tx, ctx, v) => ({
    shelf: await readShelf(tx, ctx),
    viewer: v,
  }));

  const base = `/tu-sach/${slug}`;

  return (
    <>
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={slug}
        viewerName={viewer.name}
        unreadNotifications={viewer.unreadNotifications}
      />

      <main className="mx-auto max-w-2xl px-6 py-10">
        <PageHeading
          title="Gửi góp ý"
          subtitle="Có điều gì em muốn nhắn cho các cô chú giữ tủ sách không?"
        />

        {sent ? (
          <p className="mt-6 flex items-start gap-2 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px]">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-available"
              aria-hidden
            />
            Đã gửi rồi, cảm ơn em nhé.
          </p>
        ) : null}

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <form action={submitFeedbackAction} className="mt-8 space-y-5">
          <input type="hidden" name="tu-sach" value={slug} />

          <Field label="Tên của em" required htmlFor="ten">
            <Input id="ten" name="ten" required />
          </Field>

          <Field label="Số điện thoại" required htmlFor="dien-thoai">
            <Input id="dien-thoai" name="dien-thoai" type="tel" required />
          </Field>

          <Field label="Chủ đề" htmlFor="chu-de">
            <Input id="chu-de" name="chu-de" />
          </Field>

          <Field label="Nội dung" required htmlFor="noi-dung">
            <Textarea id="noi-dung" name="noi-dung" rows={6} required />
          </Field>

          <p className="flex items-start gap-2 text-[13px] text-meta">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            {/* OPS §8's limit, stated in the form because that is where the
                shipped copy stated it. The command enforces it against a hash
                of the number, never the number itself. */}
            Mỗi số điện thoại gửi tối đa 3 góp ý mỗi ngày, để tránh tin rác.
          </p>

          <SubmitButton variant="primary" size="lg">
            Gửi góp ý
          </SubmitButton>
        </form>

        <Link href={base} className="mt-8 inline-block text-[14px] underline">
          Về trang tủ sách
        </Link>
      </main>
    </>
  );
}
