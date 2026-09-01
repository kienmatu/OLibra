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
        // The portal's empty state is the one place a parish with no shelf
        // yet is standing, and /contact exists for exactly that person —
        // BR §16.1 calls it their only route to a human. Without this link
        // the page is reachable only by typing the URL.
        missingShelf: "Giáo xứ của bạn chưa có tủ sách?",
        missingShelfLink: "Liên hệ ban quản trị",
        // BR §16.1: the search box is this page's only job, for a parent
        // typing a parish name without diacritics — "hoa binh" for "Giáo
        // xứ Hòa Bình". Folded against name, location and address
        // (ShellController::shelves()).
        searchLabel: "Tìm tủ sách",
        searchPlaceholder: "Tìm theo tên, khu vực hoặc địa chỉ",
        searchButton: "Tìm",
        noResults: "Không tìm thấy tủ sách nào phù hợp.",
    },
    // Phase 3b-ii Task 2's screen (spec D2) — the public `/contact`, and the
    // only page in the application a parish with no bookshelf at all can
    // reach and act on. The card above the fold is read from
    // `system_settings`' three contact columns, which /admin/settings edits;
    // the keys below `noContact` are phase 3c-ii Task 3's form, which is
    // what the page shows INSTEAD of that card when there is nothing in
    // those columns to show.
    contact: {
        title: "Liên hệ ban quản trị",
        // The reference's own subtitle, and the reason the page exists: the
        // portal's empty state sends a parish here to ask for a tủ sách.
        lead: "Muốn mở một tủ sách cho giáo xứ mình, hoặc cần giúp đỡ về hệ thống?",
        // Shown only beside a real number. The application sends no email at
        // all, so a visitor who reads "liên hệ" and looks for an address
        // would otherwise wait for a reply that never comes.
        callNote: "Hệ thống không gửi email. Gọi vào số trên là nhanh nhất.",
        // THE SENTENCE FOR A WHOLLY UNCONFIGURED INSTALLATION, and since
        // phase 3c-ii Task 3 it INTRODUCES THE FORM below it rather than
        // standing in for it. What it said until this commit is retracted
        // in place, the way this project retracts:
        //
        //   > "Hiện chưa có thông tin liên hệ chung. Xin liên hệ trực tiếp
        //   > với giáo xứ của bạn."
        //
        //   > THE SENTENCE FOR A WHOLLY UNCONFIGURED INSTALLATION, given
        //   > by the plan rather than invented here. The reference has none
        //   > to port — its else-branch is the feedback form 3b-ii defers
        //   > to 3c, to land with the inbox that reads it — so this is the
        //   > app's only public front door talking to somebody it cannot
        //   > help directly, and the wording was decided once, in the plan,
        //   > rather than improvised.
        //
        // Its own comment named itself the substitute for the form, so the
        // form arriving is what retires it. It became FALSE as well as
        // redundant: "xin liên hệ trực tiếp với giáo xứ của bạn" sends the
        // sender away from the one channel that now reaches the
        // administrator, and the visitor this page exists for is a parish
        // whose own giáo xứ is precisely who is asking.
        //
        // The replacement is the reference's own else-branch lead
        // (`old_next/src/app/lien-he/page.tsx:104`), which says three
        // things in one breath: why there is no number to ring, that the
        // message is read, and that the reply comes by telephone — which is
        // what makes asking for the number below reasonable.
        //
        // It is NOT a placeholder for the three details: a blank field is
        // omitted outright (never an invented name or number), and this
        // line appears only when there is no name and no phone at all.
        noContact:
            "Ban quản trị chưa điền số điện thoại liên hệ trực tiếp. Gửi lời nhắn dưới đây, ban quản trị sẽ đọc được trong hộp góp ý và liên lạc lại theo số điện thoại bạn để lại.",
        // The form's own labels, phase 3c-ii Task 3. NOT copy.feedback's —
        // this file's header bans merging namespaces on coincidental
        // wording, and the wording is not even coincidental here: the shelf
        // form is read by children and their parents and says "bạn" and
        // "các cô chú giữ tủ sách", while this page is a parish
        // representative writing to the people who run the installation.
        // The reference draws the same distinction in the same place —
        // "Tên của anh/chị" here against "Tên của bạn" there.
        nameLabel: "Tên của anh/chị",
        phoneLabel: "Số điện thoại",
        // WHY A NUMBER IS COMPULSORY, said beside the label: this branch
        // renders precisely when the installation has published no number
        // of its own, so the sender's is the only way an answer can come
        // back. The application sends no email at all.
        phoneNote: "Ban quản trị sẽ gọi lại theo số này.",
        subjectLabel: "Chủ đề",
        // The reference's own example, and it names the errand that brings
        // most people to this page.
        subjectPlaceholder: "vd: Mở tủ sách mới",
        subjectOptional: "Không bắt buộc",
        bodyLabel: "Nội dung",
        // The word, never an asterisk — AGENTS.md rule 6.
        required: "Bắt buộc",
        // {count} is filled from the dailyLimit prop, so the promise and
        // App\Actions\Community\SubmitFeedback::DAILY_LIMIT cannot drift.
        // The reference hard-codes the 3 in its own markup.
        limitNote: "Mỗi số điện thoại gửi tối đa {count} góp ý mỗi ngày, để tránh tin rác.",
        submit: "Gửi liên hệ",
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
        // `Góp ý` is the second card the same paragraph asks for. It used
        // to be missing from this list, and the reason it gave was: "it is
        // NOT added here: `shelves.feedback` still renders the
        // under-construction placeholder, and a link to that is a promise
        // the page cannot keep." Phase 3c-ii Task 2 built that page, so
        // the promise can now be kept and the word lands below.
        //
        // Unlike `donate`, the link that uses this one is NOT guarded on
        // auth.user in shelves/show.tsx: shelves.feedback sits outside the
        // ['auth', 'role:reader'] group deliberately, so a guest who
        // follows it meets the form rather than the login redirect.
        donate: "Tặng sách",
        feedback: "Góp ý",
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
        // BR §16.3's count badge, on notifications.bellWithCount's
        // pattern — the count in the LABEL, in parentheses, rather than a
        // superscript pill: this nav is a row of plain text links and a
        // number a volunteer can read beats a dot they have to interpret.
        // Zero renders the bare word above, never "(0)": an empty queue is
        // still a place to go, but it is not news.
        donationsWithCount: "Tặng sách ({count})",
        // BR §16.3's *Đổi thông tin*, the nav item this list was missing —
        // the paragraph above records that Task 19 shipped the donation
        // badge "beside *Yêu cầu mượn*, which is half of what §16.3 asks",
        // because the screen was still a placeholder. It is a screen now,
        // so the other half lands here. Two spellings on the badge's own
        // pattern: zero renders the bare word, never "(0)".
        profileChanges: "Đổi thông tin",
        profileChangesWithCount: "Đổi thông tin ({count})",
        settings: "Cài đặt",
        // The NAV word for shelves/{shelf}/manage/units, matching the
        // reference's own sidebar label — the screen re-heads it in
        // manageUnits.title. "Cơ cấu giáo xứ" and not "Đơn vị": the nav
        // names the subject a volunteer is looking for, and a parish's
        // own word for the units themselves is its to choose
        // (ParishTaxonomy's two labels), so the nav cannot borrow it.
        units: "Cơ cấu giáo xứ",
        audit: "Nhật ký",
    },
    admin: {
        title: "Quản trị hệ thống",
        dashboard: "Tổng quan",
        shelves: "Tủ sách",
        managers: "Người quản lý",
        categories: "Thể loại",
        // BR §16.4's "Change queue for managers and shelf admins", carrying
        // the SAME two words as the manage nav's own item above — the
        // subject is the same subject, and a super administrator who is
        // also a manager somewhere should not have to learn that this
        // installation calls it two things. What distinguishes them is
        // which shell they hang in; the screens themselves are headed
        // differently.
        profileChanges: "Đổi thông tin",
        profileChangesWithCount: "Đổi thông tin ({count})",
        // BR §16.1's inbox nav item, phase 3c-ii Task 4. The SAME word the
        // reader's own form is called — a super administrator who has also
        // sent a góp ý should not have to learn that this installation
        // calls the message and the mailbox two different things. The
        // count is unread only, on profileChangesWithCount's shape.
        feedback: "Góp ý",
        feedbackWithCount: "Góp ý ({count})",
        settings: "Cài đặt",
    },
    adminDashboard: {
        title: "Tổng quan hệ thống",
        empty: "Chưa có tủ sách nào.",
        shelfHeading: "Tủ sách",
        statusHeading: "Tình trạng",
        booksHeading: "Đầu sách",
        readersHeading: "Độc giả",
        loansHeading: "Đang mượn",
        overdueHeading: "Quá hạn",
        pendingHeading: "Chờ xử lý",
        statusActive: "Đang hoạt động",
        statusArchived: "Đã lưu trữ",
        contactsMissing: "Thiếu đầu mối liên hệ",
    },
    adminShelves: {
        title: "Danh sách tủ sách",
        empty: "Chưa có tủ sách nào.",
        slugHeading: "Đường dẫn",
        statusHeading: "Tình trạng",
        statusActive: "Đang hoạt động",
        statusArchived: "Đã lưu trữ",
        contactsMissing: "Thiếu đầu mối liên hệ",
        managersMissing: "Chưa có người quản lý",
        // Task 4's two screens. The create form asks for a slug and the
        // edit form refuses to, which is why they are two components and
        // two blocks of copy rather than one form handed a null row.
        createLink: "Mở tủ sách mới",
        editLink: "Sửa thông tin",
        createTitle: "Mở tủ sách mới",
        editTitle: "Thông tin tủ sách",
        profileSection: "Thông tin tủ sách",
        required: "Bắt buộc",
        submitCreate: "Mở tủ sách",
        submitProfile: "Lưu thông tin",
        cancel: "Quay lại danh sách",
        fields: {
            name: "Tên tủ sách",
            slug: "Đường dẫn",
            location: "Địa điểm",
            address: "Địa chỉ",
            description: "Giới thiệu",
            establishedOn: "Ngày thành lập",
        },
        slugHint: "Chỉ dùng chữ thường không dấu, số và dấu gạch ngang. Ví dụ: dong-thap.",
        // The read-only note on the edit screen. A disabled input alone
        // says "you cannot", never "why" — and the why is the reason the
        // rule exists: the address is printed on notices and glued inside
        // book covers (BR §16.4).
        slugFixed:
            "Đường dẫn không đổi được sau khi mở tủ sách, vì nó đã nằm trên giấy dán trong sách và trên các đường liên kết đã chia sẻ.",
        // Task 5's two sections on the same screen. Each has its own
        // heading, its own button and its own lead sentence, because each
        // is its own form with its own submit and its own refusal (spec
        // D2) — a shared "Lưu" would be three buttons a volunteer cannot
        // tell apart.
        policySection: "Chính sách mượn sách",
        policyLead: "Áp dụng cho mọi lượt mượn của tủ sách này.",
        submitPolicy: "Lưu chính sách",
        policyFields: {
            loanDays: "Số ngày cho mượn",
            maxConcurrentLoans: "Số sách mượn cùng lúc",
            maxRenewals: "Số lần gia hạn",
            renewalDays: "Số ngày mỗi lần gia hạn",
            holdDays: "Số ngày giữ chỗ",
            dueSoonDays: "Báo trước hạn trả (ngày)",
            commentsEnabled: "Cho phép bạn đọc bình luận",
            commentsRequireApproval: "Bình luận cần được duyệt trước khi hiển thị",
        },
        // "Số ngày báo trước hạn trả" and "số lần gia hạn" both accept 0,
        // and the two zeroes mean real policies rather than an unset
        // field — a shelf may allow no renewals at all, and a shelf may
        // want the reminder on the due date itself. Said in words under
        // the inputs, because a bare `min=0` says nothing.
        policyZeroAllowed:
            "Điền 0 ở “Số lần gia hạn” nghĩa là không cho gia hạn; điền 0 ở “Báo trước hạn trả” nghĩa là chỉ nhắc đúng ngày đến hạn.",
        contactsSection: "Đầu mối liên hệ",
        contactsLead:
            "Tối đa ba người bạn đọc có thể liên hệ. Người thứ nhất là bắt buộc; để trống ô Họ và tên của người thứ hai hoặc thứ ba nếu tủ sách không có.",
        submitContacts: "Lưu đầu mối liên hệ",
        contactHeading: "Người liên hệ {position}",
        contactFields: {
            name: "Họ và tên",
            phone: "Số điện thoại",
            roleLabel: "Vai trò",
        },
        // Free text on purpose (spec D3): a parish names its own
        // volunteers' jobs, and no list this application invented would
        // survive the second parish.
        contactRoleHint: "Ví dụ: Người giữ chìa khoá, Quản lý tủ sách.",
        contactOptional: "Không bắt buộc",
        // Phase 3b-ii Task 4's section, spec D5 — BR §5.6's cách chia đơn
        // vị. The SHAPE only: mấy cấp, gọi là gì, cấp nhỏ có nằm trong cấp
        // lớn không. Danh sách đơn vị được sửa ở màn hình riêng của tủ
        // sách, và sản phẩm KHÔNG kèm sẵn danh sách nào (BR §5.6): danh
        // sách đúng cho giáo xứ này thì sai cho giáo xứ khác.
        taxonomySection: "Cách chia đơn vị",
        taxonomyLead:
            "Dùng khi bạn đọc đăng ký: mỗi người chọn đơn vị mình thuộc về. Ở đây chỉ đặt cách chia; danh sách đơn vị cụ thể được quản lý ở trang riêng của tủ sách.",
        submitTaxonomy: "Lưu cách chia",
        taxonomyFields: {
            levels: "Số cấp",
            levelsOne: "Một cấp",
            levelsTwo: "Hai cấp",
            level1Label: "Tên gọi cấp 1",
            level2Label: "Tên gọi cấp 2",
            nested: "Cấp 2 nằm trong cấp 1",
        },
        // Hai từ duy nhất BR §5.6 ghi nhận là có giáo xứ đang dùng, nêu làm
        // ví dụ chứ không phải danh sách chọn sẵn.
        taxonomyLabelHint: "Ví dụ: Tổ, Giáo họ.",
        // Giá trị cấp 2 vẫn được giữ khi tủ sách chuyển về một cấp, để tủ
        // sách quay lại hai cấp thì tìm lại đúng lựa chọn cũ (OPS §4.5).
        taxonomyLevelTwoKept:
            "Tủ sách một cấp vẫn giữ nguyên phần cấp 2 ở đây, để khi quay lại hai cấp thì không phải đặt lại từ đầu.",
        // Task 6's two row controls (spec D4). "Ngưng hoạt động" rather
        // than "Lưu trữ", the audit sentence's word, so the log and the
        // button a volunteer pressed say the same thing.
        archive: "Ngưng hoạt động",
        unarchive: "Mở lại",
        // Under the archive control, because the button alone reads like a
        // delete. Archiving keeps everything (OPS §4.5) and "Mở lại" beside
        // an archived row is the proof — this sentence is what says so
        // before the press rather than after it.
        archiveNote: "Tủ sách ngưng hoạt động vẫn giữ nguyên toàn bộ dữ liệu và có thể mở lại.",
    },
    // Phase 3b-ii Task 1's screen (spec D1) — BR §16.4's system settings.
    adminSettings: {
        title: "Cài đặt hệ thống",
        lead: "Thông tin liên hệ của ban quản trị và các giá trị mặc định của hệ thống.",
        // The contact block is FIRST on the page, and this sentence is why:
        // it is the only setting in the application a member of the public
        // can see (BR §16.4). Everything below it is internal.
        contactSection: "Liên hệ ban quản trị",
        contactLead:
            "Thông tin này hiện công khai ở trang Liên hệ, cho những giáo xứ muốn mở tủ sách mới.",
        contactFields: {
            name: "Tên người phụ trách",
            phone: "Số điện thoại",
            hours: "Giờ liên hệ",
        },
        contactPhoneHint: "Số này hiện công khai và bấm gọi được.",
        contactOptional: "Không bắt buộc",
        // Clearing all three is a real state — an installation between
        // administrators — and the public page says what to do instead
        // rather than showing a blank label, so the form must not demand a
        // value it cannot honestly require.
        contactBlankNote:
            "Để trống ô nào thì trang Liên hệ bỏ hẳn dòng đó, không hiển thị chỗ trống.",
        submitContact: "Lưu thông tin liên hệ",
        defaultsSection: "Mặc định cho tủ sách mới",
        // THE MOST IMPORTANT SENTENCE ON THIS PAGE, and the reference's
        // file header says exactly that. Saving these numbers changes no tủ
        // sách that already exists — each keeps its own policy — so a
        // heading reading "Mặc định" without this line is read as "the
        // settings", and an administrator lowering the loan period here
        // would expect every parish to follow tomorrow.
        defaultsLead:
            "Chỉ áp dụng cho tủ sách mở mới. Các tủ sách đang hoạt động giữ nguyên quy định của mình.",
        defaultsFields: {
            loanDays: "Số ngày cho mượn",
            maxConcurrentLoans: "Số sách mượn cùng lúc",
            maxRenewals: "Số lần gia hạn",
            renewalDays: "Số ngày mỗi lần gia hạn",
            holdDays: "Số ngày giữ chỗ",
            dueSoonDays: "Báo trước hạn trả (ngày)",
        },
        // The same two zeroes the shelf editor explains, and the same
        // reason: a bare min=0 on an input says nothing about what 0 means.
        defaultsZeroAllowed:
            "Điền 0 ở “Số lần gia hạn” nghĩa là không cho gia hạn; điền 0 ở “Báo trước hạn trả” nghĩa là chỉ nhắc đúng ngày đến hạn.",
        submitDefaults: "Lưu giá trị mặc định",
        // Read-only, and rendered as text rather than as a select with one
        // option — a control that cannot be operated dressed as one that
        // can. The timezone value comes from the server (App\Support\Clock),
        // never typed here; the language is not a stored value at all.
        environmentSection: "Ngôn ngữ và múi giờ",
        environmentLanguageLabel: "Ngôn ngữ",
        environmentLanguageValue: "Tiếng Việt",
        environmentTimezoneLabel: "Múi giờ",
        environmentNote: "Hệ thống hiện chỉ hỗ trợ tiếng Việt và múi giờ Việt Nam.",
        // Provenance: the two columns both forms write by hand. Shown
        // because "when was this last changed" is the first question asked
        // of a settings screen whose values nobody remembers choosing.
        changedAtLabel: "Lần sửa gần nhất",
        changedAtNever: "Chưa có ai sửa.",
    },
    // Task 7's screen (spec D5, D7) — OPS §3.4's GetManagersList and the
    // three grants of §4.5.
    // Phase 3b-ii Task 3 (spec D3) — the book genres, one taxonomy shared
    // by every tủ sách in the installation.
    adminCategories: {
        title: "Thể loại sách",
        lead: "Danh sách thể loại dùng chung cho mọi tủ sách trong hệ thống.",
        empty: "Chưa có thể loại nào. Hãy thêm thể loại đầu tiên để bắt đầu xếp sách.",
        // The count beside each row is not decoration: it is the number
        // that decides whether the archive control below will be accepted,
        // so the screen can explain the refusal before producing it.
        booksSuffix: "đầu sách",
        slugPrefix: "Đường dẫn:",
        // The add form. Below the list rather than above it, unlike the
        // appoint form on Quản lý viên: a taxonomy is read far more often
        // than it is extended, and this list is what an administrator came
        // here to see.
        addSection: "Thêm thể loại mới",
        addName: "Tên thể loại",
        addPlaceholder: "vd: Truyện tranh",
        submitAdd: "Thêm thể loại",
        // THE SENTENCE THIS SCREEN TURNS ON. A rename moves the display
        // name and nothing else — the đường dẫn stays where it is, because
        // moving it would silently repoint every cuốn sách already xếp
        // under the old one. Said before the control, not after the press.
        renameSection: "Đổi tên",
        renameName: "Tên mới",
        renameNote:
            "Đổi tên chỉ đổi chữ hiển thị. Đường dẫn của thể loại giữ nguyên, nên sách đã xếp vào thể loại này không bị ảnh hưởng.",
        submitRename: "Lưu tên",
        cancel: "Huỷ",
        // "Lưu trữ", not "Xoá": the row is kept and every cuốn sách that
        // ever carried the thể loại keeps it. Only the picker stops
        // offering it.
        archive: "Lưu trữ thể loại",
        archiveConfirm: "Xác nhận lưu trữ",
        archiveWarning:
            "Thể loại đã lưu trữ sẽ không hiện ra khi thêm sách mới, và không mở lại được. Nếu cần dùng lại, hãy tạo thể loại mới với tên khác.",
        // Shown in place of the archive control when the count says the
        // command would refuse. The rule is the server's; this only stops
        // the screen offering a button whose one outcome is a refusal.
        archiveBlocked:
            "Còn sách thuộc thể loại này nên chưa lưu trữ được. Hãy đổi thể loại cho những cuốn sách đó trước.",
    },
    adminManagers: {
        title: "Quản lý viên",
        lead: "Những người có quyền trên hệ thống và trên từng tủ sách.",
        empty: "Chưa có quản lý viên nào.",
        // The appoint form. Above the list on purpose: on a fresh install
        // the list holds only the one super administrator the seeder makes,
        // and there is nothing below worth scrolling to until a parish has
        // somebody to run it.
        assignSection: "Giao quyền quản lý",
        assignShelf: "Tủ sách",
        assignShelfPlaceholder: "Chọn tủ sách",
        assignPerson: "Bạn đọc",
        assignPersonPlaceholder: "Chọn bạn đọc",
        assignRole: "Quyền",
        submitAssign: "Giao quyền quản lý",
        // Only ACTIVE shelves are offered and only active readers of the
        // chosen shelf, so both empty states have to say which of the two
        // is missing — "nothing to choose" with no reason is the state a
        // volunteer cannot act on.
        assignNoShelves: "Chưa có tủ sách nào đang hoạt động.",
        assignNoCandidates: "Tủ sách này chưa có bạn đọc nào để giao quyền.",
        // The three roles as a volunteer reads them. `super_admin` is not a
        // membership role and is never a choice in the form — it is only
        // ever a label on a row.
        roleSuperAdmin: "Quản trị hệ thống",
        roleAdmin: "Quản trị tủ sách",
        roleManager: "Quản lý",
        wholeSystem: "Toàn hệ thống",
        lastActive: "Hoạt động gần nhất",
        neverActive: "Chưa làm việc gì trên hệ thống",
        // The revoke control. The confirmation SENTENCE is not here: it
        // names the person and the shelf, so it is assembled server-side
        // per row and arrives as a prop (BR §16.4, and see
        // ManagerController).
        revoke: "Thu hồi quyền quản lý",
        revokeConfirm: "Xác nhận thu hồi",
        cancel: "Huỷ",
        // The global grant, and the one control on this screen with no way
        // back — so the warning is beside the button rather than after the
        // press (spec D5: OPS §4.5 lists no demotion command).
        promote: "Giao quyền quản trị hệ thống",
        promoteConfirm: "Xác nhận giao quyền",
        promoteWarning:
            "Người này sẽ thấy và sửa được mọi tủ sách. Hiện chưa có cách thu hồi quyền này.",
        // A manager whose membership is not active still HOLDS the keys —
        // the row stays so the grant can be seen and taken back — but they
        // cannot use them, which is why /admin/shelves counts the shelf as
        // unmanned. Said in words on the row, because a status chip alone
        // leaves the two screens looking as though they disagree.
        cannotActNote:
            "Người này chưa thể làm việc trên tủ sách cho tới khi tài khoản hoạt động trở lại.",
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
    // BR §16.3's *Đổi thông tin* screen. The FIELD labels are not here:
    // both queues render `myProfile.fieldLabels`, which is keyed by column
    // name because the server sends the fields keyed that way, and a second
    // label map would be a translation table that is wrong in exactly one
    // entry the day somebody edits one of them. A reader and a volunteer
    // call these nine fields the same nine things.
    manageProfileChanges: {
        title: "Đề nghị đổi thông tin",
        lead: "Mỗi thẻ là một bạn đọc xin sửa hồ sơ. Thông tin cũ vẫn được dùng cho đến khi bạn duyệt.",
        empty: "Không có đề nghị nào đang chờ.",
        requestedAt: "Gửi ngày {date}",
        // The two halves of BR:580's "side by side". Labelled rather than
        // laid out by position alone: on a phone the two values stack, and
        // a stacked pair with no labels is unreadable.
        currentHeading: "Hiện tại",
        proposedHeading: "Đề nghị",
        // A proposal to clear a field is a change worth showing, and it is
        // not the same as a field the reader never mentioned — myProfile
        // .proposedBlank's own distinction, on the deciding side.
        blank: "(bỏ trống)",
        notSet: "Chưa có",
        // THE SENTENCE STAYS, above the two photographs rather than instead
        // of them. It was on its own until the fix wave: a manager approved
        // a photograph of a child on the strength of a claim that one
        // existed, which BR:580's "see exactly what would change" cannot
        // mean for the one field that is a picture. What is still never
        // printed is the VALUE — it is a storage key, and the server sends
        // addresses.
        avatarProposed: "Bạn đọc có gửi kèm ảnh đại diện mới.",
        avatarCurrent: "Ảnh hiện tại",
        avatarProposedLabel: "Ảnh đề nghị",
        // The optional re-placement, spec D3. Headed as a question rather
        // than as a field group, because leaving it alone is the normal
        // answer and the form must not read as though something is
        // required.
        placementTitle: "Đơn vị của bạn đọc",
        placementNote:
            "Bạn đọc không tự đổi được đơn vị. Nếu gia đình đã chuyển, chọn lại ở đây rồi duyệt.",
        placementUnset: "— Chưa chọn —",
        approve: "Duyệt",
        rejectReason: "Lý do chưa duyệt",
        reject: "Từ chối",
    },
    // BR §16.4's cross-shelf queue. Its own words, not the shelf screen's:
    // the reader of this page is not standing in the parish the proposal
    // came from, which is the whole reason it exists.
    /**
     * BR §16.1's Góp ý inbox, phase 3c-ii Task 4. Its OWN namespace — this
     * file's header bans reaching into another's keys, and the reader's
     * `copy.feedback` above belongs to the form a parishioner fills in.
     * They share the two words in the nav item and nothing else: one asks a
     * child to write a message, the other asks an administrator to handle
     * a queue.
     *
     * TWO FALLBACK STRINGS THAT ARE NOT DECORATION. `guestSender` and
     * `noSubject` stand in for an empty name and an empty subject, and
     * without them a row renders as a blank line a volunteer cannot click
     * on with any idea of what it holds. SubmitFeedback requires the name
     * non-blank on every write, so `guestSender` covers a historical row
     * rather than an ordinary submission; the subject is genuinely optional
     * on both forms, so `noSubject` is met every day.
     */
    adminFeedback: {
        title: "Góp ý",
        // The unread line above the chips. Two sentences rather than one
        // template with a 0 in it: "0 tin mới" is a number a reader has to
        // parse before they know there is nothing to do.
        unreadNone: "Không có tin mới",
        unreadSome: "{count} tin mới",
        filterAll: "Tất cả",
        filterNew: "Mới",
        filterRead: "Đã đọc",
        filterResolved: "Đã xử lý",
        empty: "Chưa có góp ý nào.",
        // The right-hand pane before anything is chosen, which on a
        // non-empty inbox a volunteer never sees (the server opens the top
        // of the list for them) and on an empty one is the whole screen.
        choose: "Chọn một tin để đọc.",
        unreadBadge: "Tin mới",
        guestSender: "Khách (không đăng nhập)",
        noSubject: "(không có chủ đề)",
        // NULL SHELF READS AS THIS, never as a blank — a site-wide message
        // with nothing beside it looks like a message whose parish nobody
        // recorded.
        siteWide: "Toàn hệ thống",
        // The typed name and the signed-in account are SEPARATE FACTS and
        // this line is the second of them. The reference's recorded
        // incident is what it exists for: a reader who typed "Chị Hạnh" was
        // displayed as their account's own label and the administrator rang
        // the wrong person. The fix made the typed name win everywhere;
        // this line keeps the account visible rather than hidden by it.
        sentWhileSignedIn: "Gửi khi đang đăng nhập bằng {name}.",
        // Said on the screen because it is true of the whole application:
        // nothing here sends email, so the number above is the only way
        // anybody answers.
        replyNote: "Hệ thống không gửi email. Trả lời bằng cách gọi vào số điện thoại ở trên.",
        handledBy: "{name} đã xử lý lúc {at}.",
        // Falls back to the institution when the handler's account is gone
        // — a message handled by somebody since removed still was handled.
        handledByUnknown: "Ban quản trị",
        markRead: "Đánh dấu đã đọc",
        markResolved: "Đánh dấu đã xử lý",
    },
    adminProfileChanges: {
        title: "Đề nghị đổi thông tin của người quản lý",
        lead: "Đề nghị của người quản lý và quản trị tủ sách, ở mọi tủ sách — vì không ai trong tủ sách của họ được duyệt.",
        empty: "Không có đề nghị nào đang chờ.",
        requestedAt: "Gửi ngày {date}",
        // BR:602's "the shelf named on each card", which on a cross-shelf
        // screen is not decoration: two parishes may both have a manager
        // called Nguyễn Văn A.
        shelfLine: "Tủ sách: {shelf}",
        roleManager: "Quản lý tủ sách",
        roleAdmin: "Quản trị tủ sách",
        currentHeading: "Hiện tại",
        proposedHeading: "Đề nghị",
        blank: "(bỏ trống)",
        notSet: "Chưa có",
        // Its own words, and the two photographs below it — see the shelf
        // queue's note. A cross-shelf administrator is deciding a picture
        // they have even less other context for.
        avatarProposed: "Người này có gửi kèm ảnh đại diện mới.",
        avatarCurrent: "Ảnh hiện tại",
        avatarProposedLabel: "Ảnh đề nghị",
        approve: "Duyệt",
        rejectReason: "Lý do chưa duyệt",
        reject: "Từ chối",
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
            // Shelf administration: the profile, the lending policy and who
            // manages the shelf. Empty until those actions are recorded.
            administration: "Quản trị",
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
        // `donorName` MAY BE THE EMPTY STRING — this screen's own props
        // docblock says so, and DonationController branches on it for the
        // received flash. The card did not, so a trashed donor drew an
        // empty avatar circle above a blank line. Same shape and same
        // reason as manageComments.deletedAuthor, kept as its own key for
        // the reason stated there.
        deletedDonor: "Bạn đọc đã rời tủ sách",
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
        // The byline when the person who wrote the comment has since been
        // soft-deleted: BookCommentsQuery casts `author?->full_name` to a
        // string, so a departed reader arrives as "" and renders as a gap
        // before the date — " ngày 12/03/2026" — which reads as a broken
        // page rather than as a fact. manageComments.deletedAuthor says the
        // same thing on the moderation screen; this is a SECOND key rather
        // than a reach across that namespace, per this file's header, so
        // rewording the manager's queue cannot silently rewrite what a
        // public book page tells a family.
        deletedAuthor: "Bạn đọc đã rời tủ sách",
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
    // BR §16.2's "Hồ sơ của bạn" — the reader's own record, read-only in
    // this phase's first task (proposing a change to it is a later one, and
    // posts from its own form).
    //
    // Wording taken from the reference's own screen
    // (old_next/src/app/tu-sach/[shelf]/(doc-gia)/ho-so/page.tsx, opened):
    // its heading, its subtitle, its four status words, its "hiện tại"
    // comparison line, its "thông tin hiện tại vẫn được dùng" sentence and
    // its parish note.
    myProfile: {
        title: "Hồ sơ của bạn",
        lead: "Những thay đổi bạn gửi chỉ có hiệu lực sau khi quản lý duyệt.",
        // The same null-membership branch donations.onlyReaders covers —
        // see ProfileController's own note on why that state is live.
        onlyReaders: "Chỉ bạn đọc của tủ sách này mới có hồ sơ ở đây.",
        sectionPerson: "Thông tin cá nhân",
        sectionParish: "Giáo xứ",
        // Keyed by COLUMN name, not camelCase, and that is the point:
        // App\Queries\MyProfileQuery returns the nine fields snake_case so
        // the page can match them key-for-key against a proposal's
        // proposed_values bag. A camelCase label map here would put a
        // translation table between the two halves of a comparison —
        // profile-labels.ts's argument, kept. Nine entries for the nine of
        // App\Support\Members\ProfileFields::FIELDS.
        fieldLabels: {
            saint_name: "Tên thánh",
            full_name: "Họ và tên",
            date_of_birth: "Ngày sinh",
            father_name: "Tên cha",
            mother_name: "Tên mẹ",
            phone: "Số điện thoại",
            phone_missing_reason: "Lý do chưa có số điện thoại",
            email: "Email",
            // The label names what the field is to a reader — their
            // photograph — not the storage identifier the column holds.
            avatar_object: "Ảnh đại diện",
        },
        // A read-only value that is not set. `unitName`'s own word for the
        // same state, so the page reads one way throughout.
        notSet: "Chưa có",
        changesTitle: "Đề nghị thay đổi gần nhất",
        // Four words for the four cases App\Enums\ProfileChangeStatus
        // carries — status is never colour alone (AGENTS.md rule 2), so
        // each rides a Badge with an icon beside it.
        statusPending: "Đang chờ quản lý duyệt",
        statusApproved: "Đã được duyệt",
        statusRejected: "Quản lý chưa duyệt",
        statusCancelled: "Bạn đã huỷ",
        // BR:544's rendering contract: the current value with the pending
        // one beside it. Three keys rather than one glued sentence, because
        // the proposed half is emphasised and the current half is not, and
        // even the colon is copy — a locale that does not use one gets to
        // say so here rather than in JSX.
        fieldLabelLine: "{label}:",
        currentIs: "hiện tại {value}",
        // A proposal to clear a field is a change worth showing, and it is
        // not the same as a field the reader never mentioned.
        proposedBlank: "(bỏ trống)",
        // The sentence that makes "waiting" plain, BR:544's other half.
        stillInForce: "Thông tin hiện tại vẫn được dùng cho đến khi đề nghị này được duyệt.",
        requestedOn: "Bạn gửi ngày {date}",
        // The whole reason a rejection requires a reason: the reader reads
        // it, and this page is the only place they can. Labelled rather
        // than a bare paragraph, the shape readerDetail.rejectionReasonLine
        // and donations.declineReasonLine already use.
        rejectionReasonLine: "Lý do quản lý chưa duyệt: {reason}",
        // formatInstantParts, not formatDate: decided_at is an instant. The
        // reference shipped the other one here and 500ed every reader whose
        // request had been decided.
        decidedOn: "Đề nghị này được xử lý lúc {time} ngày {date}.",
        empty: "Bạn chưa gửi đề nghị thay đổi nào.",
        // The placement is read-only to a reader (OPS §4.3) and the screen
        // says whom to ask. Two sentences because a one-level shelf has no
        // second unit to name.
        parishNoteOne: "Muốn đổi {level1} thì nhờ quản lý tủ sách giúp.",
        parishNoteTwo: "Muốn đổi {level1} hoặc {level2} thì nhờ quản lý tủ sách giúp.",
        // REPLACES Task 1's `readOnlyNote`, which said to ask a manager.
        // That sentence was honest exactly as long as the screen had no
        // form; with one below it, it would send a reader away from the box
        // that does the thing. Task 1 flagged the rewrite for this task by
        // name, and the KEY is renamed as well as the words, so nothing can
        // keep rendering the old sentence under a name that no longer
        // describes it.
        verifiedNote: "Thông tin ở trên do quản lý xác minh. Muốn sửa thì gửi đề nghị bên dưới.",
        // ── The propose form (BR:83, "a request, not an edit") ──────────
        proposeTitle: "Đề nghị sửa thông tin",
        proposeLead:
            "Sửa những ô cần đổi rồi gửi. Thông tin hiện tại vẫn được dùng cho đến khi quản lý duyệt.",
        // The WORD, never a bare asterisk (AGENTS.md rule 6).
        required: "Bắt buộc",
        proposeSubmit: "Gửi đề nghị",
        proposeSending: "Đang gửi…",
        // Spec D1's merge, said out loud on the screen. A reader who has
        // one waiting and sends another is not starting a second request —
        // the fields they change now join the one already there — and a
        // screen that stayed silent about it would let them think the first
        // one had been thrown away.
        proposeMergeNote:
            "Bạn đang có một đề nghị chờ duyệt. Những ô bạn đổi lần này sẽ được gộp vào đề nghị đó.",
        // The phone pair, in the reader's own words: a blank number is
        // allowed only with a reason, which is the refusal the server
        // raises (rules.thieu-so-dien-thoai) and this line prevents.
        phoneHint: "Chưa có số thì để trống ô số và ghi lý do bên dưới.",
        // ── Huỷ đề nghị (spec D4's self-exemption) ──────────────────────
        // The verb is "huỷ" and the object is the ĐỀ NGHỊ, never the
        // information: withdrawing changes nothing about the person, and a
        // button reading "Huỷ" alone on a card full of their own details
        // would read as undoing the details.
        cancelSubmit: "Huỷ đề nghị",
        cancelSending: "Đang huỷ…",
        cancelNote: "Huỷ rồi thì gửi lại đề nghị mới lúc nào cũng được.",
        // ── Đổi mật khẩu (spec D12, BR §16.2's immediate-effect control) ─
        passwordTitle: "Đổi mật khẩu",
        // Says out loud what makes this control unlike everything else on
        // the page: it does not wait for a manager.
        passwordLead: "Đổi mật khẩu có hiệu lực ngay, không cần quản lý duyệt.",
        passwordCurrent: "Mật khẩu hiện tại",
        passwordNew: "Mật khẩu mới",
        // The length rule as a hint, in the same words the refusal uses.
        passwordNewHint: "Ít nhất 8 ký tự.",
        // The revocation, said before it happens rather than discovered
        // afterwards on a phone that stopped working.
        passwordNote: "Đổi xong, các thiết bị đang đăng nhập sẽ phải đăng nhập lại.",
        passwordSubmit: "Đổi mật khẩu",
        passwordSending: "Đang đổi…",
        // ── Ảnh đại diện (spec D6, Task 8) ──────────────────────────────
        // The photograph waits for a manager exactly as the eight text
        // fields do — the product owner confirmed EVERY field needs
        // approval and named the picture explicitly — so the lead says so
        // rather than letting a reader assume an upload is immediate.
        avatarTitle: "Ảnh đại diện",
        avatarLead: "Ảnh mới cũng cần quản lý duyệt. Ảnh hiện tại vẫn được dùng cho đến lúc đó.",
        avatarCurrent: "Ảnh hiện tại",
        avatarProposedLabel: "Ảnh chờ duyệt",
        // Never an empty circle with no words beside it: a reader with no
        // photograph should read the state, not guess at a grey disc.
        avatarNone: "Chưa có ảnh",
        avatarChoose: "Chọn ảnh",
        avatarSubmit: "Gửi ảnh mới",
        avatarSending: "Đang gửi…",
        // The two facts a reader needs BEFORE the server refuses them, in
        // their own words. The 5 MB is App\Support\Members\AvatarLimits'
        // number; the crop sentence is why nothing is refused for not being
        // square.
        avatarHint: "Ảnh JPEG, PNG, WebP hoặc AVIF, tối đa 5 MB.",
        avatarCropNote: "Ảnh sẽ được cắt vuông và thu nhỏ lại giúp bạn.",
        // The iPhone sentence, said on the screen and not only in the
        // refusal, because the setting that fixes it lives on the phone.
        avatarHeicNote:
            "Ảnh chụp bằng iPhone thường tự đổi sang JPEG khi gửi. Nếu máy báo lỗi ảnh HEIC, hãy đổi cài đặt máy ảnh sang “Tương thích nhất”.",
        backToOverview: "Về trang của tôi",
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
    /**
     * BR §16.1's Góp ý — the shelf's message form, phase 3c-ii Task 2.
     *
     * ITS OWN NAMESPACE even though three of its four labels look like
     * `register`'s and `donations`', because this file's header bans
     * reaching across namespaces and this form asks its questions of a
     * different person: a visitor who may have no account at all. Reusing
     * `donations.required` here would let a reword of the donation form
     * silently rewrite what this one marks compulsory.
     *
     * THE LIMIT SENTENCE IS A TEMPLATE, not a sentence with a 3 in it.
     * The reference hard-codes "tối đa 3 góp ý mỗi ngày" in its own
     * markup; here the number arrives from the server as
     * App\Actions\Community\SubmitFeedback::DAILY_LIMIT, so the figure the
     * form promises and the figure the command enforces are one constant.
     * A copy edit cannot make the page lie about the rule.
     */
    feedback: {
        title: "Gửi góp ý",
        // The reference's own subtitle, kept: it names the people at the
        // other end rather than "ban quản trị", because the reader of this
        // page is often a child or a parent, not a user of a system.
        subtitle: "Có điều gì bạn muốn nhắn cho các cô chú giữ tủ sách không?",
        nameLabel: "Tên của bạn",
        phoneLabel: "Số điện thoại",
        // WHY A NUMBER IS COMPULSORY on a form a stranger fills in, said
        // where the label is: it is the only way anyone can answer. The
        // application sends no email at all (copy.contact.callNote says so
        // on the public page), so a góp ý with no number is a message
        // nobody can reply to.
        phoneNote: "Để các cô chú gọi lại trả lời bạn.",
        subjectLabel: "Chủ đề",
        // The one field with no *Bắt buộc* beside it, and its absence is
        // the field's meaning — the reference marks the other three
        // required and leaves this one bare.
        subjectOptional: "Không bắt buộc",
        bodyLabel: "Nội dung",
        bodyPlaceholder: "Ví dụ: tủ sách mở cửa lúc mấy giờ ạ?",
        // The word, not an asterisk — AGENTS.md rule 6. Its own key, per
        // the namespace note above.
        required: "Bắt buộc",
        // {count} is filled from the dailyLimit prop. Says the number, the
        // window and the reason, which is the reference's own wording.
        limitNote: "Mỗi số điện thoại gửi tối đa {count} góp ý mỗi ngày, để tránh tin rác.",
        submit: "Gửi góp ý",
        backToShelf: "Về trang tủ sách",
    },
    /**
     * BR §16.3's Thống kê screen. Own namespace, own keys — this file's
     * header bans reaching into another namespace's keys, so the four
     * total captions below are NOT copy.manageDashboard's totalTitles /
     * totalCopies / totalOnLoan / totalReaders, even though they sit
     * beside similar-looking cards on the dashboard: these four count
     * events within the selected period (loans, borrowers, books added,
     * copies lost), not a point-in-time inventory.
     *
     * A SENTENCE ABOVE EVERY CHART, not a caption beside it — AGENTS.md
     * rule 8 and this file's own header both call for a plain-text
     * summary, because assertInertia sees props and never pixels: the
     * summary sentence is the only part of a chart this repo can test.
     * dailyChartSummary and byCategoryChartSummary below are templates a
     * caller fills with the query's own totals (t(), already exported by
     * this file), so the sentence never drifts from the numbers the SVG
     * draws beneath it.
     */
    manageStatistics: {
        title: "Thống kê",
        periodWeek: "Tuần này",
        periodMonth: "Tháng này",
        periodYear: "Năm nay",
        periodAll: "Từ khi mở tủ sách",
        totalLoans: "Lượt mượn",
        totalBorrowers: "Bạn đọc đã mượn",
        totalBooksAdded: "Sách mới thêm",
        totalCopiesLost: "Bản sách bị mất",
        dailyChartHeading: "Lượt mượn theo ngày",
        dailyChartSummary:
            "Trong khoảng thời gian này có {loans} lượt mượn, tính theo {days} ngày.",
        dailyChartEmpty: "Chưa có lượt mượn nào trong khoảng thời gian này.",
        byCategoryChartHeading: "Lượt mượn theo thể loại",
        byCategoryChartSummary: "Thể loại được mượn nhiều nhất là {label}, với {count} lượt.",
        byCategoryChartEmpty: "Chưa có lượt mượn nào để thống kê theo thể loại.",
        topBooksHeading: "Sách được mượn nhiều nhất",
        topBooksEmpty: "Chưa có sách nào được mượn trong khoảng thời gian này.",
        topReadersHeading: "Bạn đọc chăm nhất",
        topReadersEmpty: "Chưa có bạn đọc nào mượn sách trong khoảng thời gian này.",
        countSuffix: "{count} lượt",
    },
    // BR §19's QR label workflow: the manager's selection accordion
    // (Task 11) posting to LabelController::export (Task 10). Its own
    // namespace, no reach into `copy.manage` — the nav word below is a
    // deliberately different string from `manage.settings` etc., so
    // renaming one screen's nav label never touches another's.
    manageUnits: {
        title: "Cơ cấu giáo xứ",
        // {shelf} rather than a bare "tủ sách": this screen is reached from
        // one shelf's own manager area and the units belong to that parish.
        lead: "Cách chia bạn đọc theo đơn vị, và danh sách đơn vị của {shelf}.",
        shapeHeading: "Cách gọi các đơn vị",
        // The shape is READ-ONLY here for everyone, super administrators
        // included: it lives in the shelf's settings and is edited on the
        // admin shelf editor (spec D5, Task 4). The sentence says where,
        // so a super administrator who came here to change it is not left
        // hunting.
        shapeNote: "Cách chia đơn vị được đặt ở trang Quản trị hệ thống › Tủ sách.",
        levelsLabel: "Số bậc",
        levelsOne: "Một bậc",
        levelsTwo: "Hai bậc",
        nestedLabel: "Bậc 2 thuộc về một đơn vị bậc 1 cụ thể",
        yes: "Có",
        no: "Không",
        level1LabelLabel: "Tên gọi bậc 1",
        level2LabelLabel: "Tên gọi bậc 2",
        listHeading: "Danh sách đơn vị",
        // The reference's own sentence, drawn under every section a
        // manager can read and not change.
        superAdminOnly: "Chỉ quản trị viên mới đổi được các mục này.",
        emptyLevel1: "Chưa có đơn vị {label} nào.",
        emptyLevel2: "Chưa có đơn vị {label} nào.",
        needLevel1First: "Cần có ít nhất một đơn vị {parent} trước khi thêm đơn vị {child}.",
        add: "Thêm đơn vị",
        addName: "Tên {label} mới",
        submitAdd: "Thêm",
        rename: "Đổi tên",
        renameName: "Tên mới",
        submitRename: "Lưu tên",
        cancel: "Huỷ",
        delete: "Xoá đơn vị này",
        // Said BEFORE the press, not after it — the cascade is the fact
        // somebody who meant to remove one row is most likely to have
        // assumed otherwise, and a flash arrives too late to change a mind.
        deleteWarningCascades:
            "Các đơn vị bậc 2 bên trong đơn vị này cũng sẽ bị xoá theo. Bạn đọc đã ghi ở đây vẫn giữ lại lịch sử, chỉ không còn chọn được đơn vị này nữa.",
        deleteWarning:
            "Bạn đọc đã ghi ở đây vẫn giữ lại lịch sử, chỉ không còn chọn được đơn vị này nữa.",
        deleteConfirm: "Xác nhận xoá",
        // aria-labels, because the two controls are icons: a screen reader
        // reading "Lên" twice on a list of eight rows says nothing about
        // which row moves.
        moveUp: "Đưa {name} lên",
        moveDown: "Đưa {name} xuống",
    },
    // Phase 3b-ii Task 6's screen (spec D4) — the shelf's own settings, as
    // text. Its own namespace rather than a reach into `adminShelves`: that
    // one labels the INPUTS of an editor and may gain a placeholder or a
    // "Bắt buộc" tomorrow, and a manager's read-only summary must not
    // inherit words written for a control it does not render. The two files
    // agreeing on the six numbers is `LendingSettings`' job, not a shared
    // string's.
    manageSettings: {
        title: "Cài đặt",
        lead: "Cài đặt của {shelf}.",
        profileSection: "Thông tin tủ sách",
        nameLabel: "Tên tủ sách",
        // "Địa điểm" over `location` and "Địa chỉ" over `address`, and the
        // pair is not interchangeable: the reference shipped `location`'s
        // value ("Nhà xứ Thánh Tâm", a landmark) under a label promising a
        // street address, while the street address an administrator had
        // actually typed rendered on no screen at all.
        locationLabel: "Địa điểm",
        addressLabel: "Địa chỉ",
        // Every one of these is nullable and a blank line reads as a
        // rendering bug, so an unset value says so in words.
        blank: "Chưa có",
        contactsSection: "Đầu mối liên hệ",
        contactsEmpty: "Chưa có đầu mối liên hệ nào.",
        // The fallback label for a contact whose vai trò is blank — free
        // text, so a parish that named none still gets a row heading.
        contactFallbackRole: "Người liên hệ",
        policySection: "Quy định cho mượn",
        policyFields: {
            loanDays: "Số ngày cho mượn",
            maxConcurrentLoans: "Số sách mượn cùng lúc",
            maxRenewals: "Số lần gia hạn",
            renewalDays: "Số ngày mỗi lần gia hạn",
            holdDays: "Số ngày giữ chỗ",
            dueSoonDays: "Báo sắp đến hạn trước",
        },
        // A number on its own is not a policy — "3" reads as three of
        // something. Each hint is the sentence the reference puts under the
        // label, so a manager can check the shelf behaves as they expect
        // without opening the requirements.
        policyHints: {
            loanDays: "Số ngày bạn đọc được giữ sách trong một lượt mượn.",
            maxConcurrentLoans: "Số cuốn tối đa một bạn đọc được giữ cùng lúc.",
            maxRenewals: "Số lần bạn đọc được xin gia hạn cho một lượt mượn.",
            renewalDays: "Số ngày được cộng thêm mỗi lần gia hạn.",
            holdDays: "Số ngày tủ sách giữ sách cho bạn đọc đã đăng ký chờ mượn.",
            dueSoonDays: "Số ngày trước hạn trả mà hệ thống nhắc bạn đọc.",
        },
        days: "{count} ngày",
        books: "{count} cuốn",
        times: "{count} lần",
        commentsSection: "Bình luận",
        commentsEnabledLabel: "Cho phép bình luận",
        commentsRequireApprovalLabel: "Bình luận cần duyệt",
        taxonomySection: "Cách gọi các đơn vị",
        levelsLabel: "Số bậc",
        levelsOne: "Một bậc",
        levelsTwo: "Hai bậc",
        nestedLabel: "Bậc 2 thuộc về một đơn vị bậc 1 cụ thể",
        level1LabelLabel: "Tên gọi bậc 1",
        level2LabelLabel: "Tên gọi bậc 2",
        yes: "Có",
        no: "Không",
        // THE SENTENCE THE WHOLE SCREEN RESTS ON, the reference's own, drawn
        // under every section. Nothing on this page is a control, because
        // the commands behind these values all authorize as a super
        // administrator and would answer a manager with a 404 rather than a
        // refusal — a control here could only mislead the person pressing
        // it.
        superAdminOnly: "Chỉ quản trị viên mới đổi được các mục này.",
        // Where the units themselves are, since this screen shows only the
        // shape. That screen a manager CAN reach, and it is in their own
        // nav — said by name so it is not a hunt.
        unitsNote: "Danh sách đơn vị nằm ở trang Cơ cấu giáo xứ.",
    },
    manageLabels: {
        // The NAV word, re-headed on the screen itself below.
        navItem: "Nhãn QR",
        title: "In nhãn QR",
        lead: "Chọn các bản sách cần in nhãn QR, theo từng đầu sách hoặc từng bản riêng lẻ.",
        onlyUnprinted: "Chỉ hiện bản chưa in nhãn",
        // NAMES WHAT THE TITLE CHECKBOX ACTUALLY DOES. Ticking a title
        // prints EVERY bản of it, including the ones "Chỉ hiện bản chưa
        // in nhãn" is currently hiding — CopiesForLabelsQuery expands
        // bookIds without that filter, and the form carries no filter
        // state. The old wording ("Chọn cả đầu sách") sat beside a
        // "{count} bản" count that was the FILTERED count, so a manager
        // reading the screen would have expected the filtered subset.
        selectWholeTitle: "Chọn mọi bản của đầu sách này, kể cả bản đã in nhãn",
        expand: "Xem các bản",
        collapse: "Ẩn bớt",
        // A print count of 0 reads as "never printed"; any count at or
        // above 1 is a REPRINT, the distinction OPS §3.3 asks this screen
        // to keep visible — a sticker that fell off is a second trip
        // through this same copy, not a first one.
        printCountNever: "Chưa in",
        printCountReprint: "Đã in {count} lần",
        empty: "Tủ sách này chưa có bản sách nào.",
        submit: "In nhãn QR đã chọn",
    },
    // Task 12's camera scanner (copy-scanner.tsx), wired beside the
    // existing copy-code Input on the lend and return screens — never
    // instead of it (AGENTS.md, this task's brief: "typing the code
    // stays a complete path"). Its own namespace: the lend/return
    // screens reach into these keys, but nothing here reaches into
    // `copy.circulation`.
    scanner: {
        openButton: "Quét mã QR",
        dialogTitle: "Quét mã QR trên nhãn sách",
        lead: "Đưa camera lại gần nhãn QR dán trên sách.",
        resolving: "Đang tra cứu…",
        // The three ordinary failures a phone borrowed from someone else,
        // a cracked lens, or a browser without camera access produce —
        // each names the problem so the reader knows to type the code
        // instead, not just that something silently isn't working.
        permissionDenied:
            "Bạn chưa cho phép dùng camera. Bạn vẫn có thể nhập mã bản sách vào ô bên dưới.",
        noCamera:
            "Không tìm thấy camera trên thiết bị này. Bạn vẫn có thể nhập mã bản sách vào ô bên dưới.",
        cameraError: "Không thể mở camera. Bạn vẫn có thể nhập mã bản sách vào ô bên dưới.",
        decodeError: "Không đọc được mã QR. Bạn vẫn có thể nhập mã bản sách vào ô bên dưới.",
        // A NON-OK RESPONSE IS NOT A LENS FAILURE. Without this, a 419
        // (phiên đăng nhập hết hạn) or a 404 made response.json() throw
        // into the same catch as a bad frame, and the volunteer was told
        // the camera could not read the code when the session was what
        // ended.
        lookupFailed:
            "Không tra cứu được mã QR — có thể phiên đăng nhập đã hết hạn. Hãy tải lại trang, hoặc nhập mã bản sách vào ô bên dưới.",
        // Two distinct nothing-found outcomes, kept as two sentences
        // rather than folded into one: a QR that isn't an OLibra label at
        // all (checked locally, before any request) is a different fact
        // from an OLB1 label the server could not resolve — unknown id,
        // soft-deleted copy, or another parish's shelf.
        notOlibraLabel: "Mã QR này không phải nhãn của OLibra.",
        notFoundHere: "Không tìm thấy bản sách này trên tủ sách này.",
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
