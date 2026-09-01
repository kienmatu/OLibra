import { Head, Link, useForm, usePage } from "@inertiajs/react";
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
 * BR §16.1's Góp ý — a message to the people who keep the shelf.
 *
 * THE PAGE A GUEST CAN USE. There is no `isMember` branch here and no
 * signed-in guard anywhere in the file, unlike shelves/donate.tsx beside
 * it: routes/web.php keeps both feedback routes outside the shelf's
 * ['auth', 'role:reader'] group deliberately, because a guest may leave
 * feedback for a shelf they are not a member of. A "chỉ bạn đọc…" branch
 * on this screen would be a fiction the server does not enforce.
 *
 * THE SHELF IS NOT NAMED IN THE FORM, and that is the reference's own
 * sentence about its own version of this page. There is no hidden field
 * and no shelf key in the posted body — the shelf is the {shelf} segment
 * of the URI, which the tenant middleware binds and
 * App\Actions\Community\SubmitFeedback reads off TenantContext. What that
 * buys is stated from the other side in
 * App\Http\Requests\Community\SubmitFeedbackRequest: a body that COULD
 * name a shelf would let any visitor file a message into any parish's
 * inbox from any address.
 *
 * THE NAME FIELD IS ASKED OF A SIGNED-IN READER TOO, and it is not
 * prefilled from their account. Spec D1's incident is exactly that
 * conflation: a signed-in reader who typed "Chị Hạnh" was shown to the
 * administrator as "Quản trị viên" — their account's label — and the
 * administrator rang the wrong person. The typed name and the account are
 * two separate facts, and this form collects the first while the server
 * attaches the second.
 *
 * THE LIMIT SENTENCE READS ITS NUMBER FROM THE SERVER. See `dailyLimit`
 * below.
 */
interface PageProps extends SharedData {
    /**
     * App\Actions\Community\SubmitFeedback::DAILY_LIMIT, sent as a number
     * so the sentence under the form and the rule the command enforces
     * cannot drift. The reference hard-codes "3" in its own markup;
     * App\Http\Controllers\Reader\FeedbackController::create is where this
     * value is decided.
     */
    dailyLimit: number;
}

export default function Feedback() {
    const { dailyLimit, errors, flash, shelf } = usePage<PageProps>().props;
    const form = useForm({ guest_name: "", guest_contact: "", subject: "", body: "" });

    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // No transform: all four fields are strings the server wants as
        // strings, and the optional subject arrives as "" which
        // SubmitFeedback trims and stores as the empty string the NOT NULL
        // column takes.
        form.post(route("shelves.feedback.store", { shelf: shelf.slug }), {
            onSuccess: () => form.reset(),
        });
    };

    return (
        <AppLayout>
            <Head title={copy.feedback.title} />

            <h1 className="mb-1 text-2xl font-semibold">{copy.feedback.title}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{copy.feedback.subtitle}</p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 max-w-sm rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/*
             * The rule banner, outside the form, on donate.tsx's pattern:
             * bootstrap/app.php renders every RuleViolated in the
             * application as back()->withErrors(['rule' => …]), and
             * SubmitFeedback has three codes a real sender meets here —
             * `rate_limited` (the fourth message from one number inside 24
             * hours), `phone_invalid` and `feedback_fields_required`.
             */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {/* SINGLE COLUMN, labels above inputs — AGENTS.md rule 6. */}
            <form className="max-w-sm space-y-5" onSubmit={submit}>
                <div>
                    {/* The WORD *Bắt buộc*, never an asterisk (AGENTS.md
                        rule 6), on the Label + raw control + InputError trio
                        this repo settled on at Task 7. */}
                    <Label htmlFor="guest_name">
                        {copy.feedback.nameLabel}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {copy.feedback.required}
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
                        {copy.feedback.phoneLabel}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {copy.feedback.required}
                        </span>
                    </Label>
                    {/* type="tel" raises the digits keyboard on a phone.
                        NO pattern attribute, deliberately: the number's
                        shape is Phone::assert()'s ruling inside
                        SubmitFeedback, and a second spelling of that rule
                        in the markup is a second place for it to drift —
                        a `+84…` number the server accepts would be refused
                        by the browser with no sentence to explain it. */}
                    <Input
                        id="guest_contact"
                        name="guest_contact"
                        type="tel"
                        required
                        value={form.data.guest_contact}
                        onChange={(event) => form.setData("guest_contact", event.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{copy.feedback.phoneNote}</p>
                    <InputError message={form.errors.guest_contact} />
                </div>

                <div>
                    {/* NO *Bắt buộc* beside this one, and its absence is
                        the field's meaning — the reference marks the other
                        three required and leaves the subject bare. Said in
                        words rather than by silence, because three labels
                        carrying a marker and a fourth carrying nothing
                        reads as an oversight. */}
                    <Label htmlFor="subject">
                        {copy.feedback.subjectLabel}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {copy.feedback.subjectOptional}
                        </span>
                    </Label>
                    <Input
                        id="subject"
                        name="subject"
                        value={form.data.subject}
                        onChange={(event) => form.setData("subject", event.target.value)}
                    />
                    <InputError message={form.errors.subject} />
                </div>

                <div>
                    <Label htmlFor="body">
                        {copy.feedback.bodyLabel}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {copy.feedback.required}
                        </span>
                    </Label>
                    <textarea
                        id="body"
                        name="body"
                        rows={6}
                        required
                        className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        placeholder={copy.feedback.bodyPlaceholder}
                        value={form.data.body}
                        onChange={(event) => form.setData("body", event.target.value)}
                    />
                    <InputError message={form.errors.body} />
                </div>

                {/* OPS §8's limit, stated in the form because that is where
                    the shipped copy stated it — and with the number filled
                    from the server's own constant rather than typed into
                    the sentence. */}
                <p className="text-xs text-muted-foreground">
                    {t(copy.feedback.limitNote, { count: dailyLimit })}
                </p>

                {/* THE one primary action on this screen (AGENTS.md rule
                    3), so it keeps the default solid variant; h-14 is rule
                    4's 56px for a primary button. */}
                <Button type="submit" className="h-14 w-full" disabled={form.processing}>
                    {copy.feedback.submit}
                </Button>
            </form>

            <Link
                href={route("shelves.show", { shelf: shelf.slug })}
                className="mt-8 inline-block text-sm underline"
            >
                {copy.feedback.backToShelf}
            </Link>
        </AppLayout>
    );
}
