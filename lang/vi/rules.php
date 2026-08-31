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
];
