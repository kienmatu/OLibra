import { Head, usePage } from "@inertiajs/react";
import { Badge } from "@/components/ui/badge";
import AppLayout from "@/layouts/app-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    detail: {
        bookId: string;
        slug: string;
        title: string;
        author: string | null;
        coverUrl: string | null;
        category: string | null;
        copiesTotal: number;
        copiesAvailable: number;
        availability: keyof typeof copy.catalogue.state;
        publisher: string | null;
        publishedYear: number | null;
        pageCount: number | null;
        isbn: string | null;
        description: string | null;
        onLoan: number;
        queueLength: number;
        currentLoan: { holderName: string | null; daysRemaining: number; dueOn: string } | null;
    };
    firstContact: { name: string; phone: string } | null;
}

export default function ShelfBook() {
    const { detail, firstContact } = usePage<PageProps>().props;

    const holderLine = detail.currentLoan
        ? detail.currentLoan.holderName === null
            ? t(copy.catalogue.holderLineAnonymous, {
                  days: Math.abs(detail.currentLoan.daysRemaining),
              })
            : detail.currentLoan.daysRemaining >= 0
              ? t(copy.catalogue.holderLine, {
                    name: detail.currentLoan.holderName,
                    days: detail.currentLoan.daysRemaining,
                })
              : t(copy.catalogue.holderLineOverdue, {
                    name: detail.currentLoan.holderName,
                    days: Math.abs(detail.currentLoan.daysRemaining),
                })
        : null;

    const metadata: [string, string | null][] = [
        [copy.catalogue.author, detail.author],
        [copy.catalogue.category, detail.category],
        [copy.catalogue.publisher, detail.publisher],
        [copy.catalogue.publishedYear, detail.publishedYear?.toString() ?? null],
        [copy.catalogue.pageCount, detail.pageCount?.toString() ?? null],
        [copy.catalogue.isbn, detail.isbn],
    ];

    return (
        <AppLayout>
            <Head title={detail.title} />
            <div className="flex flex-col gap-6 md:flex-row">
                <div className="w-40 shrink-0">
                    <div className="aspect-[3/4] overflow-hidden rounded bg-muted">
                        {detail.coverUrl ? (
                            <img
                                src={detail.coverUrl}
                                alt={detail.title}
                                className="h-full w-full object-cover"
                            />
                        ) : null}
                    </div>
                </div>
                <div className="flex-1">
                    <h1 className="text-2xl font-semibold">{detail.title}</h1>
                    {detail.author ? (
                        <p className="text-muted-foreground">{detail.author}</p>
                    ) : null}

                    <div className="mt-4 space-y-2 rounded-md border p-4">
                        <Badge
                            variant={detail.availability === "available" ? "default" : "outline"}
                        >
                            {copy.catalogue.state[detail.availability]}
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                            {t(copy.catalogue.copyCountLine, {
                                available: detail.copiesAvailable,
                                onLoan: detail.onLoan,
                                total: detail.copiesTotal,
                            })}
                        </p>
                        {holderLine ? (
                            <p className="text-sm text-muted-foreground">{holderLine}</p>
                        ) : null}
                        {detail.queueLength > 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(copy.catalogue.queueLine, { count: detail.queueLength })}
                            </p>
                        ) : null}
                        <p className="text-sm text-muted-foreground">
                            {copy.readerCatalogue.borrowSoon}
                        </p>
                        {firstContact ? (
                            <p className="text-sm">
                                {t(copy.catalogue.contactBefore, { name: firstContact.name })}
                                <a
                                    href={`tel:${firstContact.phone}`}
                                    className="font-medium underline"
                                >
                                    {firstContact.phone}
                                </a>
                                {copy.catalogue.contactAfter}
                            </p>
                        ) : null}
                    </div>

                    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        {metadata
                            .filter(([, value]) => value !== null && value !== "")
                            .map(([label, value]) => (
                                <div key={label}>
                                    <dt className="text-muted-foreground">{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                    </dl>

                    {detail.description ? (
                        <section className="mt-6">
                            <h2 className="mb-2 text-lg font-medium">
                                {copy.catalogue.description}
                            </h2>
                            <p className="whitespace-pre-line text-sm">{detail.description}</p>
                        </section>
                    ) : null}
                </div>
            </div>
        </AppLayout>
    );
}
