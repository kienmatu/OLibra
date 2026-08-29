import { Head, Link, router, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatDate, formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

interface LoanRow {
    loanId: string;
    copyCode: string;
    title: string;
    borrowerName: string;
    dueOn: string;
    isOverdue: boolean;
    daysRemaining: number;
}

/** One row of the chosen loan's title's PENDING queue — the same shape
 * BorrowRequestQueueQuery::run() reports, narrowed to the three fields
 * this panel shows (app/Http/Controllers/Manage/ReturnController.php). */
interface WaitingReader {
    requestId: string;
    readerName: string;
    requestedAt: string;
}

interface PageProps extends SharedData {
    filters: { q: string };
    loans: LoanRow[];
    chosenLoanId: string | null;
    /** null when no loan is chosen; else the chosen loan's title's
     * pending requests in queue order — possibly empty. */
    waiting: WaitingReader[] | null;
}

const CONDITIONS = [
    "perfect",
    "slightly_worn",
    "worn",
    "torn",
    "missing_pages",
    "written_on",
] as const;

export default function ReturnsIndex() {
    const { shelf, filters, loans, chosenLoanId, waiting, errors, flash } =
        usePage<PageProps>().props;
    const [q, setQ] = useState(filters.q);
    // BR §16.3: Nguyên vẹn preselected — the common case is two taps.
    // hold_for_request_id defaults to "" — not holding is the default
    // (OPS §5: "the manager decides, because the next reader may not be
    // standing there") — and ReceiveReturnRequest::prepareForValidation()
    // is what turns that empty string back into the absence of a choice.
    const form = useForm({ condition: "perfect", note: "", hold_for_request_id: "" });
    if (!shelf) return null;

    const chosen = loans.find((l) => l.loanId === chosenLoanId) ?? null;
    const worse = form.data.condition !== "perfect";

    const submitSearch = (event: FormEvent) => {
        event.preventDefault();
        router.get(
            route("shelves.manage.returns", { shelf: shelf.slug, q: q || undefined }),
            {},
            { preserveState: true },
        );
    };

    const submitReturn = (event: FormEvent) => {
        event.preventDefault();
        if (!chosen) return;
        form.post(
            route("shelves.manage.returns.store", { shelf: shelf.slug, loan: chosen.loanId }),
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.circulation.returns.title} />
            <h1 className="mb-4 text-2xl font-semibold">{copy.circulation.returns.title}</h1>

            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            <form onSubmit={submitSearch} className="mb-4 flex gap-2">
                <Input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={copy.circulation.returns.searchPlaceholder}
                    className="h-12 max-w-md text-base"
                />
                <Button type="submit" className="h-12">
                    {copy.circulation.returns.search}
                </Button>
            </form>

            <ul className="mb-6 divide-y border-y">
                {loans.map((loan) => (
                    <li key={loan.loanId}>
                        <Link
                            href={route("shelves.manage.returns", {
                                shelf: shelf.slug,
                                q: filters.q || undefined,
                                loan: loan.loanId,
                            })}
                            preserveState
                            className={`flex items-center justify-between gap-3 py-3 ${loan.loanId === chosenLoanId ? "bg-muted/60" : "hover:bg-muted/40"}`}
                        >
                            <div className="min-w-0">
                                <p className="truncate font-serif text-base">{loan.title}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {[loan.copyCode, loan.borrowerName].join(" · ")}
                                </p>
                            </div>
                            <span className="shrink-0 text-sm text-muted-foreground">
                                {loan.isOverdue
                                    ? t(copy.circulation.returns.overdueLine, {
                                          days: -loan.daysRemaining,
                                      })
                                    : t(copy.circulation.returns.dueLine, {
                                          date: formatDate(loan.dueOn),
                                      })}
                            </span>
                        </Link>
                    </li>
                ))}
                {loans.length === 0 && filters.q !== "" ? (
                    <li className="py-3 text-sm text-muted-foreground">
                        {copy.circulation.returns.noneFound}
                    </li>
                ) : null}
            </ul>

            {chosen ? (
                <form onSubmit={submitReturn} className="max-w-md space-y-4">
                    <fieldset>
                        <legend className="mb-2 text-sm font-medium">
                            {copy.circulation.returns.conditionLegend}
                        </legend>
                        <div className="flex flex-wrap gap-2">
                            {CONDITIONS.map((value) => (
                                <Button
                                    key={value}
                                    type="button"
                                    variant={form.data.condition === value ? "default" : "outline"}
                                    className="h-11"
                                    onClick={() => form.setData("condition", value)}
                                >
                                    {copy.catalogue.condition[value]}
                                </Button>
                            ))}
                        </div>
                        {errors.condition ? (
                            <p className="mt-1 text-sm text-destructive">{errors.condition}</p>
                        ) : null}
                    </fieldset>

                    {waiting !== null && waiting.length > 0 ? (
                        <fieldset className="rounded-md border p-4">
                            <legend className="px-1 text-sm font-medium">
                                {t(copy.circulation.returns.waitingLegend, {
                                    count: waiting.length,
                                })}
                            </legend>
                            <div className="space-y-2">
                                {/* Not holding is the default (OPS §5) —
                                    first, and checked. The empty value is
                                    the absence of a choice, not a request
                                    id of zero length. */}
                                <label
                                    htmlFor="hold-none"
                                    className="flex min-h-11 items-center gap-2.5 text-sm"
                                >
                                    <input
                                        type="radio"
                                        id="hold-none"
                                        name="hold_for_request_id"
                                        value=""
                                        defaultChecked
                                        onChange={() => form.setData("hold_for_request_id", "")}
                                        className="size-5 accent-primary"
                                    />
                                    {copy.circulation.returns.noHoldOption}
                                </label>
                                {waiting.map((entry) => {
                                    const requested = formatInstantParts(entry.requestedAt);
                                    const optionLabel = t(copy.circulation.returns.holdForOption, {
                                        name: entry.readerName,
                                    });
                                    const requestedSuffix = t(
                                        copy.circulation.returns.holdForRequestedSuffix,
                                        requested,
                                    );
                                    return (
                                        <label
                                            key={entry.requestId}
                                            htmlFor={`hold-${entry.requestId}`}
                                            className="flex min-h-11 items-center gap-2.5 text-sm"
                                        >
                                            <input
                                                type="radio"
                                                id={`hold-${entry.requestId}`}
                                                name="hold_for_request_id"
                                                value={entry.requestId}
                                                onChange={() =>
                                                    form.setData(
                                                        "hold_for_request_id",
                                                        entry.requestId,
                                                    )
                                                }
                                                className="size-5 accent-primary"
                                            />
                                            <span>
                                                {optionLabel}
                                                <span className="text-muted-foreground">
                                                    {` · ${requestedSuffix}`}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                            <p className="mt-3 text-sm text-muted-foreground">
                                {copy.circulation.returns.nothingAutomatic}
                            </p>
                            {errors.hold_for_request_id ? (
                                <p className="mt-1 text-sm text-destructive">
                                    {errors.hold_for_request_id}
                                </p>
                            ) : null}
                        </fieldset>
                    ) : null}

                    {worse ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="return-note">
                                {copy.circulation.returns.noteLabel}
                            </Label>
                            <Input
                                id="return-note"
                                value={form.data.note}
                                onChange={(e) => form.setData("note", e.target.value)}
                            />
                        </div>
                    ) : null}

                    <div className="flex items-center gap-4">
                        <Button
                            type="submit"
                            className="h-14 px-8 text-base"
                            disabled={form.processing}
                        >
                            {copy.circulation.returns.confirmButton}
                        </Button>
                        <Link
                            href={route("shelves.manage.returns.lost", {
                                shelf: shelf.slug,
                                q: filters.q || undefined,
                                loan: chosen.loanId,
                            })}
                            className="text-sm text-muted-foreground underline"
                        >
                            {copy.circulation.returns.reportLostLink}
                        </Link>
                    </div>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {copy.circulation.returns.chooseFirst}
                </p>
            )}
        </ManageLayout>
    );
}
