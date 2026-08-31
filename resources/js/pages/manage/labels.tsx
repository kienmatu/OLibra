import { Head, router, usePage } from "@inertiajs/react";
import { useState } from "react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

interface LabelCopy {
    copyId: string;
    code: string;
    printCount: number;
}

interface LabelTitle {
    bookId: string;
    title: string;
    copies: LabelCopy[];
}

interface PageProps extends SharedData {
    titles: LabelTitle[];
    onlyUnprinted: boolean;
}

/**
 * BR §19's QR label selection screen, replacing Task 10's placeholder
 * wholesale (that file's own docblock says so). Renders the accordion
 * TitlesForLabelsQuery groups server-side and posts the union of ticked
 * bookIds/copyIds to LabelController::export.
 *
 * THE EXPORT FORM IS A PLAIN `<form method="post">`, NOT `useForm().post()`
 * OR `router.post()` — LabelController::export's own docblock: the
 * response is the PDF's bytes, and an Inertia visit cannot consume a
 * binary download. The CSRF token rides as a hidden field, the same
 * shape manage/audit.tsx's export forms already use. THERE IS
 * CONSEQUENTLY NO SUCCESS FLASH RENDERED HERE — the browser receives a
 * file on this leg, never a redirect, so there is nothing to flash into
 * a page that never re-renders for it (LabelController's docblock:
 * "NOTHING IS FLASHED ON SUCCESS").
 *
 * A TITLE TICKED AS A WHOLE DISABLES ITS OWN COPY CHECKBOXES rather than
 * leaving two controls that could disagree — CopiesForLabelsQuery treats
 * bookIds/copyIds as a union, so an individual copy's checked state
 * genuinely does not change what gets printed once its title is ticked.
 *
 * COPY ROWS STAY MOUNTED WHEN A TITLE IS COLLAPSED (visibility is a CSS
 * class, not conditional JSX). A checkbox unmounted by a collapse would
 * carry no `name`/`value` into the native form submit, silently dropping
 * a selection the manager made before collapsing — this keeps every
 * ticked copy in the request regardless of which titles are open.
 */
export default function Labels({ titles, onlyUnprinted }: PageProps) {
    const { shelf, csrfToken } = usePage<SharedData>().props;
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
    const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());

    if (!shelf) return null;

    const toggleExpanded = (bookId: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(bookId)) {
                next.delete(bookId);
            } else {
                next.add(bookId);
            }
            return next;
        });
    };

    const toggleBook = (bookId: string, checked: boolean) => {
        setSelectedBookIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(bookId);
            } else {
                next.delete(bookId);
            }
            return next;
        });
    };

    const toggleCopy = (copyId: string, checked: boolean) => {
        setSelectedCopyIds((prev) => {
            const next = new Set(prev);
            if (checked) {
                next.add(copyId);
            } else {
                next.delete(copyId);
            }
            return next;
        });
    };

    const toggleOnlyUnprinted = (checked: boolean) => {
        router.get(
            route("shelves.manage.qr-labels", { shelf: shelf.slug }),
            checked ? { onlyUnprinted: 1 } : {},
        );
    };

    return (
        <ManageLayout>
            <Head title={copy.manageLabels.title} />
            <h1 className="text-2xl font-semibold">{copy.manageLabels.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{copy.manageLabels.lead}</p>

            <div className="mb-4 flex items-center gap-2">
                <Checkbox
                    id="only-unprinted"
                    checked={onlyUnprinted}
                    onCheckedChange={(value) => toggleOnlyUnprinted(value === true)}
                />
                <Label htmlFor="only-unprinted">{copy.manageLabels.onlyUnprinted}</Label>
            </div>

            {titles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageLabels.empty}</p>
            ) : (
                <form
                    method="post"
                    action={route("shelves.manage.exports.qr-labels", { shelf: shelf.slug })}
                >
                    <input type="hidden" name="_token" value={csrfToken} />

                    <ul className="divide-y border-y">
                        {titles.map((title) => {
                            const isExpanded = expanded.has(title.bookId);
                            const wholeTitleChecked = selectedBookIds.has(title.bookId);

                            return (
                                <li key={title.bookId} className="py-3">
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            id={`book-${title.bookId}`}
                                            name="bookIds[]"
                                            value={title.bookId}
                                            checked={wholeTitleChecked}
                                            onCheckedChange={(value) =>
                                                toggleBook(title.bookId, value === true)
                                            }
                                        />
                                        <div className="flex-1">
                                            <Label htmlFor={`book-${title.bookId}`}>
                                                {title.title}
                                            </Label>
                                            <p className="text-xs text-muted-foreground">
                                                {t(copy.manageLabels.copiesCount, {
                                                    count: title.copies.length,
                                                })}
                                                {" · "}
                                                {copy.manageLabels.selectWholeTitle}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="text-sm underline"
                                            onClick={() => toggleExpanded(title.bookId)}
                                        >
                                            {isExpanded
                                                ? copy.manageLabels.collapse
                                                : copy.manageLabels.expand}
                                        </button>
                                    </div>

                                    <ul
                                        className={
                                            isExpanded
                                                ? "mt-2 space-y-2 pl-8"
                                                : "hidden mt-2 space-y-2 pl-8"
                                        }
                                    >
                                        {title.copies.map((copyRow) => (
                                            <li
                                                key={copyRow.copyId}
                                                className="flex items-center gap-3"
                                            >
                                                <Checkbox
                                                    id={`copy-${copyRow.copyId}`}
                                                    name="copyIds[]"
                                                    value={copyRow.copyId}
                                                    checked={
                                                        wholeTitleChecked ||
                                                        selectedCopyIds.has(copyRow.copyId)
                                                    }
                                                    disabled={wholeTitleChecked}
                                                    onCheckedChange={(value) =>
                                                        toggleCopy(copyRow.copyId, value === true)
                                                    }
                                                />
                                                <Label
                                                    htmlFor={`copy-${copyRow.copyId}`}
                                                    className="font-mono"
                                                >
                                                    {copyRow.code}
                                                </Label>
                                                <Badge
                                                    variant={
                                                        copyRow.printCount > 0
                                                            ? "secondary"
                                                            : "outline"
                                                    }
                                                >
                                                    {copyRow.printCount > 0
                                                        ? t(copy.manageLabels.printCountReprint, {
                                                              count: copyRow.printCount,
                                                          })
                                                        : copy.manageLabels.printCountNever}
                                                </Badge>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            );
                        })}
                    </ul>

                    <button type="submit" className="mt-4 rounded-md border px-4 py-2 text-sm">
                        {copy.manageLabels.submit}
                    </button>
                </form>
            )}
        </ManageLayout>
    );
}
