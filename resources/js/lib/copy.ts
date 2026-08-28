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
    catalogue: {
        title: "Danh mục sách",
        searchTitle: "Tìm kiếm",
        searchPlaceholder: "Tìm theo tên sách hoặc tác giả…",
        scopeAvailable: "Sách có sẵn",
        scopeAll: "Tất cả",
        sortRecent: "Mới thêm",
        sortTitle: "Tên sách",
        allCategories: "Mọi thể loại",
        emptyList: "Không có sách nào khớp với bộ lọc.",
        emptySearch: "Không tìm thấy sách nào.",
        totalCount: "{count} đầu sách",
        pagePrev: "Trang trước",
        pageNext: "Trang sau",
        pageOf: "Trang {page}/{pageCount}",
        copyCountLine: "{available} bản có sẵn · {onLoan} đang cho mượn · {total} bản trong tủ",
        queueLine: "{count} người đang chờ mượn",
        holderLine: "{name} đang mượn, còn {days} ngày",
        holderLineAnonymous: "Đang có người mượn, còn {days} ngày",
        holderLineOverdue: "{name} đang mượn, quá hạn {days} ngày",
        contactBefore: "Liên hệ {name} · ",
        contactAfter: " để nhận sách",
        author: "Tác giả",
        publisher: "Nhà xuất bản",
        publishedYear: "Năm xuất bản",
        pageCount: "Số trang",
        category: "Thể loại",
        isbn: "Mã ISBN",
        description: "Giới thiệu",
        state: {
            available: "Có sẵn",
            on_loan: "Đang cho mượn",
            held: "Đang giữ chỗ",
            lost: "Đã mất",
            retired: "Ngừng dùng",
            none: "Chưa có bản nào",
        },
        condition: {
            perfect: "Nguyên vẹn",
            slightly_worn: "Hơi cũ",
            worn: "Cũ",
            torn: "Rách",
            missing_pages: "Mất trang",
            written_on: "Bị vẽ vào",
        },
    },
    readerCatalogue: {
        borrowSoon: "Chức năng xin mượn sẽ có trong giai đoạn sau.",
        availableWithCount: "Còn {count} bản có sẵn",
        searchLead: 'Gõ không dấu cũng tìm được — thử "tim kiem kho bau".',
        searchEmptyPrompt: "Nhập từ khoá để tìm sách.",
        suggestionsHeading: "Sách mới thêm gần đây",
    },
    manageBooks: {
        title: "Sách",
        addBook: "Thêm sách mới",
        editBook: "Sửa sách",
        viewCopies: "Xem bản",
        lostChip: "Đã mất ({count})",
        draftBadge: "Bản nháp",
        fields: {
            title: "Tên sách",
            author: "Tác giả",
            category: "Thể loại",
            categoryEmpty: "— chọn thể loại —",
            publisher: "Nhà xuất bản",
            publishedYear: "Năm xuất bản",
            pageCount: "Số trang",
            isbn: "Mã ISBN",
            description: "Giới thiệu",
            copyCount: "Số bản sách",
            donorName: "Người tặng (nếu có)",
            acquiredOn: "Ngày nhận",
            isPublished: "Hiện sách này cho bạn đọc",
        },
        save: "Lưu",
        saving: "Đang lưu…",
        copiesHeading: "Các bản sách",
        addCopies: "Thêm bản",
        addCopiesCount: "Số bản thêm",
        copyCode: "Mã",
        copyState: "Trạng thái",
        copyCondition: "Tình trạng",
        copyWhere: "Đang ở đâu",
        onShelf: "Trên kệ",
        withReader: "{name} mượn, hẹn trả {date}",
        overdueBadge: "Quá hạn",
        donorColumn: "Người tặng",
        assess: "Đánh giá",
        assessNote: "Ghi chú",
        reportLost: "Báo mất",
        markFound: "Đánh dấu tìm thấy",
        retire: "Ngừng dùng",
        retireReason: "Lý do ngừng dùng",
        retiredWithReason: "Ngừng dùng: {reason}",
        confirm: "Xác nhận",
        cancel: "Huỷ",
        conditionHistory: "Lịch sử đánh giá",
        loanHistory: "Lịch sử mượn trả",
        historyEmpty: "Chưa có dữ liệu.",
        lostTitle: "Sách đã mất",
        lostEmpty: "Không có bản sách nào đang bị báo mất.",
        lostReportedAt: "Báo mất lúc {date}",
        lostLastBorrower: "Người mượn gần nhất: {name}",
        backToList: "Về danh sách sách",
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
