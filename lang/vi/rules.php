<?php

/**
 * Business-rule refusal sentences, keyed by RuleViolated code — OPS §2's
 * "stable, machine-readable code paired with the plain Vietnamese sentence
 * the UI shows". Sentences are OPS §4.1's verbatim where it names one, and
 * the reference's ERROR_MESSAGES (old_next/src/domain/kernel/errors.ts)
 * verbatim for the codes OPS does not tabulate.
 */
return [
    'duplicate_isbn' => 'Mã ISBN này đã tồn tại trong tủ sách.',
    'has_active_loans' => 'Không thể xoá sách đang có bản được mượn.',
    'already_lost' => 'Bản sách này đã được báo mất.',
    'already_retired' => 'Bản sách đã ngừng dùng, không thể báo mất.',
    'not_lost' => 'Bản sách này hiện không ở trạng thái đã mất.',
    'copy_on_loan' => 'Không thể ngừng dùng bản sách đang được mượn. Hãy nhận trả hoặc báo mất trước.',
    'copy_not_available' => 'Bản sách này đang được mượn hoặc đang giữ chỗ.',
    'copy_not_on_loan' => 'Chỉ có thể báo mất bản sách đang được mượn.',
    'retire_reason_required' => 'Vui lòng ghi lý do ngừng dùng bản sách này.',
    'donor_ambiguous' => 'Chọn bạn đọc hoặc gõ tên người tặng, không chọn cả hai.',
    'donor_membership_invalid' => 'Không tìm thấy bạn đọc này trên tủ sách hiện tại.',
    'copy_count_invalid' => 'Số bản phải lớn hơn 0.',
    // OPS §4.1's MarkCopiesPrinted entry (docs/OPERATIONS.md:188), quoted
    // from its Failure modes list. NOT §4.4 — that is Community, and an
    // earlier draft of this plan cited it here.
    'copy_selection_empty' => 'Bạn chưa chọn bản sách nào để in nhãn.',

    // ── Members (Phase 1b) ────────────────────────────────────────────
    'membership_not_found' => 'Không tìm thấy bạn đọc này.',
    'username_taken' => 'Tên đăng nhập đã được dùng, hãy chọn tên khác.',
    'username_in_use' => 'Tên đăng nhập này đã có người dùng.',
    'password_too_short' => 'Mật khẩu cần ít nhất 8 ký tự.',
    'passwords_dont_match' => 'Mật khẩu nhập lại không khớp.',
    'required_fields_missing' => 'Vui lòng điền đầy đủ các trường bắt buộc.',
    'validation_failed' => 'Vui lòng kiểm tra lại thông tin.',
    'already_registered_here' => 'Bạn đã đăng ký ở tủ sách này rồi.',
    'registration_not_pending' => 'Đơn đăng ký này đã được xử lý.',
    'reject_reason_required' => 'Vui lòng ghi lý do từ chối.',
    'not_active_cannot_suspend' => 'Chỉ có thể tạm khoá tài khoản đang hoạt động.',
    'not_suspended_cannot_reactivate' => 'Chỉ có thể kích hoạt lại tài khoản đang tạm khoá.',
    'member_has_active_loans' => 'Bạn đọc này còn sách chưa trả, hãy nhận trả trước.',
    'phone_invalid' => 'Số điện thoại chưa đúng. Ghi 10 số, ví dụ 0912345678.',
    'empty_proposal' => 'Vui lòng thay đổi ít nhất một trường.',
    'not_permitted' => 'Bạn không có quyền thực hiện việc này.',
    'thieu-so-dien-thoai' => 'Bạn chưa nhập số điện thoại. Hãy nhập số, hoặc cho biết lý do chưa có.',
    // Phase 3c-i Task 2, spec D1. NOT the second-proposal refusal — a
    // second proposal at this shelf merges into the pending row and is
    // never refused. This is the case the shelf-scoped read cannot see: a
    // person with memberships at two parishes, whose pending row belongs to
    // the other one, caught off the generated column's global unique index.
    // The reference's own sentence, which is honest about both.
    'change_already_pending' => 'Bạn đang có một yêu cầu thay đổi chờ duyệt.',
    'profile_change_proposed_flash' => 'Đã gửi đề nghị. Thông tin hiện tại vẫn được dùng cho đến khi quản lý duyệt.',
    // Phase 3c-i Task 3, spec D3. The re-read under the lock: between the
    // moment a manager opened the card and the moment they tapped, a
    // colleague may have decided it or the reader may have withdrawn it.
    // A distinct code rather than a not-found, because the row is still
    // there and "already dealt with" is what the volunteer needs told.
    // OPS §4.3 spells it `not_pending`; the port qualifies the name,
    // because `request_not_pending` (a borrow request) already exists and
    // two unqualified 'not_pending' codes would be one sentence for two
    // different things.
    'profile_change_not_pending' => 'Yêu cầu đổi thông tin này đã được xử lý.',
    // Phase 3c-i Task 5, the two decision queues (BR:580, BR:602). Both
    // sentences are written for a VOLUNTEER, not for the reader: they
    // confirm what the tap did and say where the consequence lands, which
    // for the approval is the person's own record and for the rejection is
    // the reader's profile page — the one screen where BR:544 shows them
    // the reason. Task 6 adds the notification that reaches the reader
    // directly; until it does, the queue's own words are the only place
    // this hand-off is stated.
    'profile_change_approved_flash' => 'Đã duyệt. Thông tin mới đã được ghi vào hồ sơ của bạn đọc.',
    'profile_change_rejected_flash' => 'Đã từ chối — bạn đọc sẽ thấy lý do trên trang hồ sơ của mình.',
    // Phase 3c-i Task 7. The withdrawal's flash, written for the person who
    // tapped it on their own page: what went away is the REQUEST, and the
    // sentence says so, because the information itself never moved.
    'profile_change_cancelled_flash' => 'Đã huỷ đề nghị. Thông tin trong hồ sơ của bạn không thay đổi.',
    // Phase 3c-i Task 7, spec D12. Two codes, not one, and neither reuses
    // `password_too_short` above: a form with a current-password box and a
    // new-password box has to be able to say which of the two is wrong, and
    // SetReaderCredentials' code names a form that has only one.
    'current_password_incorrect' => 'Mật khẩu hiện tại chưa đúng.',
    'new_password_too_short' => 'Mật khẩu mới cần ít nhất 8 ký tự.',
    // Says the revocation out loud. Every other device stops being signed
    // in, which is the point of changing a password and is not something a
    // reader should have to discover.
    'password_changed_flash' => 'Đã đổi mật khẩu. Các thiết bị khác sẽ phải đăng nhập lại.',
    // Phase 3c-i Task 8, spec D6 — the photograph's three refusals. All
    // three are facts about bytes, raised by App\Support\Members\
    // AvatarStorage and AvatarImage before the proposal is ever recorded.
    //
    // The number is written as "5 MB" and not "5 MiB" because that is what
    // a volunteer's file manager shows them; the cap really is the binary
    // megabyte, for the same reason.
    'file_too_large' => 'Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.',
    // ITS OWN SENTENCE, and not a variant of invalid_image below. A HEIC
    // file is a real photograph — usually of the reader's own child — in a
    // codec this server cannot open, and telling somebody holding a
    // perfectly good picture that it "is not a valid image" is a false
    // statement. The sentence says what to do instead, because on the one
    // device that produces these the answer is a setting.
    'heic_not_supported' => 'Ảnh chụp từ iPhone (HEIC) chưa mở được. Vui lòng chọn ảnh dạng JPEG hoặc PNG.',
    // A DECODE failure, not a content-type mismatch: this is what a file
    // that is not an image earns after the encoder has actually tried to
    // read it, so a renamed document cannot pass by wearing the right
    // header.
    'invalid_image' => 'Tệp này không phải là ảnh hợp lệ.',
    // The photograph waits for a manager exactly as the eight text fields
    // do, and the flash says so — a reader who saw their new picture
    // appear immediately would reasonably think it was already in force.
    'avatar_proposed_flash' => 'Đã gửi ảnh đại diện mới. Ảnh hiện tại vẫn được dùng cho đến khi quản lý duyệt.',
    'parish_unit_l1_not_found' => 'Đơn vị bậc 1 đã chọn không tồn tại.',
    'parish_unit_l2_not_found' => 'Đơn vị bậc 2 đã chọn không tồn tại.',
    'parish_unit_l2_not_in_l1' => 'Đơn vị bậc 2 đã chọn không thuộc đơn vị bậc 1 đã chọn.',
    'suspension_reason_required' => 'Vui lòng ghi lý do tạm khoá.',
    'shelf_not_found' => 'Không tìm thấy tủ sách này.',

    // ── Circulation (Phase 1c) ────────────────────────────────────────
    'copy_lost_or_retired' => 'Bản sách này đã mất hoặc ngừng dùng.',
    'membership_not_active' => 'Tài khoản đang tạm khoá, không thể mượn thêm.',
    'loan_limit_reached' => 'Bạn đọc đã mượn tối đa số sách cho phép.',
    'loan_not_active' => 'Lượt mượn này đã được xử lý.',
    'loan_not_active_cannot_void' => 'Chỉ có thể huỷ lượt mượn đang diễn ra.',
    'no_renewals_remaining' => 'Bạn đã dùng hết số lần gia hạn cho lượt mượn này.',
    'title_has_queue' => 'Có bạn khác đang chờ mượn cuốn này, không thể gia hạn.',
    'title_has_no_copies' => 'Cuốn này chưa có bản sách nào trong tủ.',
    'reason_required' => 'Vui lòng ghi lý do huỷ.',

    // ── Oversight (Phase 1d) ──────────────────────────────────────────
    // Authored by this plan, not OPS (the member_has_active_loans
    // precedent): the code guards a programming error, so the sentence
    // tells the volunteer the one thing they can do about it.
    'audit_forbidden_field' => 'Không thể ghi nhật ký cho thao tác này. Vui lòng báo quản trị viên.',
    'audit_nesting_too_deep' => 'Dữ liệu ghi nhật ký lồng quá sâu, không thể lưu. Vui lòng báo quản trị viên.',

    // A UI sentence, not a refusal — kept beside them so server copy stays
    // in lang/vi/. The census test only walks `new RuleViolated(...)`
    // literals, so this key is inert to it.
    'lend_success_flash' => 'Đã cho :name mượn ":title" — hạn trả :due.',
    'return_success_flash' => 'Đã nhận trả bản :code — sách đã về kệ.',
    'renew_success_flash' => 'Đã gia hạn — hạn trả mới là :due.',

    // ── Requests & holds (Phase 2a) ───────────────────────────────────
    'copy_not_found' => 'Không tìm thấy bản sách này.',
    'duplicate_request' => 'Bạn đã có một yêu cầu đang chờ cho cuốn này.',
    'membership_not_active_cannot_request' => 'Tài khoản đang tạm khoá, không thể gửi yêu cầu mượn.',
    'request_not_pending' => 'Yêu cầu này đã được xử lý.',
    'request_not_queued' => 'Yêu cầu này không còn trong hàng chờ của sách này.',
    'no_copy_available' => 'Không còn bản nào để giữ chỗ.',
    'chosen_copy_lost_or_retired' => 'Bản sách đã chọn đã mất hoặc ngừng dùng.',
    'hold_expired' => 'Thời gian giữ chỗ đã hết. Bạn đọc cần đăng ký lại.',
    'request_not_held' => 'Yêu cầu này không có bản sách nào đang được giữ chỗ.',
    'not_own_request' => 'Bạn không thể huỷ yêu cầu của người khác.',
    'request_already_fulfilled' => 'Yêu cầu này đã được trao sách, không thể huỷ.',
    // flash lines (the lend/return flash precedent, 1c)
    'request_success_flash' => 'Đã gửi. Quản lý tủ sách sẽ xem và báo lại cho bạn.',
    'request_cancel_flash' => 'Đã huỷ yêu cầu mượn.',
    'return_hold_success_flash' => 'Đã nhận trả bản :code và giữ chỗ cho bạn đọc đang chờ.',
    'approve_success_flash' => 'Đã giữ chỗ — bạn đọc sẽ được báo, hạn đến nhận :until.',
    'reject_request_flash' => 'Đã từ chối yêu cầu — bạn đọc sẽ được báo.',
    // The handover flash. 1c's lend_success_flash takes :name/:title, and
    // the handover controller has neither at hand — it holds the request
    // and LendCopy's dueOn. Minted HERE, in the one task that owns this
    // block, rather than retroactively edited into it from Task 14.
    'lend_success_flash_short' => 'Đã trao sách — hạn trả :due.',
    'release_hold_flash' => 'Đã trả bản sách về kệ.',
    // Authored on ruling 1 (no errors.ts spelling): a manager may not yank
    // a live hold. OPS §4.2 gains its entry in Task 18's own commit — the
    // title_has_no_copies two-ledger precedent.
    'hold_not_expired' => 'Thời gian giữ chỗ chưa hết, không thể trả về kệ.',
    // Authored for the deadlock retry (no errors.ts spelling, the
    // hold_not_expired precedent): what a circulation write says when its
    // retries are spent against a lock-order cycle. Deliberately says
    // nothing about locks — the caller's only useful action is to send the
    // same tap again. OPS §6 is its second ledger.
    'busy_try_again' => 'Có thao tác khác đang xử lý cùng lúc, vui lòng thử lại.',

    // ── Community (Phase 2b) ──────────────────────────────────────────
    // The reference's ERROR_MESSAGES
    // (old_next/src/domain/kernel/errors.ts) verbatim for the codes this
    // slice throws — the codes themselves come from
    // old_next/src/domain/community/commands/comment-moderation.ts. NOT
    // edited into RuleViolatedCodesHaveSentencesTest's census in Task 1:
    // nothing threw these codes yet, and that census walks throwers, not
    // sentences. Each task adds its codes to that list in the commit that
    // first throws them — Task 2 (CreateComment) added comments_disabled
    // and empty_body. CORRECTED IN TASK 8, which re-read that census
    // while wiring the moderation screen: this line used to say the two
    // moderation codes below "still await theirs", and they do not —
    // comment_not_pending and comment_not_approved are both in
    // RuleViolatedCodesHaveSentencesTest's list today, added by the
    // commands that throw them.
    'comments_disabled' => 'Tủ sách hiện không nhận bình luận.',
    'empty_body' => 'Vui lòng nhập nội dung bình luận.',
    'comment_not_pending' => 'Bình luận này đã được xử lý.',
    'comment_not_approved' => 'Chỉ có thể ẩn bình luận đang hiển thị.',
    // Two flash lines, not one — the shelf's own comments_require_approval
    // setting decides which is true, and a single "đã gửi" line on a
    // moderating shelf would be silent about the pending state.
    // reject_reason_required is not repeated here — 1b minted it, and
    // OPS §4.4's RejectComment reuses that same sentence.
    'comment_pending_flash' => 'Đã gửi. Bình luận của bạn sẽ hiển thị sau khi được duyệt.',
    'comment_published_flash' => 'Đã gửi bình luận.',
    // The MANAGER's three, minted by Task 8's moderation screen — the two
    // above are the reader's, said to whoever just wrote a comment, and
    // these are said to whoever just decided one. Named on
    // reject_request_flash / release_hold_flash's pattern (the verb, then
    // what the volunteer can now expect), and no key is shared between
    // the two audiences: a sentence written for a child reads wrong to a
    // volunteer, and one key for both drifts the moment either side is
    // reworded.
    //
    // The rejection line says nothing about the author being told,
    // deliberately: RejectComment sends no notification — its own
    // docblock gives OPS §7's table as the reason — so the reason stored
    // on the row is the whole of what is written down.
    // reject_request_flash further up CAN promise "bạn đọc sẽ được báo"
    // because RejectBorrowRequest notifies; copying that half-sentence
    // down here would have been false.
    'comment_approved_flash' => 'Đã duyệt — bình luận đã hiển thị công khai.',
    'comment_rejected_flash' => 'Đã từ chối bình luận — lý do được lưu cùng bình luận.',
    'comment_hidden_flash' => 'Đã ẩn — bình luận không còn hiển thị công khai.',

    // ── Announcements (Phase 2b, Slice B) ─────────────────────────────
    // The reference's own code and sentence (errors.ts's
    // announcement_fields_required), not OPS §4.4's abbreviated
    // validation_failed: one code, one sentence, one form. Either blank
    // field raises this.
    'announcement_fields_required' => 'Vui lòng điền tiêu đề và nội dung.',
    // The losing side of announcements_bookshelf_id_slug_key, reached
    // from CreateAnnouncement's INSERT through UniqueViolation when a
    // rival transaction committed the same slug between this one's read
    // and its write. A manager who sees it has done nothing wrong and
    // cannot see the rule that stopped them, so the sentence names what
    // happened and what to do — change the headline — rather than the
    // index.
    'announcement_slug_taken' => 'Vừa có thông báo khác dùng tiêu đề gần giống. Xin đổi tiêu đề rồi đăng lại.',
    // OPS §4.4's refusal for PublishAnnouncement, and the sentence has to
    // survive being read by a manager who pressed "Đăng lại".
    //
    // AN EARLIER DRAFT OF THIS COMMENT JUSTIFIED THE SENTENCE WRONGLY,
    // and the correction is stated rather than quietly applied. It said
    // the command "refuses only a LIVE publication — a lapsed
    // announcement republishes fine — so whoever reads this line is
    // looking at something that IS showing right now." The guard is
    // `published_at !== null && ! $supplied` (PublishAnnouncement::
    // execute), and `published_at !== null` covers showing AND EXPIRED
    // alike. A lapsed announcement reached with the expiry key ABSENT
    // refuses too, and would read this sentence saying it is showing.
    //
    // The sentence still holds for every path the screen can produce,
    // and that is a fact about the SCREEN rather than about the command:
    // PublishDisclosure's form always posts expires_at, so a lapsed row
    // always arrives with the key present and republishes, and after
    // Task 14's fix round the button is not rendered on a showing row at
    // all. So the refusal is unreachable from the shipped UI, and a
    // manager meets this sentence only through a hand-made request.
    // If a caller is ever added that omits the key, this sentence needs
    // to stop naming a state it cannot know.
    'already_published' => 'Thông báo này đang hiển thị. Hãy sửa nội dung, hoặc ẩn đi rồi đăng lại.',

    // ── The manager's bulletin screen (Phase 2b, Task 14) ─────────────
    // Six success flashes, one per write on
    // App\Http\Controllers\Manage\AnnouncementController. They sit in
    // this file beside the refusals, following comment_approved_flash and
    // its two siblings a few lines up, which are flashes in this same
    // ledger rather than RuleViolated codes.
    //
    // Each sentence names WHAT MOVED and WHO CAN NOW SEE IT, because the
    // manager's list re-renders behind the flash and a bare "Đã lưu"
    // would leave them reading chips to find out. The compose form writes
    // a draft, so its sentence says so and points at the button that
    // changes that.
    'announcement_created_flash' => 'Đã lưu bản nháp. Bấm "Đăng ngay" khi muốn cả nhà cùng đọc.',
    'announcement_updated_flash' => 'Đã lưu thay đổi cho thông báo.',
    'announcement_published_flash' => 'Đã đăng — thông báo hiện trên bản tin tủ sách.',
    'announcement_hidden_flash' => 'Đã ẩn — thông báo không còn trên bản tin tủ sách.',
    'announcement_pinned_flash' => 'Đã ghim — thông báo hiện lên đầu bản tin.',
    'announcement_unpinned_flash' => 'Đã bỏ ghim — thông báo trở về theo thứ tự ngày đăng.',

    // ── Donations (Phase 2b, Slice C) ─────────────────────────────────
    // OPS §4.4's OfferDonation lists one failure mode, `empty_description`
    // — "Vui lòng mô tả sách bạn muốn tặng." — and the reference's
    // ERROR_MESSAGES (old_next/src/domain/kernel/errors.ts's
    // empty_description) carries the identical sentence. Both were opened
    // for this line; it is a transcription of the two of them agreeing,
    // not an authored sentence.
    'empty_description' => 'Vui lòng mô tả sách bạn muốn tặng.',
    // The flash after a successful offer, on comment_pending_flash's
    // pattern: say what happened, then what the reader can expect next.
    // A donation always waits for a manager — the column default is
    // 'pending' and this port writes no status at all, so the column default decides — so
    // there is one line here rather than the pair a shelf setting forces
    // on the comment flashes.
    'donation_offered_flash' => 'Đã gửi. Tủ sách sẽ xem và trả lời đề nghị tặng sách của bạn.',
    // Task 16's one new code, and one sentence for both decisions: OPS
    // §4.4 was opened for it, and lists `not_pending` — "Đề nghị tặng
    // sách này đã được xử lý." — under ReceiveDonation and under
    // DeclineDonation identically. Transcribed from the two of them
    // agreeing, not authored. The name is prefixed where OPS's is bare,
    // following the keys already in this file: comment_not_pending,
    // request_not_pending and registration_not_pending each name their
    // own table the same way.
    //
    // reject_reason_required is not repeated for DeclineDonation either
    // — 1b minted it, and OPS §4.4 gives this command that same
    // sentence, "Vui lòng ghi lý do từ chối.", character for character.
    'donation_not_pending' => 'Đề nghị tặng sách này đã được xử lý.',

    // ── The manager's donation queue (Phase 2b, Task 19) ──────────────
    // Two success flashes, one per decision on
    // App\Http\Controllers\Manage\DonationController. They sit here
    // beside announcement_created_flash and its five siblings, which are
    // flashes in this same ledger rather than RuleViolated codes.
    //
    // THE FIRST ONE CARRIES A NAME BECAUSE IT IS THE WHOLE HAND-OFF.
    // BR §16.3's Donation queue paragraph (opened) describes *Duyệt* as
    // opening "the add-book form with **Người tặng** pre-filled with that
    // member", and OPS §4.4's ReceiveDonation (opened) says the same in
    // its own words while insisting the command catalogues nothing: the
    // manager "separately runs `CreateBook` or `AddCopies` (§4.1, above)
    // with `donorMembershipId` set to this donor". That pre-fill needs a
    // member picker docs/known-gaps.md (opened) defers for want of
    // `GetReadersList`, so this phase ships the fallback instead — the
    // donor's NAME, in the sentence a volunteer reads on their way to the
    // add-book form, which is a shape that form already takes
    // (resources/js/pages/manage/books/create.tsx carries a `donor_name`
    // field; opened).
    //
    // :name TWICE, and deliberately: Laravel's makeReplacements is a
    // str_replace, so both occurrences fill. The first says whose offer
    // moved and the second is the value to type, in quotes, because the
    // sentence is an instruction and an instruction that names the box
    // without naming what goes in it sends the volunteer back to the
    // queue to re-read it.
    //
    // What it promises is bounded to what the volunteer is about to do:
    // it names the offer that moved and the value the next form wants,
    // and says nothing about the reader being told — the same restraint
    // comment_approved_flash's own comment argues for a few lines up.
    'donation_received_flash' => 'Đã nhận lời tặng của :name. Khi thêm sách vào kho, hãy điền ":name" vào ô Người tặng.',
    // THE SAME SENTENCE WITH NO NAME IN IT, because there is a real case
    // with no name to put there and the line above reads badly on it.
    // App\Queries\DonationQueueQuery's docblock (opened) records why the
    // name can be empty: App\Models\Membership and App\Models\User both
    // use SoftDeletes, so a trashed donor comes back as a null relation
    // and the row stays in the queue — exactly the offer a volunteer
    // needs to clear. The nullsafe chain in
    // App\Http\Controllers\Manage\DonationController::receive is what
    // turns that into an empty string, and interpolating an empty string
    // into the line above produced, measured in this task's mutation 2a:
    //
    //   Đã nhận lời tặng của . Khi thêm sách vào kho, hãy điền "" vào ô
    //   Người tặng.
    //
    // So the no-name case gets its own sentence rather than a hole in
    // that one. It does NOT diagnose the cause — a volunteer holding a
    // bag of books does not need to be told about soft deletes — it says
    // what they will find when they get to the form: no name to type.
    // Same first clause as its twin, so the two read as one flash with a
    // different second half rather than as two different outcomes.
    'donation_received_flash_no_donor' => 'Đã nhận lời tặng. Lời tặng này không còn tên người tặng, nên hãy để trống ô Người tặng khi thêm sách vào kho.',
    // The decline's twin, on comment_rejected_flash's pattern: the verb,
    // then where the reason went. It names the reader's own screen
    // because that is where it lands — App\Queries\MyDonationsQuery
    // returns decisionNote and resources/js/pages/shelves/profile/
    // donations.tsx renders it under the offer (both opened).
    'donation_declined_flash' => 'Đã từ chối — bạn đọc sẽ thấy lý do trên trang Tặng sách của mình.',

    // — quản trị tủ sách (Phase 3b-i) —
    // The create flash names the NEXT decision rather than only reporting
    // the last one, because a shelf created here is not yet usable: it has
    // no lending policy of its own and no contact on file, and the
    // administrator lands on the editor where both are filled in. Task 5
    // builds those two forms; until then the sentence points at a screen
    // that will grow them, which is the same screen either way.
    'bookshelf_created_flash' => 'Đã mở tủ sách. Hãy điền chính sách mượn và đầu mối liên hệ cho tủ sách này.',
    // The profile save is deliberately NOT 'Đã lưu thay đổi' on its own.
    // Spec D2 puts three independently-submittable forms on one screen, and
    // the reference records at length why a single undifferentiated success
    // message on such a page cannot say which form saved. So this sentence
    // names its own section, and Task 5's two flashes name theirs.
    'bookshelf_profile_saved_flash' => 'Đã lưu thông tin tủ sách.',
    // Task 5's two, each naming its own section for the reason above: three
    // forms on one screen, three sentences, so a volunteer who pressed one
    // of three buttons reads which save landed.
    'bookshelf_policy_saved_flash' => 'Đã lưu chính sách mượn sách.',
    'bookshelf_contacts_saved_flash' => 'Đã lưu đầu mối liên hệ.',
    // Phase 3b-ii Task 4's, the fourth section on the same screen and the
    // fourth sentence for the same reason: four forms, four buttons, four
    // confirmations that do not read alike. It names what it saved — the
    // CÁCH CHIA, not the đơn vị — because the units are edited elsewhere
    // and a volunteer who read "Đã lưu đơn vị" here would look for a list
    // this screen deliberately does not have.
    'bookshelf_taxonomy_saved_flash' => 'Đã lưu cách chia đơn vị của tủ sách.',
    // Spec D3. Position 1 is required by the INTERFACE and not by the
    // column: a shelf onboarded before the contacts table existed may hold
    // none and is flagged incomplete rather than assigned an invented
    // volunteer. What this refuses is a save that would LEAVE that gap, so
    // the sentence says what to type rather than reporting a rule.
    'contact_position_1_required' => 'Tủ sách cần ít nhất một đầu mối liên hệ. Hãy điền tên cho người liên hệ thứ nhất.',
    // Task 6's two flashes. Each names what changed rather than saying "Đã
    // lưu", because these are the only two controls on the list screen and
    // a volunteer who pressed one of them is looking for confirmation that
    // the tủ sách moved, not that a form saved. The archive sentence says
    // what archiving keeps — nothing is deleted — since 'ngưng hoạt động'
    // on its own can read as removal.
    'bookshelf_archived_flash' => 'Đã ngưng hoạt động tủ sách. Toàn bộ dữ liệu vẫn được giữ lại và có thể mở lại bất cứ lúc nào.',
    'bookshelf_unarchived_flash' => 'Đã mở lại tủ sách.',

    // — cài đặt hệ thống (Phase 3b-ii Task 1) —
    // Two forms on one screen, two sentences, for the reason the shelf
    // editor's three flashes carry above: a page whose forms submit
    // independently cannot say which one saved if both flash the same
    // words. The defaults sentence repeats the screen's own most important
    // qualification — mới — because a volunteer who has just saved a number
    // is exactly the person about to assume every tủ sách now follows it.
    'site_contact_saved_flash' => 'Đã lưu thông tin liên hệ của ban quản trị.',
    'system_defaults_saved_flash' => 'Đã lưu giá trị mặc định cho tủ sách mở mới.',

    // — thể loại sách (Phase 3b-ii Task 3, spec D3) —
    // The reference's own sentence, verbatim, and it does the work the
    // refusal cannot do alone: it says what to do instead. `ON DELETE SET
    // NULL` never fires here — this is a soft delete — so nothing in the
    // schema stops a book keeping a label no screen will offer again, and
    // this guard is the only thing that does.
    'category_in_use' => 'Chỉ lưu trữ được khi không còn sách nào thuộc thể loại này. Hãy đổi thể loại cho những cuốn sách đó trước.',
    // The slug is derived from the name and `categories.slug` is unique with
    // no soft-delete partition, so an archived thể loại holds its handle
    // forever — a collision an administrator cannot see on the screen. The
    // sentence has to say that, or the refusal reads as a bug.
    'duplicate_category' => 'Đã có thể loại dùng tên này (kể cả thể loại đã lưu trữ). Hãy chọn một tên khác.',
    // Three writes, three sentences: a volunteer who pressed one control on
    // a list of many rows needs to be told which act landed. The rename
    // sentence repeats the one thing the screen warns about beforehand —
    // the address does not move — because that is the fact somebody is most
    // likely to have assumed otherwise.
    'category_created_flash' => 'Đã thêm thể loại mới.',
    'category_renamed_flash' => 'Đã đổi tên thể loại. Đường dẫn của thể loại giữ nguyên như cũ.',
    'category_archived_flash' => 'Đã lưu trữ thể loại. Thể loại này không còn hiện ra khi thêm sách mới.',

    // — quản lý viên (Phase 3b-i Task 7) —
    // BR §16.4's confirmation, and the requirement is that it "states
    // plainly that history is retained" — so the sentence says what stays,
    // not merely what goes, and it names both the person and the tủ sách so
    // a volunteer confirming it is looking at the grant they meant. Assembled
    // server-side, per row, and sent down as a prop: a key the screen looked
    // up itself could render an unsubstituted placeholder with this line
    // still present and correct.
    'membership_role_revoke_confirm' => 'Thu hồi quyền quản lý của :name tại tủ sách :shelf? Người này sẽ trở lại làm bạn đọc của tủ sách. Toàn bộ lịch sử mượn sách, bình luận và đăng ký đều được giữ lại.',
    // The refusal for a revoke aimed at somebody who is already a reader.
    // NOT the reference's shared 'not_permitted', whose sentence reads
    // 'Bạn không có quyền thực hiện việc này' — a false statement about the
    // actor, since a super administrator has every permission there is, when
    // the truth is about the subject. BR §2 asks for errors that are named
    // rather than generic, and this is what a named one buys.
    'not_a_manager' => 'Người này không giữ quyền quản lý tủ sách, nên không có gì để thu hồi.',
    // The refusal for promoting somebody who already holds the global
    // grant. Says the outcome is already true rather than reporting a rule,
    // because that is the only thing the reader needs to know — and there is
    // deliberately no way to undo it (spec D5), so the sentence must not
    // sound like an invitation to try the other direction.
    'already_super_admin' => 'Người này đã là quản trị viên hệ thống.',
    'membership_role_assigned_flash' => 'Đã giao quyền quản lý tủ sách.',
    // Names what the person becomes rather than saying 'Đã lưu': the whole
    // change is a role, and the row it changed is one of many on the screen.
    'membership_role_revoked_flash' => 'Đã thu hồi quyền quản lý. Người này vẫn là bạn đọc của tủ sách và giữ nguyên toàn bộ lịch sử.',
    // Says that the grant cannot be taken back, because this is the moment
    // it becomes true and there is no screen anywhere that would say it
    // later (spec D5 — OPS §4.5 lists no demotion command).
    'user_promoted_super_admin_flash' => 'Đã giao quyền quản trị hệ thống. Hiện chưa có cách thu hồi quyền này.',

    // — đơn vị giáo xứ (Phase 3b-ii Task 5, spec D5) —
    // Four writes, four sentences, on the thể loại screen's rule: a
    // volunteer who pressed one control on a tree of many rows needs to be
    // told which act landed, not merely that something did.
    //
    // The delete sentence carries two facts the press does not show. The
    // cascade — the level-2 đơn vị inside a level-1 one go with it — is the
    // thing somebody who meant to remove one row is most likely to have
    // assumed otherwise, and the screen warns about it beforehand as well
    // (the reference's own arrangement). And the retirement is SOFT: a bạn
    // đọc already recorded in the đơn vị keeps it, the đơn vị simply stops
    // being offered. Without that second half the sentence would read as
    // data loss.
    'parish_unit_created_flash' => 'Đã thêm đơn vị mới.',
    'parish_unit_renamed_flash' => 'Đã đổi tên đơn vị. Bạn đọc đang ở đơn vị này vẫn giữ nguyên.',
    'parish_unit_deleted_flash' => 'Đã xoá đơn vị, cùng các đơn vị bậc 2 bên trong nó. Bạn đọc đã ghi ở đây vẫn giữ lại lịch sử, chỉ không còn chọn được đơn vị này nữa.',
    'parish_unit_reordered_flash' => 'Đã đổi thứ tự các đơn vị.',

    // — góp ý (Phase 3c-ii Task 1, spec D1 and D2) —
    // Both refused by SubmitFeedback, and both written for a caller who may
    // be a guest with no account: they name what to do next, not what the
    // system checked.
    //
    // The fields sentence lists the three fields by name rather than saying
    // "các trường bắt buộc", because this is the only form in the system a
    // person reaches with no session, no account and nothing on screen to
    // compare against — and the subject line is genuinely optional, so a
    // generic sentence would have them hunting for a fourth missing box.
    'feedback_fields_required' => 'Vui lòng ghi tên, số điện thoại và nội dung góp ý.',
    // Says the number, the window and that the message was NOT kept. A
    // sender who is refused with no count has no way to know whether to
    // wait a minute or a day, and one who is not told the message was
    // dropped will assume it arrived.
    'rate_limited' => 'Mỗi số điện thoại chỉ gửi được 3 góp ý trong 24 giờ. Góp ý này chưa được gửi, xin gửi lại sau.',
    // NOT a refusal code — a flash, on donation_offered_flash's pattern,
    // added by 3c-ii Task 2 with the shelf's Góp ý form. It lives in this
    // file rather than in copy.ts because the SERVER decides when a
    // message was stored, and a success line the client rendered on its
    // own would tell a sender their message arrived whenever the round
    // trip merely finished.
    //
    // "Đã gửi rồi, cảm ơn bạn nhé" is the reference's own sentence,
    // extended by half a line. The form clears itself on success, so
    // without the second clause the sender sees an empty form and a thank
    // you and has nothing telling them where the message went.
    'feedback_submitted_flash' => 'Đã gửi rồi, cảm ơn bạn nhé. Các cô chú giữ tủ sách sẽ đọc góp ý này.',
];
