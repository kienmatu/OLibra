/**
 * One place a Y-m-d string becomes a Vietnamese date. AGENTS.md: dates
 * read as dates, never timestamps — a loan is due at the end of a day.
 */
export function formatDate(ymd: string): string {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));
}
