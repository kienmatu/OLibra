import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * BR §16.2's Tặng sách — a reader offers books they no longer want.
 *
 * DELIBERATELY THIN, and OPS §4.4's `OfferDonation` says why, opened and
 * quoted verbatim: "a child does not know a publisher or an ISBN, and book
 * data is only worth recording once a volunteer has the book in hand, which
 * is the manager's job at approval time, not the reader's here". Asking a
 * nine-year-old for an ISBN is how an offer never gets made.
 *
 * NO PHOTO FIELD. The reference's optional photo is not ported — plan
 * divergence 11 — and App\Actions\Community\OfferDonation's docblock
 * (opened) gives the ground: a parameter no caller can supply is the
 * reachable-from-nowhere shape, so photo_url stays null until an uploader
 * exists to write it.
 *
 * WHAT THIS FORM DOES NOT DECIDE. The description's emptiness is the
 * server's ruling twice over — OfferDonationRequest's `required` for the
 * round trip a reader takes, and OfferDonation::execute's own trim for the
 * direct call. `required` below only saves the trip.
 */
interface PageProps extends SharedData {
    /**
     * False for a caller with no active membership on this shelf. That is a
     * live state rather than a defensive one: a super admin passes
     * `role:reader` on a shelf they are not a member of (Gate::before), and
     * a form they submitted would be refused `not_permitted` — so they are
     * told, rather than handed a box. App\Http\Controllers\Reader\
     * DonationController::create is where the value is decided.
     */
    isMember: boolean;
}

export default function Donate() {
    const { isMember, errors, flash, shelf } = usePage<PageProps>().props;
    const form = useForm({ description: "", estimated_count: "" });

    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // The house transform, the shape manage/books/create.tsx already
        // uses: a blank number field is a reader who does not know how many
        // books are in the bag, and OfferDonationRequest holds
        // estimated_count `nullable, integer` — so it has to arrive as null
        // and not as "".
        form.transform((data) => ({
            ...data,
            estimated_count: data.estimated_count === "" ? null : Number(data.estimated_count),
        }));
        form.post(route("shelves.donate.store", { shelf: shelf.slug }), {
            onSuccess: () => form.reset(),
        });
    };

    return (
        <AppLayout>
            <Head title={copy.donations.formTitle} />

            <h1 className="mb-1 text-2xl font-semibold">{copy.donations.formTitle}</h1>
            <p className="mb-6 text-sm text-muted-foreground">{copy.donations.formSubtitle}</p>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 max-w-sm rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/*
             * The rule banner, outside the form. Every RuleViolated in this
             * application arrives the same way — bootstrap/app.php renders
             * it as back()->withErrors(['rule' => …]) — and OfferDonation
             * has a code that reaches a real caller here: a memberless
             * super admin who submits meets `not_permitted`, which Task
             * 15's OfferDonationTest posts over HTTP.
             */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 max-w-sm rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {isMember ? (
                /* SINGLE COLUMN, labels above inputs — AGENTS.md rule 6. */
                <form className="max-w-sm space-y-5" onSubmit={submit}>
                    <div>
                        {/*
                         * The WORD *Bắt buộc*, never an asterisk (AGENTS.md
                         * rule 6). The plan asked for `Field` + `Textarea`.
                         * Measured at this commit, AFTER this file was
                         * written: `grep -rlE "\bField\b|\bTextarea\b"`
                         * over resources/js returns lib/copy.ts,
                         * pages/shelves/book.tsx and THIS FILE, and every
                         * match in all three is prose inside a comment —
                         * no import, no declaration, no JSX tag. So this is
                         * the house trio Task 7 settled on and book.tsx's
                         * comment form already renders: Label + a raw
                         * control + InputError, down to the className.
                         */}
                        <Label htmlFor="description">
                            {copy.donations.descriptionLabel}
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {copy.donations.required}
                            </span>
                        </Label>
                        <textarea
                            id="description"
                            name="description"
                            rows={4}
                            required
                            className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm"
                            placeholder={copy.donations.descriptionPlaceholder}
                            value={form.data.description}
                            onChange={(event) => form.setData("description", event.target.value)}
                        />
                        <InputError message={form.errors.description} />
                    </div>

                    <div>
                        {/*
                         * NO *Bắt buộc* beside this one, and its absence is
                         * the field's meaning: a reader who does not know
                         * how many books are in the bag leaves it blank and
                         * "not recorded" survives to the row as null rather
                         * than becoming a zero somebody later reads as an
                         * empty bag. inputMode="numeric" is the reference's
                         * own attribute on this field, kept — it raises the
                         * digits keyboard on a phone without the spinner a
                         * bare type="number" adds.
                         */}
                        <Label htmlFor="estimated_count">{copy.donations.countLabel}</Label>
                        <Input
                            id="estimated_count"
                            name="estimated_count"
                            inputMode="numeric"
                            value={form.data.estimated_count}
                            onChange={(event) =>
                                form.setData("estimated_count", event.target.value)
                            }
                        />
                        <InputError message={form.errors.estimated_count} />
                    </div>

                    {/*
                     * THE one primary action on this screen (AGENTS.md rule
                     * 3), so it keeps the default solid variant; h-14 is
                     * rule 4's 56px for a primary button.
                     */}
                    <Button type="submit" className="h-14 w-full" disabled={form.processing}>
                        {copy.donations.submit}
                    </Button>
                </form>
            ) : (
                <p className="max-w-sm text-sm text-muted-foreground">
                    {copy.donations.onlyReaders}
                </p>
            )}

            <Link
                href={route("shelves.profile.donations", { shelf: shelf.slug })}
                className="mt-8 inline-block text-sm underline"
            >
                {copy.donations.toList}
            </Link>
        </AppLayout>
    );
}
