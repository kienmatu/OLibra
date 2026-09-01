import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

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
 * the form instead of a card reading "Sáng thứ bảy" and nothing else. Hours
 * still render inside the card whenever the card appears.
 *
 * **THE CARD OR THE FORM, NEVER BOTH (phase 3c-ii Task 3).** What stood
 * here until this commit is retracted rather than deleted:
 *
 * > **NO FORM.** BR §16.1 lists one; D2 defers it to 3c so it lands with
 * > the inbox that reads it. There is no feedback write path in this
 * > application and no POST on this route — a box that swallows a
 * > stranger's message promises a reply nobody can send.
 *
 * Both of its conditions are now met: `SubmitFeedback` is the write path
 * and `/admin/feedback` is the inbox. The form sits in the SAME ternary
 * branch the sentence it replaces sat in, which is the reference's own
 * shape (`lien-he/page.tsx:83`) and deliberate: an installation that has
 * published a name or a number is offering a human to ring, which beats a
 * message that has to be waited for. The form is the empty state, for the
 * gap it exists to close.
 *
 * **NOTHING ON THIS SCREEN KNOWS ABOUT A SHELF**, and that is load-bearing
 * rather than incidental. There is no `shelf` read off the page props and
 * no `{shelf}` in the posted route — the sender this page is for belongs to
 * no parish's shelf, and the message is filed against none
 * (`ContactController::store` passes `siteWide: true`). `shelves/feedback.tsx`
 * is the shelf-scoped sibling and opens with `if (!shelf) return null;`,
 * which is the difference between the two pages in one line.
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

interface PageProps extends SharedData {
    contact: ContactBlock;
    /**
     * App\Actions\Community\SubmitFeedback::DAILY_LIMIT, sent as a number so
     * the sentence under the form and the rule the command enforces cannot
     * drift. The reference hard-codes "3" in its own markup.
     */
    dailyLimit: number;
}

export default function Contact() {
    const { contact, dailyLimit, errors, flash } = usePage<PageProps>().props;
    const hasContact = Boolean(contact.name || contact.phone);
    const form = useForm({ guest_name: "", guest_contact: "", subject: "", body: "" });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // No shelf parameter, because the route has no segment for one.
        form.post(route("contact.feedback"), { onSuccess: () => form.reset() });
    };

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
                <>
                    <p className="mt-8 text-muted-foreground">{copy.contact.noContact}</p>

                    {flash.success ? (
                        <p
                            role="status"
                            className="mt-6 max-w-sm rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                        >
                            {flash.success}
                        </p>
                    ) : null}

                    {/*
                     * The rule banner, outside the form, the shelf Góp ý
                     * page's pattern: bootstrap/app.php renders every
                     * RuleViolated in the application as
                     * back()->withErrors(['rule' => …]), and SubmitFeedback
                     * has three codes a real sender meets here —
                     * `rate_limited` (the fourth message from one number
                     * inside 24 hours), `phone_invalid` and
                     * `feedback_fields_required`.
                     */}
                    {errors.rule ? (
                        <p
                            role="alert"
                            className="mt-6 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                        >
                            {errors.rule}
                        </p>
                    ) : null}

                    {/* SINGLE COLUMN, labels above inputs — AGENTS.md rule 6. */}
                    <form className="mt-6 max-w-sm space-y-5" onSubmit={submit}>
                        <div>
                            {/* The WORD *Bắt buộc*, never an asterisk
                                (AGENTS.md rule 6), on the Label + raw
                                control + InputError trio this repo settled
                                on at Task 7. */}
                            <Label htmlFor="guest_name">
                                {copy.contact.nameLabel}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {copy.contact.required}
                                </span>
                            </Label>
                            <Input
                                id="guest_name"
                                name="guest_name"
                                required
                                value={form.data.guest_name}
                                onChange={(event) => form.setData("guest_name", event.target.value)}
                            />
                            <InputError message={form.errors.guest_name} />
                        </div>

                        <div>
                            <Label htmlFor="guest_contact">
                                {copy.contact.phoneLabel}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {copy.contact.required}
                                </span>
                            </Label>
                            {/* type="tel" raises the digits keyboard on a
                                phone. NO pattern attribute, deliberately:
                                the number's shape is Phone::assert()'s
                                ruling inside SubmitFeedback, and a second
                                spelling of that rule in the markup is a
                                second place for it to drift — a `+84…`
                                number the server accepts would be refused by
                                the browser with no sentence to explain it.
                                The reference DOES set one here
                                (PHONE_PATTERN); this port declines it for
                                the same reason the shelf form does. */}
                            <Input
                                id="guest_contact"
                                name="guest_contact"
                                type="tel"
                                required
                                value={form.data.guest_contact}
                                onChange={(event) =>
                                    form.setData("guest_contact", event.target.value)
                                }
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                                {copy.contact.phoneNote}
                            </p>
                            <InputError message={form.errors.guest_contact} />
                        </div>

                        <div>
                            {/* NO *Bắt buộc* beside this one, and its
                                absence is the field's meaning — said in
                                words rather than by silence, because three
                                labels carrying a marker and a fourth
                                carrying nothing reads as an oversight. */}
                            <Label htmlFor="subject">
                                {copy.contact.subjectLabel}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {copy.contact.subjectOptional}
                                </span>
                            </Label>
                            <Input
                                id="subject"
                                name="subject"
                                placeholder={copy.contact.subjectPlaceholder}
                                value={form.data.subject}
                                onChange={(event) => form.setData("subject", event.target.value)}
                            />
                            <InputError message={form.errors.subject} />
                        </div>

                        <div>
                            <Label htmlFor="body">
                                {copy.contact.bodyLabel}
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {copy.contact.required}
                                </span>
                            </Label>
                            <textarea
                                id="body"
                                name="body"
                                rows={6}
                                required
                                className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                                value={form.data.body}
                                onChange={(event) => form.setData("body", event.target.value)}
                            />
                            <InputError message={form.errors.body} />
                        </div>

                        {/* OPS §8's limit, stated in the form because that is
                            where the shipped copy states it — with the number
                            filled from the server's own constant rather than
                            typed into the sentence. */}
                        <p className="text-xs text-muted-foreground">
                            {t(copy.contact.limitNote, { count: dailyLimit })}
                        </p>

                        {/* THE one primary action on this screen (AGENTS.md
                            rule 3), so it keeps the default solid variant;
                            h-14 is rule 4's 56px for a primary button. */}
                        <Button type="submit" className="h-14 w-full" disabled={form.processing}>
                            {copy.contact.submit}
                        </Button>
                    </form>
                </>
            )}
        </AppLayout>
    );
}
