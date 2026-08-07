# OLibra Phase 1 Pencil Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce 32 Pencil frames (16 screens × light/dark) for OLibra Phase 1 at 1280px, assembled from a reusable component sheet, per `docs/superpowers/specs/2026-08-07-pencil-screens-design.md`.

**Architecture:** Components-first. Task 1–2 build a Foundations section (token swatches, type specimens, reusable components) in the open .pen document. Tasks 3–10 assemble screens exclusively from those components plus layout primitives. Task 11 is a full screenshot audit against the spec's non-negotiables.

**Tech Stack:** Pencil MCP (`mcp__pencil__*` tools) driving the open document `pencil-new.pen`. No code, no git-tracked artifacts except this plan.

## Global Constraints

Every task implicitly includes all of these. Source documents: `docs/DESIGN.md` (all visual values), `docs/BUSINESS-REQUIREMENTS.md` §16 (content), the spec (scope).

- **Pencil access:** .pen files are encrypted — NEVER use Read/Grep on them. In a fresh context, FIRST call `mcp__pencil__get_app_state({include_schema: true, include_canvas_design: true, include_scripts_and_shaders: false, include_browser: false})`, then `mcp__pencil__get_guidelines` if offered, before any edit. All edits go through `mcp__pencil__execute`. Verify visually with `mcp__pencil__get_screenshot`.
- **Document:** the currently open Pencil document (`pencil-new.pen`). Do not create a new file. Work may already exist from earlier tasks — inspect before adding, never duplicate sections or components.
- **Frames:** width 1280, content max-width 1200 centred (40px side margins). Frame names exactly `NN-slug-light` / `NN-slug-dark` (e.g. `01-shelf-home-light`).
- **Canvas layout:** three labelled sections left-to-right: **Foundations**, **Public**, **Manager**. Within a surface section: light frames in a top row, matching dark frames directly beneath, 160px gaps.
- **Colours:** ONLY the token values from DESIGN.md §1.1–1.2 (light and dark columns) and the cover-placeholder set in §5.5. No other hex values anywhere.
- **Dark frames:** identical layout to light, dark token column, and every elevated surface (dropdown/modal-like panels) gains a 1px `--border` (#44403C) outline.
- **Type:** Inter 400/500/600/700 only, sizes from DESIGN.md §2. Never all-caps. Heading line-height ≥1.35, body 1.6.
- **Spacing/radius:** only the §3 scales — spacing 4/8/12/16/24/32/48/64; radius 6/8/12/9999.
- **Copy:** plain Vietnamese only, sentence case, from BUSINESS-REQUIREMENTS §16 and this plan. No lorem ipsum, no English UI strings.
- **Status:** always icon + Vietnamese word + tinted badge per DESIGN.md §1.2/§5.6 (bg tint + dark text, radius-full, h28, icon 16). Never a coloured dot, never solid bg with white text.
- **Buttons:** heights/variants per DESIGN.md §5.1. One visually dominant primary action per screen. Icons 20px inline with 8px gap; nav/action buttons always have text labels.
- **Cards:** `--card` bg, 1px `--border`, radius 8, padding 24, no shadow. Tables: header row `--muted` with 14/600 labels, rows 56px, 1px separators.
- **Sample data** (used consistently across all screens): shelf **"Tủ sách Giáo xứ Đông Tháp"**; keeper **"Cô Maria Nguyễn Thị Lan — 0912 345 678"**; hours **"Chúa nhật sau lễ sáng, 9:00–11:00"**; books *Dế Mèn Phiêu Lưu Ký* (Tô Hoài), *Đất Rừng Phương Nam* (Đoàn Giỏi), *Kính Vạn Hoa* (Nguyễn Nhật Ánh), *Cho Tôi Xin Một Vé Đi Tuổi Thơ* (Nguyễn Nhật Ánh), *Tuổi Thơ Dữ Dội* (Phùng Quán), *Góc Sân Và Khoảng Trời* (Trần Đăng Khoa), *Hoàng Tử Bé*, *Tâm Hồn Cao Thượng*, *Truyện Cổ Tích Việt Nam*, *Tôi Thấy Hoa Vàng Trên Cỏ Xanh* (Nguyễn Nhật Ánh), *Vừa Nhắm Mắt Vừa Mở Cửa Sổ* (Nguyễn Ngọc Thuần), *Những Tấm Lòng Cao Cả*; readers **Giuse Trần Văn Minh**, **Maria Nguyễn Thảo Vy**, **Phêrô Lê Hoàng Nam**, **Anna Phạm Thu Hà**, **Têrêsa Võ Ngọc Anh**, **Gioan Đỗ Quang Huy**; copy codes `DT-0001`…; dates around 07/08/2026, loans 14 ngày.
- **Verification pattern per frame:** `get_screenshot` the frame → check against the task's checklist → fix → re-screenshot until it passes. Only then mark the step done.

---

### Task 1: Foundations — tokens and type

**Files:** none (Pencil document only).

**Interfaces:**
- Consumes: nothing.
- Produces: canvas section **Foundations** containing frames `00-tokens-light`, `00-tokens-dark`, `00-type-scale` for later visual reference. No components yet.

- [ ] **Step 1: Load Pencil state** — `get_app_state` with schema + canvas design flags per Global Constraints; note existing top-level nodes. If a stray default frame exists (e.g. an empty `Frame`), rename/reuse or delete it only if empty.
- [ ] **Step 2: Build `00-tokens-light`** (1280 wide, auto height): a grid of swatch cards, one per §1.1 token (light column) — swatch square 64px, token name (14/600) and hex (14/400 `--muted-foreground`) beneath — plus a second group of the six §1.2 status pairs rendered as actual badges (icon + word on tint). Title the frame "Màu — sáng" at `--text-h2`.
- [ ] **Step 3: Build `00-tokens-dark`** directly beneath: same grid with dark column values on `#1C1917` background, title "Màu — tối".
- [ ] **Step 4: Build `00-type-scale`**: one specimen line per §2 token showing "Tủ sách cộng đồng — Dế Mèn Phiêu Lưu Ký" at that size/weight, labelled with token name and size/line-height/weight (so diacritic clearance is visible at real sizes).
- [ ] **Step 5: Verify** — screenshot all three frames; check every §1.1 token present, badge text/tint pairs match §1.2 exactly, no all-caps, hexes correct.

### Task 2: Foundations — component sheet

**Files:** none (Pencil document only).

**Interfaces:**
- Consumes: Task 1 frames for visual reference.
- Produces: reusable Pencil components (light-mode masters; dark usage re-colours via tokens) with these exact names, consumed by every screen task:
  - `btn/primary/md|lg|xl|2xl`, `btn/secondary/md`, `btn/outline/md`, `btn/ghost/md`, `btn/destructive/md`, `btn/link`
  - `input/default`, `input/focus`, `input/error` (48h, labels above, per §5.2–5.3; error shows `alert-circle` + message in `--destructive-text`)
  - `badge/available`, `badge/on-loan`, `badge/held`, `badge/overdue`, `badge/lost`, `badge/retired` (§5.6)
  - `book-card` (160×240 cover 2:3, title 2-line clamp 14/600, author 1-line 14/400 muted, badge pinned top-right 8px inset) and `book-card/placeholder` (initial letter 48/700 white on a §5.5 colour)
  - `stat-card` (§5.9: 88px min, count 32/700, label 17/400, chevron-right; accent variant with 4px tinted left border)
  - `table/header-row`, `table/row` (56px)
  - `condition-tile` + `condition-tile/selected` (§5.8: 72×72 min, icon 28 over label 13/600; selected = `--secondary` fill + `check` top-right)
  - `nav/public-top` (1280×64: shelf name left; "Danh mục sách · Thông báo · Tìm kiếm · Đăng nhập" right, active link in `--accent-foreground`)
  - `nav/manager-sidebar` (256×800: shelf name, then items "Trang chính · Sách · Cho mượn · Nhận trả · Người đọc · Đăng ký chờ duyệt"; active item `--secondary` bg pill with `--primary` icon)
- [ ] **Step 1: Build buttons** — all variants above per §5.1 size/variant tables, each as a named reusable component; add one focus-visible specimen (2px `--ring`, 2px offset) and one loading specimen (spinner + label "Đang lưu…") on the sheet as static examples.
- [ ] **Step 2: Build inputs, badges** per specs above.
- [ ] **Step 3: Build book-card (+placeholder), stat-card, table rows, condition tiles.**
- [ ] **Step 4: Build both nav components.**
- [ ] **Step 5: Verify** — screenshot the component sheet; check heights (36/44/48/56/64 buttons, 48 inputs, 28 badges, 56 table rows, 72 tiles), badge = icon+word+tint, all labels Vietnamese, focus ring visible on specimen.

### Task 3: Public — Shelf home (01)

**Files:** none.

**Interfaces:**
- Consumes: `nav/public-top`, `btn/primary/xl`, `btn/secondary/md`, `book-card`, `badge/*`, `btn/link`.
- Produces: frames `01-shelf-home-light`, `01-shelf-home-dark`.

- [ ] **Step 1: Build `01-shelf-home-light`** top-to-bottom (BUSINESS-REQUIREMENTS §16.1 order): `nav/public-top` → identity block (name at `--text-h1`; location "Nhà xứ Đông Tháp, ấp 3, xã Đông Tháp"; hours; keeper line with phone `0912 345 678` styled as tappable link in `--accent-foreground` with `phone` icon) → announcements card ("Thông báo", pinned item "Tủ sách nghỉ Chúa nhật 16/08" with `pin` icon, one recent item) → **two `btn/primary/xl` side by side: "Sách đang có" and "Toàn bộ tủ sách"** (the dominant element) → "Mượn nhiều nhất" horizontal cover row (6 `book-card`s, one using `book-card/placeholder`) → "Bạn đọc tích cực" list (5 reader names + counts) → "Bình luận mới" (2 short comments with book titles) → quiet footer link "Gửi góp ý cho ban quản lý".
- [ ] **Step 2: Verify light** — screenshot: section order matches §16.1 exactly; the two buttons visually dominate; phone visibly a link.
- [ ] **Step 3: Build `01-shelf-home-dark`** beneath it, dark tokens, cards gain visible 1px #44403C borders.
- [ ] **Step 4: Verify dark** — screenshot; layout identical to light.

### Task 4: Public — Catalogue (02) and Book detail (03)

**Files:** none.

**Interfaces:**
- Consumes: `nav/public-top`, `book-card`(+placeholder), `badge/available`, `badge/on-loan`, `btn/primary/xl`, `input/default`, `btn/link`.
- Produces: frames `02-catalogue-light|dark`, `03-book-detail-light|dark`.

- [ ] **Step 1: Build `02-catalogue-light`**: nav → page title "Danh mục sách" (h1) + search `input/default` placeholder "Tìm theo tên sách hoặc tác giả…" → filter bar: segmented control **"Còn sách | Tất cả"** (selected segment `--secondary` fill + check, not colour alone), category select "Thể loại: Tất cả", sort select "Sắp xếp: Mới thêm" → 6-column grid (24px gaps) of 12 `book-card`s with mixed available/on-loan badges, 2 placeholder covers → beneath, an inline **empty-search example region**: a bordered card showing icon `search-x` 48 muted, "Không tìm thấy sách nào cho 'tim kiem kho bau'", text "Có thể bạn sẽ thích:" + row of 3 popular covers.
- [ ] **Step 2: Verify light** — 6 columns exactly; segmented control not a dropdown; empty state suggests books.
- [ ] **Step 3: Build `03-book-detail-light`**: nav → two-column top block: cover 280×420 left; right: title h1 "Dế Mèn Phiêu Lưu Ký", author "Tô Hoài" body-lg muted, availability panel card (available variant): `badge/available`, "2/3 cuốn đang có tại tủ" body, **`btn/primary/xl` "Xin mượn"** → metadata card as label/value rows (Tác giả · Số trang: 144 · Thể loại: Thiếu nhi · Nhà xuất bản: Kim Đồng · Năm: 2019) → "Giới thiệu" description paragraph (≤68ch) → "Bình luận" section: 2 approved comments (name, date, plain text) + comment box (`input/default` + `btn/primary/md` "Gửi bình luận") with note "Bình luận sẽ hiện sau khi được duyệt".
- [ ] **Step 4: Verify light** — one dominant action ("Xin mượn"); availability = badge + count words, not colour alone.
- [ ] **Step 5: Build both dark variants** beneath; verify screenshots.

### Task 5: Public — Registration (04) and Login (05)

**Files:** none.

**Interfaces:**
- Consumes: `nav/public-top`, `input/default`, `input/error`, `btn/primary/lg`, `btn/link`.
- Produces: frames `04-registration-light|dark`, `05-login-light|dark`.

- [ ] **Step 1: Build `04-registration-light`** — single column 560 wide centred, title h1 "Đăng ký bạn đọc". Four groups with h3 headers and 32px top gaps, every field with label above, "Bắt buộc" in muted where required, helper text between label and input explaining why:
  - *Đăng nhập*: Tên đăng nhập (helper "Dùng để đăng nhập, không dấu"), Mật khẩu.
  - *Bản thân*: Tên thánh (helper "Ví dụ: Maria, Giuse"), Họ và tên, Ngày sinh (helper "Để xếp nhóm đọc phù hợp").
  - *Gia đình*: Tên cha, Tên mẹ, Số điện thoại (helper "Để liên hệ khi sách quá hạn"), Email (không bắt buộc).
  - *Giáo xứ*: Tổ, Giáo họ.
  One field (Họ và tên) rendered as `input/error` with message "Vui lòng nhập họ và tên". Submit `btn/primary/lg` "Gửi đăng ký", then confirmation note card: "Quản lý sẽ duyệt tài khoản của em, thường trong tuần. Em sẽ thấy thông báo khi được duyệt."
- [ ] **Step 2: Verify light** — single column; required = word not asterisk; helper text present on every field.
- [ ] **Step 3: Build `05-login-light`** — centred 400 card: title h2 "Đăng nhập", Tên đăng nhập + Mật khẩu inputs, `btn/primary/lg` "Đăng nhập" full width, muted note "Quên mật khẩu? Nhờ quản lý tủ sách đặt lại giúp em.", `btn/link` "Đăng ký bạn đọc mới".
- [ ] **Step 4: Build both dark variants; verify all four frames.**

### Task 6: Manager — Dashboard (06)

**Files:** none.

**Interfaces:**
- Consumes: `nav/manager-sidebar`, `stat-card`, `btn/primary/2xl`, `badge/*`, `table/row`.
- Produces: frames `06-dashboard-light|dark`. Establishes the manager chrome layout reused by Tasks 7–10: sidebar 256 left (active item varies per screen), content area right with 32px padding, manager body text 17px.

- [ ] **Step 1: Build `06-dashboard-light`**: sidebar (active "Trang chính") → content: h1 "Trang chính" + date "Thứ Năm, 07/08/2026" muted → row of four `stat-card`s: **Quá hạn 3** (overdue-red number + 4px red left border), **Chờ duyệt tài khoản 2** (held-blue accents), **Yêu cầu mượn 4**, **Bình luận chờ duyệt 1** → **two full-width `btn/primary/2xl` stacked with 16px gap: "Cho mượn" (icon book-marked) and "Nhận trả" (icon book-open), fill `--primary-strong`** — the dominant elements → totals strip "128 đầu sách · 154 cuốn · 46 bạn đọc · 12 đang mượn" → "Hoạt động gần đây" card: 4 rows as Vietnamese sentences, e.g. "Maria Lan đã cho Giuse Minh mượn *Dế Mèn Phiêu Lưu Ký* — 14:32, 07/08".
- [ ] **Step 2: Verify light** — the two 2xl buttons dominate; stat numbers carry status colour + border, with word labels.
- [ ] **Step 3: Build dark variant; verify.**

### Task 7: Manager — Quick lend (07, 08)

**Files:** none.

**Interfaces:**
- Consumes: manager chrome from Task 6 (sidebar active "Cho mượn"), `input/default`, `book-card`, `badge/*`, `btn/primary/xl`, `btn/link`, `btn/outline/md`.
- Produces: frames `07-lend-find-book-light|dark`, `08-lend-reader-confirm-light|dark`.

- [ ] **Step 1: Build `07-lend-find-book-light`**: content: step header "Cho mượn — bước 1/3: Chọn sách" (h1) with 3-dot step indicator (dot 1 filled `--primary` + labels "Sách · Bạn đọc · Xác nhận") → large search input (visibly focused: 2px `--ring` ring, caret) with typed text "de men" → result rows (72px each): cover thumb 40×60, title 17/600, author muted, trailing `badge/available` or `badge/on-loan`; first row hover state (`--muted` bg) → beneath selected title, a copy selector card "Chọn cuốn": two rows `DT-0001 — Nguyên vẹn` (radio selected) and `DT-0003 — Hơi cũ`, third `DT-0002` shown disabled with `badge/on-loan`.
- [ ] **Step 2: Verify** — diacritic-free search "de men" matching "Dế Mèn…" is visible; on-loan copy not selectable.
- [ ] **Step 3: Build `08-lend-reader-confirm-light`** as step 2+3 side by side in content area: left panel "Bước 2/3: Chọn bạn đọc": search input "thao vy", member rows (avatar circle initial, name 17/600, "2/3 cuốn đang mượn" muted), selected row `--secondary` fill + check; escape hatch `btn/link` "+ Đăng ký bạn đọc mới"; one row **blocked example**: "Phêrô Lê Hoàng Nam" with inline amber panel `alert-triangle` + "Đã mượn đủ 3 cuốn. Nhận trả một cuốn trước khi cho mượn thêm." (shown before confirm, not as error) → right panel "Bước 3/3: Xác nhận" card: book cover+title, reader name, due row "Hẹn trả: **Thứ Năm, 21/08/2026** (14 ngày)", single **`btn/primary/xl` "Cho mượn"** full width.
- [ ] **Step 4: Verify; build both dark variants; verify.**

### Task 8: Manager — Receive return (09, 10)

**Files:** none.

**Interfaces:**
- Consumes: manager chrome (sidebar active "Nhận trả"), `input/default`, `badge/on-loan`, `badge/overdue`, `condition-tile`(+selected), `input/default` note field, `btn/primary/xl`, `btn/outline/md`.
- Produces: frames `09-return-find-loan-light|dark`, `10-return-condition-light|dark`.

- [ ] **Step 1: Build `09-return-find-loan-light`**: "Nhận trả — bước 1/2: Tìm sách đang mượn" (h1, 2-step indicator) → search input "minh" → loan rows: cover thumb, title, "Giuse Trần Văn Minh · mượn 24/07", trailing badge — two rows `badge/on-loan` ("còn 3 ngày"), one row `badge/overdue` ("quá hạn 2 ngày") with days in `--destructive-text`.
- [ ] **Step 2: Verify.**
- [ ] **Step 3: Build `10-return-condition-light`**: "Bước 2/2: Tình trạng sách" → summary row (cover, *Đất Rừng Phương Nam*, Giuse Trần Văn Minh, "mượn 24/07 — hẹn trả 07/08") → single row of six `condition-tile`s: **Nguyên vẹn (selected)** · Hơi cũ · Cũ · Rách · Mất trang · Bị vẽ vào, icons e.g. `check-circle`/`book`/`book-open`/`scissors`/`file-x`/`pen-line` → muted caption "Ghi chú và ảnh sẽ hiện khi chọn tình trạng xấu hơn" (note/photo fields NOT rendered — good grade selected) → queue callout card (held-blue tint, `bookmark` icon): "Có 1 bạn đang chờ cuốn này: Maria Nguyễn Thảo Vy" + `btn/outline/md` "Duyệt cho bạn kế tiếp" → **`btn/primary/xl` "Nhận trả"**.
- [ ] **Step 4: Verify** — six tiles single row; selection = fill + check; note/photo absent; queue callout informs but nothing automatic. Build both dark variants; verify.

### Task 9: Manager — Books list (11), Book form (12), Book detail manager (13)

**Files:** none.

**Interfaces:**
- Consumes: manager chrome (sidebar active "Sách"), `table/header-row`, `table/row`, `badge/*` (incl. retired/lost), `input/default`, `btn/primary/xl|md`, `btn/outline/md`, `btn/destructive/md`.
- Produces: frames `11-books-list-light|dark`, `12-book-form-light|dark`, `13-book-detail-mgr-light|dark`.

- [ ] **Step 1: Build `11-books-list-light`**: h1 "Sách" + `btn/primary/md` "+ Thêm sách" top right → search input + filter selects (Thể loại, Tình trạng) → table: header **Sách · Tác giả · Số cuốn · Còn sách · Tình trạng**; 7 rows (cover thumb + title lead), badges mixed: available ×3, on-loan ×2, lost ×1, retired ×1; each row trailing `btn/ghost/md` "Sửa".
- [ ] **Step 2: Build `12-book-form-light`**: h1 "Thêm sách", single column 560: **cover uploader FIRST** (dashed 2:3 dropzone, `image-plus` 24, "Chọn ảnh bìa" + muted "Ảnh bìa giúp nhận ra sách nhanh nhất") → fields: Tên sách (Bắt buộc), Tác giả (Bắt buộc), Thể loại select, Nhà xuất bản, Năm xuất bản, ISBN (không bắt buộc), Số trang, Giới thiệu textarea (120h) → checkbox "Hiện trên trang công khai" checked → `btn/primary/lg` "Lưu sách" + `btn/ghost/md` "Huỷ".
- [ ] **Step 3: Build `13-book-detail-mgr-light`**: public detail top block (cover, title, metadata) condensed, plus manager panels: **"Các cuốn" table** — Mã · Tình trạng · Trạng thái · Thao tác; rows `DT-0001` Nguyên vẹn `badge/available` [Đánh giá · Cho mượn], `DT-0002` Hơi cũ `badge/on-loan` "Giuse Trần Văn Minh — hẹn 21/08" [Nhận trả], `DT-0003` Rách `badge/retired` "Ngừng dùng 02/06 — hỏng gáy" → "Lịch sử đánh giá" list (2 entries: date, assessor, grade, note) → "Lịch sử mượn" table (3 rows: reader · lend date · return date · condition).
- [ ] **Step 4: Verify all three; build dark variants; verify.**

### Task 10: Manager — Readers (14, 15) and Pending registrations (16)

**Files:** none.

**Interfaces:**
- Consumes: manager chrome (sidebar active "Người đọc" / "Đăng ký chờ duyệt"), `table/*`, `badge/*`, `stat-card`, `input/default`, `btn/primary/lg|md`, `btn/destructive/md`, `btn/outline/md`, `input/error` (reason field).
- Produces: frames `14-readers-list-light|dark`, `15-reader-detail-light|dark`, `16-pending-registrations-light|dark`.

- [ ] **Step 1: Build `14-readers-list-light`**: h1 "Người đọc" → search + status filter chips ("Đang hoạt động (selected) · Chờ duyệt · Tạm ngưng · Đã nghỉ" — selected chip `--secondary` fill + check) → table: **Bạn đọc · Tổ · Đang mượn · Trạng thái**; 6 rows, avatar initial + saint name + full name lead; one row "Tạm ngưng" (retired-grey badge with `pause` icon), one "2 cuốn · 1 quá hạn" with overdue text colour.
- [ ] **Step 2: Build `15-reader-detail-light`**: header: avatar 64, "Maria Nguyễn Thảo Vy", muted "Tên thánh: Maria · Tổ 3 · Giáo họ Thánh Tâm", active badge → two-column: left "Thông tin" card incl. manager-only fields (Ngày sinh 12/03/2015, Tên cha, Tên mẹ, SĐT 0987 654 321 as tappable link, Ghi chú của quản lý in `--muted` box) with muted caption "Chỉ quản lý nhìn thấy phần này"; right "Đang mượn" (2 loan rows with due badges) + "Lịch sử" (4 rows with return condition) → actions row: `btn/outline/md` "Đặt lại mật khẩu", `btn/outline/md` "Tạm ngưng", muted note "Tạm ngưng chỉ chặn mượn mới — sách đang mượn không đổi."
- [ ] **Step 3: Build `16-pending-registrations-light`**: h1 "Đăng ký chờ duyệt (2)" → two review cards, each laying out ALL registration fields as label/value grid (Tên thánh, Họ và tên, Ngày sinh, Cha, Mẹ, SĐT, Tổ, Giáo họ, Ngày đăng ký) → card 1: **`btn/primary/lg` "Duyệt"** + `btn/destructive/md` "Từ chối" + textarea "Lý do từ chối (bắt buộc khi từ chối)" → card 2 additionally carries a **similar-name warning** panel (amber tint, `alert-triangle`): "Trùng tên? Đã có bạn đọc *Trần Văn Minh* (Tổ 2) từ 03/2026" + `btn/link` "Xem hồ sơ".
- [ ] **Step 4: Verify all three; build dark variants; verify.**

### Task 11: Full audit pass

**Files:** Modify: `docs/superpowers/specs/2026-08-07-pencil-screens-design.md` (flip Status line to "Executed").

**Interfaces:**
- Consumes: all 32 frames + Foundations.
- Produces: audit fixes applied in-document; spec status updated and committed.

- [ ] **Step 1: Inventory check** — `get_app_state`; confirm all 35 frames exist with exact names (3 foundations + 32 screens), sections ordered Foundations/Public/Manager, dark row under light row.
- [ ] **Step 2: Screenshot audit** — screenshot every frame; per frame check the Global Constraints checklist: one dominant action; badges = icon+word+tint; no all-caps; only token hexes; Vietnamese everywhere; 1280 width/1200 content; dark frames have bordered surfaces. Log every violation.
- [ ] **Step 3: Fix and re-verify** each violation.
- [ ] **Step 4: Update spec status and commit** — edit the spec's Status line to "Executed 2026-08-07"; `git add docs/superpowers/specs/2026-08-07-pencil-screens-design.md && git commit -m "docs: mark Pencil Phase 1 screens spec executed"`.
