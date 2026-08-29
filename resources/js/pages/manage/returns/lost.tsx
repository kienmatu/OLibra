import { Head, Link, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    filters: { q: string };
    chosen: {
        loanId: string;
        copyId: string;
        copyCode: string;
        title: string;
        borrowerName: string;
        dueOn: string;
    } | null;
}

export default function ReturnsLost() {
    const { shelf, filters, chosen, errors } = usePage<PageProps>().props;
    const form = useForm({ note: "" });
    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        // ReportCopyLost's second entry point — the 1a route, unchanged.
        form.post(
            route("shelves.manage.copies.report-lost", {
                shelf: shelf.slug,
                bookCopy: chosen.copyId,
            }),
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.returns.lostTitle} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.returns.lostTitle}</h1>

            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            {chosen ? (
                <form onSubmit={submit} className="max-w-md space-y-4">
                    <div className="rounded-md border px-4 py-3">
                        <p className="font-serif text-base">{chosen.title}</p>
                        <p className="text-sm text-muted-foreground">
                            {[chosen.copyCode, chosen.borrowerName].join(" · ")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t(copy.circulation.returns.dueLine, {
                                date: formatDate(chosen.dueOn),
                            })}
                        </p>
                    </div>

                    <p className="text-sm">
                        {t(copy.circulation.returns.lostExplain, { code: chosen.copyCode })}
                    </p>

                    <div className="space-y-1.5">
                        <Label htmlFor="return-lost-note">
                            {copy.circulation.returns.lostNoteLabel}
                        </Label>
                        <Input
                            id="return-lost-note"
                            value={form.data.note}
                            onChange={(e) => form.setData("note", e.target.value)}
                        />
                    </div>

                    <Button
                        type="submit"
                        variant="destructive"
                        className="h-14 px-8 text-base"
                        disabled={form.processing}
                    >
                        {copy.circulation.returns.lostConfirmButton}
                    </Button>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {copy.circulation.returns.chooseFirst}
                </p>
            )}

            <Link
                href={route("shelves.manage.returns", {
                    shelf: shelf.slug,
                    q: filters.q || undefined,
                })}
                className="mt-6 inline-block text-sm underline"
            >
                {copy.circulation.returns.backToReturns}
            </Link>
        </ManageLayout>
    );
}
