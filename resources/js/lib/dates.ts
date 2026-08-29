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

/**
 * An ISO instant as the two Vietnamese numbers an audit sentence ends
 * with — "lúc {time} ngày {date}". Every WORD of the sentence is the
 * server's (lang/vi/audit.php); every NUMBER is Intl's, in the shelf's
 * timezone — the reference's split, kept: a pre-glued server string
 * would hard-code "ngày", and a Date in the domain would put a
 * formatter there.
 */
export function formatInstantParts(iso: string): { time: string; date: string } {
    const instant = new Date(iso);
    return {
        time: new Intl.DateTimeFormat("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Asia/Ho_Chi_Minh",
        }).format(instant),
        date: new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            timeZone: "Asia/Ho_Chi_Minh",
        }).format(instant),
    };
}
