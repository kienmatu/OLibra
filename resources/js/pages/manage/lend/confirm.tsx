import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import { formatDate } from "@/lib/dates";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    book: { slug: string; title: string; author: string | null; coverUrl: string | null } | null;
    chosen: { copyId: string; copyCode: string } | null;
    reader: { membershipId: string; fullName: string; activeLoans: number } | null;
    lentOn: string;
    dueOn: string;
    blocking: string | null;
}

export default function QuickLendConfirm() {
    const { shelf, book, chosen, reader, lentOn, dueOn, blocking, errors } =
        usePage<PageProps>().props;
    const form = useForm({
        copy_id: chosen?.copyId ?? "",
        membership_id: reader?.membershipId ?? "",
    });
    if (!shelf) return null;

    const blockingText =
        blocking === null
            ? null
            : blocking === "book_missing"
              ? copy.circulation.lend.bookMissing
              : blocking === "reader_missing"
                ? copy.circulation.lend.readerMissing
                : (copy.circulation.rules[blocking as keyof typeof copy.circulation.rules] ??
                  blocking);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.lend.store", { shelf: shelf.slug }));
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.title3} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.lend.title3}</h1>

            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}
            {blockingText ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {blockingText}
                </p>
            ) : null}

            <dl className="mb-6 max-w-md divide-y rounded-md border">
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">
                        {copy.circulation.lend.bookLabel}
                    </dt>
                    <dd className="mt-1 font-serif text-base">{book?.title ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">
                        {copy.circulation.lend.copyLabel}
                    </dt>
                    <dd className="mt-1">{chosen?.copyCode ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">
                        {copy.circulation.lend.readerLabel}
                    </dt>
                    <dd className="mt-1">{reader?.fullName ?? "—"}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">
                        {copy.circulation.lend.lentOnLabel}
                    </dt>
                    <dd className="mt-1">{formatDate(lentOn)}</dd>
                </div>
                <div className="px-4 py-3">
                    <dt className="text-sm text-muted-foreground">
                        {copy.circulation.lend.dueOnLabel}
                    </dt>
                    <dd className="mt-1 font-medium">{formatDate(dueOn)}</dd>
                </div>
            </dl>

            <form onSubmit={submit}>
                <Button
                    type="submit"
                    className="h-14 px-8 text-base"
                    disabled={blocking !== null || form.processing}
                >
                    {copy.circulation.lend.confirmButton}
                </Button>
            </form>
        </ManageLayout>
    );
}
