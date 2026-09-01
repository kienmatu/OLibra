import { Head } from "@inertiajs/react";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

/**
 * BR §16.1's public contact page (spec D2).
 *
 * **THREE VALUES, AND A BLANK ONE RENDERS NOTHING AT ALL.** Not a dash, not
 * a greyed placeholder, not an invented default — the reference shipped a
 * fixture that printed a made-up person and telephone number on every
 * deployment, and the correction was to omit. The server has already turned
 * `''` and whitespace into `null` (ContactController), so each line here is
 * a plain null check rather than three different notions of empty.
 *
 * **THE GATE IS `name || phone`, AND `hours` DOES NOT COUNT.** The
 * reference's own condition (`lien-he/page.tsx:62`), and it is not an
 * oversight: contact hours with nobody to ask for and no number to call is
 * not a way to reach a human, so an installation carrying only that shows
 * the honest sentence instead of a card reading "Sáng thứ bảy" and nothing
 * else. Hours still render inside the card whenever the card appears.
 *
 * **NO FORM.** BR §16.1 lists one; D2 defers it to 3c so it lands with the
 * inbox that reads it. There is no feedback write path in this application
 * and no POST on this route — a box that swallows a stranger's message
 * promises a reply nobody can send.
 *
 * The phone is a `tel:` link, the treatment `shelves/book.tsx:181` and
 * `manage/overdue.tsx:85` already use, and what /admin/settings promises
 * beside the field it is typed into ("bấm gọi được").
 */
interface ContactBlock {
    /** Each is `null` when unset — blank and whitespace are normalised server-side. */
    name: string | null;
    phone: string | null;
    hours: string | null;
}

export default function Contact({ contact }: { contact: ContactBlock }) {
    const hasContact = Boolean(contact.name || contact.phone);

    return (
        <AppLayout>
            <Head title={copy.contact.title} />
            <h1 className="text-2xl font-semibold">{copy.contact.title}</h1>
            <p className="mt-2 text-muted-foreground">{copy.contact.lead}</p>

            {hasContact ? (
                <div className="mt-8 rounded-lg border p-6">
                    {contact.name ? <p className="text-lg font-semibold">{contact.name}</p> : null}
                    {contact.phone ? (
                        <p className="mt-2">
                            <a href={`tel:${contact.phone}`} className="font-medium underline">
                                {contact.phone}
                            </a>
                        </p>
                    ) : null}
                    {contact.hours ? (
                        <p className="mt-2 text-sm text-muted-foreground">{contact.hours}</p>
                    ) : null}
                    {contact.phone ? (
                        <p className="mt-4 text-sm text-muted-foreground">
                            {copy.contact.callNote}
                        </p>
                    ) : null}
                </div>
            ) : (
                <p className="mt-8 text-muted-foreground">{copy.contact.noContact}</p>
            )}
        </AppLayout>
    );
}
