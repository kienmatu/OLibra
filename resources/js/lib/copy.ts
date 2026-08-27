/**
 * Client-side copy. Vietnamese only, full diacritics, never inline in TSX —
 * Biome's noJsxLiterals enforces the rule for bare text; string props are on
 * you. Namespaced per screen/concept, never merged on coincidental wording.
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
