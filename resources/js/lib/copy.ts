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
        // "Bản tin", not "Thông báo" — the reference's own name for the
        // shelf bulletin (public-header.tsx:279), chosen there
        // precisely so the personal bell below can keep "Thông báo".
        // Renamed at Task 16, which added that bell: until then the two
        // never appeared together, and afterwards the shelf home
        // rendered two links a tap apart reading the same word to two
        // different places. The ROUTE is still shelves.announcements;
        // only the Vietnamese changed, and shelves/show.tsx is the one
        // place that renders it (grepped resources/js at this commit).
        announcements: "Bản tin",
        // BR §16.1's shelf home, item 3 (opened): "two secondary cards,
        // **Tặng sách** and **Góp ý**". Task 18 shipped the two reader
        // donation screens and this word is what reaches them — measured
        // at 2731bea, `grep -rn "shelves.donate" resources/js` returned
        // exactly two hits, one in each of those two pages, cross-linking
        // each other. shelves/show.tsx carries the same measurement beside
        // the link this key labels, and what it does and does not prove.
        // `Góp ý` is a second card the same paragraph asks for
        // and it is NOT added here: `shelves.feedback` still renders the
        // under-construction placeholder, and a link to that is a promise
        // the page cannot keep.
        donate: "Tặng sách",
        profile: "Hồ sơ",
        manage: "Quản lý",
    },
    manage: {
        dashboard: "Tổng quan",
        lend: "Cho mượn",
        returns: "Nhận trả",
        readers: "Người đọc",
        books: "Sách",
        overdue: "Quá hạn",
        requests: "Yêu cầu mượn",
        // The NAV word, one of two spellings of the same subject in this
        // file. The screen it opens is headed "Bình luận chờ duyệt" and
        // the three archives re-head it — see manageComments.titles — so
        // the nav says the subject and the heading says the view.
        comments: "Bình luận",
        // The NAV word, matching `shelf.announcements` — the bulletin is
        // "Bản tin" on both sides of the shelf, and the manager's screen
        // re-heads it in manageAnnouncements.title.
        announcements: "Bản tin",
        // The NAV word, and the same Vietnamese the reader's own two
        // screens use — a volunteer and a child call this one thing.
        // The screen it opens re-heads it in manageDonations.title.
        donations: "Tặng sách",
        settings: "Cài đặt",
        audit: "Nhật ký",
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
    register: {
        title: "Đăng ký làm bạn đọc",
        lead: "Điền giúp mình vài thông tin. Quản lý tủ sách sẽ gặp và duyệt tài khoản sau lễ Chúa nhật.",
        chooseFirst: "Trước hết, bạn chọn tủ sách của giáo xứ mình nhé.",
        chooseShelf: "Xem danh sách tủ sách",
        forShelf: "Đăng ký cho tủ sách",
        changeShelf: "Chọn tủ sách khác",
        sent: "Đã gửi đăng ký. Quản lý sẽ gặp bạn ở nhà xứ để xác nhận.",
        groupCredentials: "Đăng nhập",
        credentialsNote:
            "Để trống cũng được — bạn chỉ cần tên đăng nhập nếu muốn tự xem sách ở nhà. Quản lý có thể tạo sau.",
        username: "Tên đăng nhập",
        usernameHint: "Dùng để đăng nhập, nên chọn tên dễ nhớ.",
        password: "Mật khẩu",
        passwordHint: "Ít nhất 8 ký tự. Nếu quên, quản lý sẽ đặt lại giúp.",
        passwordConfirm: "Nhập lại mật khẩu",
        groupPerson: "Bản thân",
        saintName: "Tên thánh",
        saintNameHint: "Theo sổ giáo xứ, để quản lý dễ nhận ra bạn.",
        fullName: "Họ và tên",
        fullNameHint: "Ghi đầy đủ như trong sổ giáo xứ.",
        dateOfBirth: "Ngày sinh",
        dateOfBirthHint: "Để tủ sách gợi ý sách hợp tuổi.",
        groupFamily: "Gia đình",
        fatherName: "Tên cha",
        motherName: "Tên mẹ",
        parentHint: "Giúp quản lý phân biệt các bạn đọc trùng tên.",
        phone: "Số điện thoại liên hệ",
        phoneHint: "Số của cha mẹ cũng được. Để trống thì cần cho biết lý do bên dưới.",
        phoneMissingReason: "Lý do chưa có số điện thoại",
        phoneMissingHint: "Ví dụ: em bé chưa có điện thoại riêng, sẽ bổ sung sau.",
        phoneDialogTitle: "Chưa có số điện thoại?",
        phoneDialogBody:
            "Số điện thoại là cách quản lý liên hệ khi sách đến hạn. Nếu chưa có, bạn cho biết lý do nhé.",
        phoneDialogConfirm: "Gửi với lý do này",
        phoneDialogCancel: "Quay lại nhập số",
        groupParish: "Giáo xứ",
        parishNote:
            "Không bắt buộc. Chưa biết cũng cứ gửi đăng ký — quản lý bổ sung giúp sau khi gặp bạn.",
        noUnit: "— Không chọn —",
        afterTitle: "Sau khi gửi thì sao?",
        afterBody:
            "Tài khoản chưa dùng được ngay. Quản lý sẽ gặp bạn ở nhà xứ để xác nhận, thường trong vòng một tuần.",
        submit: "Gửi đăng ký",
        haveAccount: "Đã có tài khoản? Đăng nhập",
        required: "Bắt buộc",
    },
    membershipStatus: {
        pending: "Chờ duyệt",
        active: "Đang hoạt động",
        suspended: "Tạm khoá",
        left: "Đã rời",
        rejected: "Đã từ chối",
    },
    manageReaders: {
        title: "Người đọc",
        addReader: "Đăng ký người đọc mới",
        searchPlaceholder: "Tìm theo tên…",
        search: "Tìm",
        statusAll: "Tất cả",
        unitAll: "Mọi đơn vị",
        holding: "Đang mượn {count}",
        totalCount: "{count} bạn đọc",
        empty: "Chưa có bạn đọc nào khớp bộ lọc.",
        pagePrev: "Trang trước",
        pageNext: "Trang sau",
        pageOf: "Trang {page}/{pageCount}",
        createTitle: "Đăng ký người đọc mới",
        createLead:
            "Điền thay cho bạn đọc đang đứng trước mặt. Hồ sơ vẫn chờ duyệt để bước xác nhận không bị bỏ qua.",
        createSubmit: "Tạo hồ sơ chờ duyệt",
    },
    registrationQueue: {
        title: "Đăng ký chờ duyệt",
        empty: "Không có đơn đăng ký nào đang chờ.",
        requestedAt: "Gửi lúc {time}",
        dateOfBirth: "Ngày sinh",
        father: "Tên cha",
        mother: "Tên mẹ",
        phone: "Số điện thoại",
        phoneMissing: "Chưa có số — lý do: {reason}",
        parish: "Đơn vị",
        similar: "Gần trùng tên với {name} ({percent}%) — kiểm tra xem có phải đăng ký hai lần.",
        approve: "Duyệt đăng ký",
        reject: "Từ chối",
        rejectReason: "Lý do từ chối",
    },
    readerDetail: {
        title: "Hồ sơ bạn đọc",
        holding: "Đang mượn",
        loanDue: "Hạn {date}",
        loanOverdue: "Quá hạn {days} ngày",
        loanDays: "Còn {days} ngày",
        noLoans: "Không mượn cuốn nào.",
        fields: {
            saintName: "Tên thánh",
            fullName: "Họ và tên",
            dateOfBirth: "Ngày sinh",
            fatherName: "Tên cha",
            motherName: "Tên mẹ",
            phone: "Số điện thoại",
            phoneMissingReason: "Lý do chưa có số điện thoại",
            email: "Email",
            parish: "Đơn vị",
            joinedOn: "Ngày tham gia",
        },
        managerNotes: "Ghi chú của quản lý",
        suspensionReason: "Lý do tạm khoá",
        suspensionReasonLine: "Lý do tạm khoá: {reason}",
        rejectionReason: "Lý do từ chối",
        rejectionReasonLine: "Lý do từ chối: {reason}",
        editProfile: "Sửa hồ sơ",
        editSave: "Lưu thay đổi",
        credentialsTitleNew: "Cấp tài khoản đăng nhập",
        credentialsTitleReset: "Đặt lại mật khẩu",
        credentialsUsername: "Tên đăng nhập",
        credentialsPassword: "Mật khẩu mới",
        credentialsSubmit: "Lưu tài khoản",
        suspend: "Tạm khoá tài khoản",
        suspendNote:
            "Tạm khoá chặn dùng cả tủ sách, không chỉ mượn mới — người đọc vẫn đăng nhập được nhưng không vào được trang nào. Sách đang mượn vẫn giữ nguyên trong hệ thống.",
        suspendReason: "Lý do tạm khoá",
        suspendSubmit: "Tạm khoá",
        reactivate: "Mở khoá lại",
        markLeft: "Đánh dấu đã rời",
    },
    manageAudit: {
        title: "Nhật ký",
        lead: "Mọi thay đổi trong tủ sách, ai làm và lúc nào.",
        when: "lúc {time} ngày {date}",
        groupAll: "Tất cả",
        groups: {
            loans: "Mượn và trả",
            books: "Sách",
            readers: "Bạn đọc",
            // The reference's own label for cong-dong, and the ordinary
            // word a volunteer uses.
            community: "Cộng đồng",
        },
        actorLabel: "Người thực hiện",
        actorAll: "Mọi người",
        actorEntries: "({count} lượt)",
        fromLabel: "Từ ngày",
        toLabel: "Đến ngày",
        filter: "Lọc",
        empty: "Chưa có hoạt động nào được ghi lại.",
        detail: "Chi tiết",
        rawAction: "Thao tác: {action}",
        fieldHeader: "Trường",
        beforeHeader: "Trước",
        afterHeader: "Sau",
        totalEntries: "{count} lượt ghi",
        prevPage: "Trang trước",
        nextPage: "Trang sau",
    },
    manageExports: {
        heading: "Xuất dữ liệu",
        lead: "Tệp CSV mở được bằng Excel — sao lưu dữ liệu của tủ sách.",
        books: "Tải danh mục sách",
        readers: "Tải danh sách bạn đọc",
        loans: "Tải lịch sử mượn trả",
    },
    manageDashboard: {
        // "Tổng quan", not "Trang chính": copy.manage.dashboard — the nav
        // entry that opens this page — already says "Tổng quan", and a nav
        // word that opens a differently-headed page is two names for one
        // screen. Duplicated as a literal rather than referencing
        // copy.manage.dashboard because `copy` is one object literal and
        // cannot refer to itself mid-definition.
        title: "Tổng quan",
        overdueCard: "Quá hạn",
        registrationsCard: "Chờ duyệt tài khoản",
        requestsCard: "Yêu cầu chờ xử lý",
        commentsCard: "Bình luận chờ duyệt",
        viewList: "Xem danh sách",
        lendAction: "Cho mượn",
        lendSub: "Tìm sách · chọn người đọc · xác nhận",
        returnAction: "Nhận trả",
        returnSub: "Tìm sách đang mượn · kiểm tra tình trạng",
        totalsHeading: "Tình hình tủ sách",
        totalTitles: "Đầu sách",
        totalCopies: "Bản sách",
        totalOnLoan: "Đang cho mượn",
        totalReaders: "Bạn đọc",
    },
    /**
     * The manager's borrow-request queue. Its own section rather than a
     * branch of `circulation.requests`: that one is the READER's wording
     * for their own row ("Bạn đang chờ cuốn này"), and these are a
     * volunteer's words about somebody else's.
     */
    manageRequests: {
        title: "Yêu cầu mượn",
        subtitle: "Xếp theo thứ tự đăng ký.",
        subtitleCounted: "{count} cuốn có người đang chờ · Xếp theo thứ tự đăng ký.",
        empty: "Hiện không có bạn đọc nào đang chờ mượn sách.",
        waitingCount: "{count} người đang chờ",
        requestedLine: "Đăng ký {time} ngày {date}",
        holdNote: "Đang giữ chỗ cho bạn này · hết hạn giữ {time} ngày {date}",
        holdNoteBare: "Đang giữ chỗ cho bạn này",
        holdExpiredNote: "Thời gian giữ chỗ đã hết lúc {time} ngày {date}",
        holdExpiredBare: "Thời gian giữ chỗ đã hết",
        copySuffix: "bản {code}",
        firstPendingNote: "Giữ chỗ {days} ngày kể từ khi duyệt.",
        notYourTurnNote: "Chỉ duyệt được khi tới lượt.",
        approveButton: "Duyệt & giữ chỗ",
        copyLabel: "Bản sách",
        noFreeCopies: "Chưa có bản nào rảnh để giữ chỗ.",
        rejectSummary: "Từ chối",
        rejectReasonLabel: "Lý do từ chối",
        // Ruling 2, settled: the reason is optional. The hint says so
        // rather than leaving a volunteer to find out by submitting.
        rejectReasonHint: "Không bắt buộc.",
        rejectConfirm: "Xác nhận từ chối",
        handoverButton: "Xác nhận trao sách",
        releaseButton: "Trả về kệ",
        nothingAutomatic: "Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.",
    },
    /**
     * The manager's moderation screen. Its own section rather than a
     * branch of `comments`: that one is the READER's wording on a book
     * page ("Bạn thấy cuốn này thế nào?"), and these are a volunteer's
     * words about somebody else's comment — the same split
     * manageRequests already draws against `circulation.requests`.
     */
    manageComments: {
        // The heading names the VIEW, and the ?status= chip chooses it.
        // The reference re-heads the page per tab for the same reason
        // and this ports that; the browser tab title stays the screen's
        // one name (`tab` below), because a tab names a screen rather
        // than the filter currently applied to it.
        tab: "Bình luận",
        titles: {
            pending: "Bình luận chờ duyệt",
            approved: "Bình luận đã duyệt",
            rejected: "Bình luận đã từ chối",
            hidden: "Bình luận đã ẩn",
        },
        chips: {
            pending: "Chờ duyệt",
            approved: "Đã duyệt",
            rejected: "Đã từ chối",
            hidden: "Đã ẩn",
        },
        // The chip's own number, beside its word.
        chipCount: "{label} ({count})",
        subtitle: "Bình luận chỉ hiển thị công khai sau khi được duyệt.",
        subtitleCounted:
            "{count} bình luận đang chờ · Bình luận chỉ hiển thị công khai sau khi được duyệt.",
        empty: "Chưa có bình luận nào.",
        aboutBook: "Bình luận về",
        // A DATE and an hour: a queue is worked in order and how long a
        // child has been waiting is the thing a volunteer reads off a
        // row, unlike the book page's list where the date alone does.
        postedAt: "gửi {time} ngày {date}",
        // What a row shows when the person who wrote it, or the book it
        // is about, has since been soft-deleted: the query returns an
        // empty string there, and an empty string renders as a gap that
        // reads like a bug rather than like a fact.
        deletedAuthor: "Bạn đọc đã rời tủ sách",
        deletedBook: "Sách đã gỡ khỏi tủ",
        approveButton: "Duyệt bình luận",
        rejectSummary: "Từ chối",
        rejectReasonLabel: "Lý do từ chối",
        rejectReasonHint: "Bạn đọc sẽ thấy lý do này.",
        // The word, never a bare asterisk (AGENTS.md rule 6). A second
        // key rather than a reach into `register.required` or
        // `comments.required`, so rewording a form elsewhere cannot
        // silently rewrite this one.
        required: "Bắt buộc",
        rejectConfirm: "Xác nhận từ chối",
        hideButton: "Ẩn bình luận",
        // Why the two read-only archives offer nothing: no command moves
        // a rejected or hidden row anywhere, so a button there would post
        // to nothing.
        readOnlyNote: "Bình luận đã từ chối hoặc đã ẩn thì không đổi được nữa.",
    },
    // The bulletin from the writing side. A separate namespace from
    // `announcements` (the reader's two screens) rather than extra keys on
    // it: that group holds a heading, an empty state and a badge, and this
    // one holds three state words, five button labels and a form.
    //
    // The three state words are the reference's own — "Đang hiện", "Nháp",
    // "Hết hạn", read off
    // old_next/src/app/tu-sach/[shelf]/quan-ly/thong-bao/page.tsx's
    // STATE_STYLE — keyed by the exact strings
    // AnnouncementsQuery::managed() puts on each row, so a state the server
    // can send has a word here by construction.
    manageAnnouncements: {
        title: "Bản tin tủ sách",
        subtitle: "Thông báo được ghim sẽ hiện lên đầu bản tin của tủ sách.",
        empty: "Chưa có thông báo nào.",
        compose: "Viết thông báo",
        composeTitle: "Viết thông báo",
        editTitle: "Sửa thông báo",
        state: {
            showing: "Đang hiện",
            draft: "Nháp",
            expired: "Hết hạn",
        },
        // Beside a pinned row, and NOT colour alone (AGENTS.md rule 2) —
        // the reference's own word for this marker on this screen.
        pinnedBadge: "Đang ghim",
        notPublished: "Chưa đăng",
        // A DATE, not a timestamp (AGENTS.md's language rule). The server
        // sends both as ISO instants and formatInstantParts renders the
        // NUMBER; the Vietnamese glue is here, the same split
        // announcements.publishedOn uses.
        publishedOn: "Đăng ngày {date}",
        expiresOn: "Hết hạn ngày {date}",
        publishNow: "Đăng ngay",
        publishAgain: "Đăng lại",
        hide: "Ẩn",
        pin: "Ghim lên đầu",
        unpin: "Bỏ ghim",
        edit: "Sửa",
        fields: {
            title: "Tiêu đề",
            body: "Nội dung",
            expiresAt: "Hết hạn ngày",
            pinned: "Ghim lên đầu bản tin",
        },
        // Why the box may be left empty, said once and reused by the edit
        // form and by every row's republish box: an empty box is not "no
        // answer", it is the answer "this notice does not expire".
        expiresHint: "Để trống nếu thông báo không có ngày hết hạn.",
        // The word, never a bare asterisk (AGENTS.md rule 6). Its own key
        // rather than a reach into manageComments.required, so rewording
        // that form cannot silently reword this one.
        required: "Bắt buộc",
        save: "Lưu thông báo",
        saving: "Đang lưu…",
        backToList: "Về bản tin",
    },
    /**
     * The donation queue from the deciding side. A separate namespace from
     * `donations` (the reader's two screens) rather than extra keys on it,
     * the split `manageComments` already draws against `comments`: that
     * group is a child offering their books, and this one is a volunteer's
     * words about somebody else's offer.
     *
     * Wording taken from the reference's own queue screen
     * (old_next/src/app/tu-sach/[shelf]/quan-ly/tang-sach/page.tsx,
     * opened) — its heading, its two subtitles, its pill word, its two
     * field captions, its two button labels and its reason field's label
     * and hint. The one sentence NOT taken from it is `subtitleCounted`:
     * the reference's says "Duyệt sẽ mở form thêm sách với Người tặng đã
     * điền sẵn", which describes a pre-fill this phase does not ship (see
     * App\Http\Controllers\Manage\DonationController's docblock), so
     * repeating it would be the screen promising what the button does not
     * do.
     */
    manageDonations: {
        title: "Tặng sách",
        subtitle: "Không có lời đề nghị nào đang chờ.",
        subtitleCounted:
            "{count} lời đề nghị đang chờ · Duyệt xong, hãy thêm sách vào kho và ghi tên người tặng.",
        // The status word beside every row — AGENTS.md's second
        // non-negotiable, which asks for an icon, a word and a colour
        // together and never colour alone. One word, not three: this
        // list is pending-only.
        statusPending: "Chờ duyệt",
        donorLine: "Gửi ngày {date}",
        descriptionCaption: "Mô tả từ bạn đọc",
        countCaption: "Số lượng áng chừng",
        countValue: "Khoảng {count} cuốn",
        // `photoUrl` rides every row and is not rendered as an image:
        // plan divergence 11 keeps the column read-only until an uploader
        // exists to write it, so no row can carry one yet. The reference
        // draws a placeholder tile in its place and this says the same
        // thing in words.
        noPhoto: "Không có ảnh đính kèm",
        empty: "Chưa có lời đề nghị tặng sách nào.",
        receiveButton: "Duyệt",
        declineSummary: "Từ chối",
        declineReasonLabel: "Lý do từ chối",
        declineReasonHint: "Bạn đọc sẽ thấy lý do này trên trang Tặng sách của mình.",
        // The word, never a bare asterisk (AGENTS.md rule 6). Its own key
        // rather than a reach into manageComments.required, so rewording
        // that screen cannot silently rewrite this one.
        required: "Bắt buộc",
        declineConfirm: "Xác nhận từ chối",
    },
    circulation: {
        rules: {
            copy_not_available: "Bản sách này đang được mượn hoặc đang giữ chỗ.",
            copy_lost_or_retired: "Bản sách này đã mất hoặc ngừng dùng.",
            membership_not_active: "Tài khoản đang tạm khoá, không thể mượn thêm.",
            loan_limit_reached: "Bạn đọc đã mượn tối đa số sách cho phép.",
            no_renewals_remaining: "Bạn đã dùng hết số lần gia hạn cho lượt mượn này.",
            title_has_queue: "Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.",
            // Settled decision 4. Must stay word-for-word identical to
            // lang/vi/rules.php's title_has_no_copies: the list row reads
            // this one, the confirm screen's `blocking` reads this one,
            // and a server refusal would read the PHP one — three surfaces,
            // one sentence, or the volunteer gets two answers.
            title_has_no_copies: "Cuốn này chưa có bản sách nào trong tủ.",
        },
        steps: ["Tìm sách", "Chọn người đọc", "Xác nhận"],
        lend: {
            title1: "Tìm sách cần cho mượn",
            title2: "Chọn người đọc",
            title3: "Xác nhận cho mượn",
            searchBookPlaceholder: "Tên sách hoặc mã bản",
            searchBookHint: "Không cần gõ dấu — gõ de men vẫn tìm ra Dế Mèn.",
            searchReaderPlaceholder: "Tên bạn đọc",
            search: "Tìm",
            available: "Còn sách",
            copies: "{available}/{total} bản",
            holding: "Đang mượn {count} cuốn",
            registerNewReader: "Đăng ký người đọc mới",
            // Settled decision 3. The lead is what tells a volunteer this
            // form is NOT the readers-list one: no waiting, because the
            // child is standing here with a book.
            newReaderTitle: "Đăng ký người đọc mới",
            newReaderLead:
                "Bạn đọc dùng được ngay, không cần chờ duyệt — điền xong là quay lại bước xác nhận cho mượn.",
            newReaderSubmit: "Lưu và cho mượn tiếp",
            bookLabel: "Sách",
            copyLabel: "Bản",
            readerLabel: "Người đọc",
            lentOnLabel: "Ngày mượn",
            dueOnLabel: "Hạn trả",
            confirmButton: "Xác nhận cho mượn",
            bookMissing: "Chưa chọn sách — quay lại bước 1.",
            readerMissing: "Chưa chọn người đọc — quay lại bước 2.",
        },
        returns: {
            title: "Nhận trả sách",
            lostTitle: "Bạn đọc báo làm mất",
            searchPlaceholder: "Tên sách, tên bạn đọc hoặc mã bản",
            search: "Tìm",
            dueLine: "Hạn trả {date}",
            overdueLine: "Quá hạn {days} ngày",
            conditionLegend: "Tình trạng sách khi trả",
            noteLabel: "Ghi chú",
            confirmButton: "Xác nhận nhận trả",
            reportLostLink: "Bạn đọc báo làm mất",
            backToReturns: "Quay lại nhận trả",
            lostExplain:
                "Sau khi xác nhận, bản {code} sẽ chuyển sang trạng thái Đã mất và lượt mượn khép lại là mất sách.",
            lostNoteLabel: "Ghi chú",
            lostConfirmButton: "Xác nhận báo mất",
            noneFound: "Không tìm thấy lượt mượn nào đang mở.",
            chooseFirst: "Tìm và chọn lượt mượn cần xử lý.",
            waitingLegend: "{count} bạn đọc đang chờ cuốn này",
            noHoldOption: "Không giữ chỗ, trả về kệ",
            holdForOption: "Giữ chỗ cho {name}",
            holdForRequestedSuffix: "đăng ký {time} ngày {date}",
            nothingAutomatic: "Hệ thống không tự động giữ chỗ. Quản lý quyết định từng trường hợp.",
        },
        overdue: {
            title: "Sách quá hạn",
            sortMostLate: "Trễ nhất trước",
            sortLeastLate: "Trễ ít trước",
            sortBorrower: "Theo tên bạn đọc",
            daysLate: "Trễ {days} ngày",
            dueLine: "Hạn trả {date}",
            empty: "Không có sách nào quá hạn. Tuyệt vời!",
            noPhone: "Chưa có số điện thoại",
        },
        voidLoan: {
            button: "Huỷ lượt mượn",
            reasonLabel: "Lý do huỷ",
            confirm: "Huỷ",
        },
        entryPoints: {
            lend: "Cho mượn",
            receive: "Nhận trả",
        },
        myLoans: {
            overviewTitle: "Trang của tôi",
            historyTitle: "Lịch sử mượn sách",
            currentSection: "Sách đang mượn",
            requestsSection: "Đăng ký mượn",
            requestsEmpty: "Bạn chưa đăng ký chờ mượn cuốn nào.",
            requestPositionLine: "Bạn ở vị trí {position}",
            requestHeldLine: "Đã sẵn sàng, nhận trước {time} ngày {date}",
            requestHeldLineNoDate: "Đã sẵn sàng để nhận",
            recentSection: "Vừa trả gần đây",
            daysRemaining: "Còn {days} ngày",
            dueToday: "Đến hạn hôm nay",
            overdueDays: "Quá hạn {days} ngày",
            dueLine: "Hạn trả {date}",
            renewButton: "Xin gia hạn",
            renewedLine: "Đã gia hạn {count} lần",
            returnedLine: "Đã trả ngày {date}",
            lentLine: "Mượn ngày {date}",
            statusReturned: "Đã trả",
            statusActive: "Đang mượn",
            statusLost: "Báo mất",
            statusVoided: "Đã huỷ",
            emptyLoans: "Bạn chưa mượn cuốn nào. Ra tủ sách chọn một cuốn nhé!",
            emptyHistory: "Chưa có lượt mượn nào.",
            prev: "Trước",
            next: "Sau",
        },
        requests: {
            requestButton: "Xin mượn",
            queueButton: "Đăng ký chờ mượn",
            waitingLine: "Bạn đang chờ cuốn này · vị trí {position}",
            heldLine: "Sách đã để dành cho bạn · nhận trước {time} ngày {date}",
            heldLineNoDate: "Sách đã để dành cho bạn",
            cancelButton: "Huỷ yêu cầu",
        },
    },
    // The reader's comments on a book page. Its own namespace rather than
    // a corner of `catalogue`: the moderation screen is a different
    // surface with different words, and merging on the shared subject is
    // exactly the "coincidental wording" this file's header refuses.
    comments: {
        heading: "Bình luận",
        empty: "Chưa có bình luận nào. Bạn là người đầu tiên nhé.",
        formLabel: "Viết bình luận",
        // The word, not an asterisk, beside the label — the reference's
        // Field renders exactly this for a `required` textarea. The same
        // string sits under register.required for the registration form;
        // this is a second key rather than a reach across that namespace,
        // so a change to the registration wording cannot silently rewrite
        // what a book page says.
        required: "Bắt buộc",
        placeholder: "Bạn thấy cuốn này thế nào?",
        submit: "Gửi bình luận",
        // The memberless viewer's sentence, in place of a box that would
        // refuse them — the reference's own wording for the same case.
        onlyReaders: "Chỉ bạn đọc của tủ sách này mới viết bình luận được.",
        // A DATE, not a timestamp (AGENTS.md's language rule). The server
        // sends createdAt as an ISO instant, so the number comes from
        // formatInstantParts(...).date and the Vietnamese glue is here —
        // the same split notifications.receivedAt uses, minus the hour,
        // because "what a child wrote about a book" is not an event you
        // read a clock for.
        postedOn: "ngày {date}",
    },
    // The shelf's bulletin, as its own two screens. The NAV word stays
    // `shelf.announcements` = "Bản tin"; these are the words the pages
    // themselves carry, and they are a separate namespace rather than
    // extra keys under `shelf` because that group holds nav labels and
    // this one holds a heading, an empty state and a badge.
    //
    // "Bản tin tủ sách", not the reference's "Thông báo của tủ sách": Task
    // 16 renamed this bulletin so the personal bell could keep "Thông
    // báo", and a heading that used the old word would put the renamed
    // word in the nav and the old one at the top of the page it opens.
    announcements: {
        title: "Bản tin tủ sách",
        empty: "Hiện chưa có bản tin nào.",
        // Beside the pinned notice, and NOT colour alone (AGENTS.md's
        // second non-negotiable) — the reference's own word for this
        // marker, kept.
        pinned: "Ghim",
        // A DATE, not a timestamp. The server sends publishedAt as an ISO
        // instant and formatInstantParts renders the NUMBER; the
        // Vietnamese glue is here, the same split comments.postedOn uses.
        // The hour is dropped deliberately: a parish bulletin is read as
        // "what was posted this week", not as an event you check a clock
        // for.
        publishedOn: "Đăng ngày {date}",
        backToList: "Về bản tin tủ sách",
        backToShelf: "Về trang tủ sách",
    },
    // "Thông báo" belongs HERE, to the personal bell, and the shelf's
    // bulletin is `shelf.announcements` = "Bản tin" — the reference's
    // split, adopted at Task 16 rather than reinvented. The first draft of
    // this section noticed the two carried the identical word and argued
    // only that the KEYS should not merge, which left the shelf home
    // showing two links a tap apart both reading "Thông báo"; the reference
    // had already paid for that mistake once and renamed the bulletin. One
    // is what the shelf tells everybody, this is what the shelf told YOU.
    // Every sentence a row shows comes from the server
    // (NotificationSentences) — nothing here names a notification kind.
    notifications: {
        bell: "Thông báo",
        bellWithCount: "Thông báo ({count})",
        title: "Thông báo",
        allRead: "Bạn đã đọc hết rồi.",
        unreadCount: "Bạn có {count} thông báo chưa đọc.",
        markAll: "Đánh dấu đã đọc hết",
        markOne: "Đánh dấu đã đọc",
        newBadge: "Mới",
        empty: "Chưa có thông báo nào. Khi đơn đăng ký hoặc yêu cầu mượn của bạn được duyệt, bạn sẽ thấy ở đây.",
        backToOverview: "Về trang của tôi",
        // The same shape manageAudit.when uses, deliberately: a
        // notification's arrival is an instant, and this is the one
        // Vietnamese glue ("lúc", "ngày") the server does not supply,
        // because formatInstantParts renders the two NUMBERS locally.
        receivedAt: "lúc {time} ngày {date}",
    },
    // Tặng sách, across the reader's TWO screens — the offer form in the
    // shelf area and their own offers under the profile. One namespace
    // rather than two because a reader reads them as one act; the manager's
    // queue is a different surface with different words and will not share
    // this group.
    //
    // Wording taken from the reference's own single screen
    // (old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/tang-sach/page.tsx,
    // opened) — its heading, its subtitle, its two field labels, its
    // placeholder, its button, its section heading, and its three status
    // words.
    donations: {
        formTitle: "Tặng sách cho tủ sách",
        formSubtitle: "Bạn có cuốn nào đọc xong rồi, muốn tặng lại cho các bạn khác không?",
        descriptionLabel: "Bạn muốn tặng sách gì?",
        // The word, not an asterisk — AGENTS.md's rule 6. Its own key
        // rather than a reach into `comments.required` or
        // `register.required`, so rewording a form elsewhere cannot
        // silently rewrite what this one asks for.
        required: "Bắt buộc",
        descriptionPlaceholder: "Ví dụ: khoảng mười cuốn truyện tranh, còn khá mới",
        // No `required` twin, and that is the field's whole point: OPS §4.4
        // asks for free text and a ROUGH count, and a reader who does not
        // know how many books are in the bag leaves it blank.
        countLabel: "Khoảng bao nhiêu cuốn?",
        submit: "Gửi lời tặng sách",
        // Shown in place of the box when ResolveTenant resolved no active
        // membership for the caller. The reference renders its
        // NotAReaderNotice on the same branch and its comment gives the
        // reason: it would be "a form the app should not have offered".
        onlyReaders: "Chỉ bạn đọc của tủ sách này mới tặng sách được.",
        listTitle: "Những lần bạn đã tặng",
        empty: "Bạn chưa gửi lời tặng sách nào.",
        // A DATE, not a timestamp (AGENTS.md's language rule). The server
        // sends offeredAt as an ISO instant, so the number comes from
        // formatInstantParts(...).date and the Vietnamese glue is here —
        // the same split comments.postedOn and announcements.publishedOn
        // use, minus the hour, because "when I offered my books" is not an
        // event you read a clock for.
        offeredOn: "Gửi ngày {date}",
        countLine: "khoảng {count} cuốn",
        // The status WORD beside every offer — AGENTS.md's second
        // non-negotiable, status is never colour alone. Three words for the
        // three cases App\Enums\DonationStatus carries.
        statusPending: "Đang chờ",
        statusReceived: "Đã nhận",
        statusDeclined: "Chưa nhận",
        // DIVERGENCE from the reference, which prints the decline note as a
        // bare paragraph under the row. Labelled here, in the shape
        // readerDetail.rejectionReasonLine above already uses, because this page
        // shows the description, the date and the count as prose too and an
        // unlabelled fourth line does not say whose sentence it is.
        declineReasonLine: "Lý do từ chối: {reason}",
        toList: "Những lần bạn đã tặng",
        toForm: "Tặng sách cho tủ sách",
        backToOverview: "Về trang của tôi",
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
