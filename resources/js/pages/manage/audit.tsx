import { Head, router, usePage } from "@inertiajs/react";
import { route } from "ziggy-js";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

interface ExpansionRow {
    field: string;
    before: string;
    after: string;
}

interface AuditRow {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    occurredAt: string;
    group: "loans" | "books" | "readers" | null;
    sentence: string;
    expansion: ExpansionRow[];
}

interface PageProps extends SharedData {
    filters: { actor: string | null; group: string | null; from: string | null; to: string | null };
    actors: { userId: string; name: string; entries: number }[];
    log: { rows: AuditRow[]; page: number; pageCount: number; total: number };
}

const GROUP_KEYS = ["loans", "books", "readers"] as const;

export default function ManageAudit() {
    const { shelf, filters, actors, log } = usePage<PageProps>().props;
    if (!shelf) return null;

    const go = (next: Partial<PageProps["filters"] & { page: number }>) =>
        router.get(
            route("shelves.manage.audit", { shelf: shelf.slug }),
            Object.fromEntries(
                Object.entries({ ...filters, page: undefined, ...next }).filter(
                    ([, v]) => v !== null && v !== undefined && v !== "",
                ),
            ),
        );

    return (
        <ManageLayout>
            <Head title={copy.manageAudit.title} />
            <h1 className="text-2xl font-semibold">{copy.manageAudit.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">{copy.manageAudit.lead}</p>

            <div className="mb-2 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => go({ group: null })}
                    className={`rounded-full border px-3 py-1 text-sm ${filters.group === null ? "border-foreground font-medium" : ""}`}
                >
                    {copy.manageAudit.groupAll}
                </button>
                {GROUP_KEYS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => go({ group: key })}
                        className={`rounded-full border px-3 py-1 text-sm ${filters.group === key ? "border-foreground font-medium" : ""}`}
                    >
                        {copy.manageAudit.groups[key]}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.actorLabel}
                    <select
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.actor ?? ""}
                        onChange={(e) => go({ actor: e.target.value || null })}
                    >
                        <option value="">{copy.manageAudit.actorAll}</option>
                        {actors.map((a) => (
                            <option key={a.userId} value={a.userId}>
                                {a.name} {t(copy.manageAudit.actorEntries, { count: a.entries })}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.fromLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.from ?? ""}
                        onChange={(e) => go({ from: e.target.value || null })}
                    />
                </label>
                <label className="flex flex-col text-sm">
                    {copy.manageAudit.toLabel}
                    <input
                        type="date"
                        className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={filters.to ?? ""}
                        onChange={(e) => go({ to: e.target.value || null })}
                    />
                </label>
                <span className="pb-2 text-sm text-muted-foreground">
                    {t(copy.manageAudit.totalEntries, { count: log.total })}
                </span>
            </div>

            {log.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.manageAudit.empty}</p>
            ) : (
                <ul className="divide-y border-y">
                    {log.rows.map((row) => {
                        const when = formatInstantParts(row.occurredAt);
                        return (
                            <li key={row.id} className="py-3">
                                <p className="text-sm">
                                    {row.sentence}{" "}
                                    <span className="text-muted-foreground">
                                        {t(copy.manageAudit.when, {
                                            time: when.time,
                                            date: when.date,
                                        })}
                                    </span>
                                </p>
                                {/* BR §14: raw values behind an expansion, no client JS —
                                    a <details>, like every disclosure in the reference. */}
                                <details className="mt-1">
                                    <summary className="cursor-pointer text-xs text-muted-foreground">
                                        {copy.manageAudit.detail}
                                    </summary>
                                    <div className="mt-2 text-xs">
                                        <p className="mb-1 font-mono text-muted-foreground">
                                            {t(copy.manageAudit.rawAction, { action: row.action })}
                                        </p>
                                        {row.expansion.length > 0 && (
                                            <div className="overflow-x-auto">
                                                <table className="min-w-[320px] text-left">
                                                    <thead>
                                                        <tr className="text-muted-foreground">
                                                            <th className="pr-4 font-normal">
                                                                {copy.manageAudit.fieldHeader}
                                                            </th>
                                                            <th className="pr-4 font-normal">
                                                                {copy.manageAudit.beforeHeader}
                                                            </th>
                                                            <th className="font-normal">
                                                                {copy.manageAudit.afterHeader}
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {row.expansion.map((cell) => (
                                                            <tr key={cell.field}>
                                                                <td className="pr-4 font-mono">
                                                                    {cell.field}
                                                                </td>
                                                                <td className="pr-4 font-mono">
                                                                    {cell.before}
                                                                </td>
                                                                <td className="font-mono">
                                                                    {cell.after}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </details>
                            </li>
                        );
                    })}
                </ul>
            )}

            {log.pageCount > 1 && (
                <div className="mt-4 flex gap-2">
                    {log.page > 1 && (
                        <button
                            type="button"
                            className="text-sm underline"
                            onClick={() => go({ page: log.page - 1 })}
                        >
                            {copy.manageAudit.prevPage}
                        </button>
                    )}
                    {log.page < log.pageCount && (
                        <button
                            type="button"
                            className="text-sm underline"
                            onClick={() => go({ page: log.page + 1 })}
                        >
                            {copy.manageAudit.nextPage}
                        </button>
                    )}
                </div>
            )}
        </ManageLayout>
    );
}
