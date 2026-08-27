/**
 * Client-side copy. Vietnamese only, full diacritics, never inline in TSX —
 * Biome's noJsxLiterals enforces the rule for bare text; string props are on
 * you. Namespaced per screen/concept, never merged on coincidental wording.
 *
 * Interpolation convention (decided here so Phase 1's ~54 pages don't each
 * improvise one): a template holds `{param}` placeholders —
 * `overdueCount: "Có {count} sách quá hạn"` — and callers pass values through
 * `t()` below: `t(copy.manage.overdueCount, { count: 3 })`. Every
 * placeholder must be supplied; a template is never partially interpolated
 * with string concatenation, and a count/date/name is never spliced into a
 * copy string any other way.
 */
export const copy = {
    common: {
        appName: "OLibra",
        signIn: "Đăng nhập",
        signOut: "Đăng xuất",
        underConstruction: "Trang này đang được xây dựng.",
        backHome: "Về trang chủ",
    },
    home: {
        title: "Tủ sách giáo xứ",
        lead: "Mượn sách, trả sách và cùng đọc với cộng đoàn.",
        browseShelves: "Xem các tủ sách",
    },
    shelves: {
        title: "Các tủ sách",
        empty: "Chưa có tủ sách nào.",
    },
    shelf: {
        catalogue: "Danh mục",
        search: "Tìm kiếm",
        announcements: "Thông báo",
        profile: "Hồ sơ",
        manage: "Quản lý",
    },
    manage: {
        dashboard: "Tổng quan",
        lend: "Cho mượn",
        returns: "Nhận trả",
        readers: "Người đọc",
        books: "Sách",
        settings: "Cài đặt",
    },
    admin: {
        title: "Quản trị hệ thống",
        shelves: "Tủ sách",
        managers: "Người quản lý",
        categories: "Thể loại",
        settings: "Cài đặt",
    },
    auth: {
        title: "Đăng nhập",
        username: "Tên đăng nhập",
        password: "Mật khẩu",
        submit: "Đăng nhập",
    },
} as const;

/**
 * Fill a copy template's `{param}` placeholders. A missing param leaves the
 * placeholder text visible (`{count}`) rather than silently rendering
 * "undefined" — a wrong caller shows up as an obviously broken string
 * instead of a plausible one.
 */
export function t(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) =>
        key in params ? String(params[key]) : match,
    );
}
