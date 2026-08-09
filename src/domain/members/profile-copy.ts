/**
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  NEWLY AUTHORED VIETNAMESE — NOT QUOTED FROM OPERATIONS.md.            ║
 * ║  The product owner has not seen these three strings. Every other       ║
 * ║  Vietnamese string this slice touches is either copied verbatim from   ║
 * ║  OPERATIONS.md §4.3 or already shipped in `kernel/errors.ts`.          ║
 * ║  These three are the exception, and this file exists so that the       ║
 * ║  exception is one file rather than three lines scattered through a     ║
 * ║  command and two screens.                                              ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 *
 * **Why they had to be written rather than quoted.** The B2b plan §8 item 2
 * flags exactly two gaps that OPERATIONS.md cannot fill, because
 * `UpdateReaderProfile` did not exist when it was written:
 *
 * 1. What a manager reads above the edit form. Every other screen's own copy
 *    is quoted from OPERATIONS.md or from a built screen; there is no built
 *    manager-edit form and no sentence anywhere describing one.
 * 2. How the audit browser renders `profile.corrected`. BR §14 requires a
 *    readable Vietnamese sentence per entry ("manager approved this
 *    registration", not "update"), and a new action name arrives with no
 *    sentence attached. `profile.corrected` is also one of the names BR §13.2's
 *    Oversight view must be able to *filter* on, which needs a short label as
 *    well as a sentence — a filter menu cannot show a full sentence.
 *
 * **Why they live in `src/domain/` rather than beside a screen.** Because no
 * screen exists yet: this slice deliberately wires none (plan §7). Putting the
 * copy here means the screen wave imports it instead of inventing a third
 * wording, and means the product owner has one file to review. The moment a
 * screen exists, moving these to it is a rename, not a rewrite.
 *
 * **What is deliberately not here.** Nothing that is a *failure* message.
 * Every refusal `UpdateReaderProfile` can produce is a code in
 * `kernel/errors.ts` whose sentence was already written by somebody else
 * (`membership_not_found`, `required_fields_missing`, `validation_failed`,
 * `empty_proposal`, `not_permitted`) — an `ErrorCode` may not be invented with
 * a Vietnamese sentence nobody wrote, which is the rule `kernel/tenant.ts`
 * states and B1 established.
 */

export const PROFILE_CORRECTED_COPY = {
  /**
   * NEWLY AUTHORED (1 of 3). Above the manager's edit form.
   *
   * It has to say three things, because BR §2's whole argument for permitting
   * this power is that its use is visible: that there is no approval step,
   * that the edit is recorded, and what is recorded. A manager who does not
   * know the edit is logged will be surprised by the audit browser, and BR
   * §17.7's register is plain-spoken rather than legal.
   *
   * ── Rewritten on review, and what was wrong with the first draft ────────
   *
   * It read as translated from English, which AGENTS.md forbids in as many
   * words — the register is *Cho mượn*, never *Giao dịch lưu thông*. Four
   * specifics, from a Vietnamese reading:
   *
   * - *giá trị trước và sau* is a mathematical calque of "the values before and
   *   after". A volunteer says **nội dung cũ và nội dung mới**.
   * - *thời điểm sửa* leans "timestamp". **lúc nào** is what a person says.
   * - *"kèm tên bạn, …, và …"* is an English serial-comma rhythm. A colon and a
   *   short list is the Vietnamese one.
   * - *tên **bạn*** sat two words from ***bạn** đọc*, using *bạn* in two senses
   *   in one sentence. **ai sửa** removes the collision and is shorter.
   *
   * It was also long and administrative next to the shipped copy it appears
   * with — "Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị." — so
   * the rewrite is two short sentences rather than one long one. All three
   * things it has to say are still said.
   */
  formIntro:
    "Sửa ở đây có hiệu lực ngay, không cần duyệt. " +
    "Mỗi lần sửa đều được ghi lại: ai sửa, lúc nào, nội dung cũ và nội dung mới.",

  /**
   * NEWLY AUTHORED (2 of 3). The audit browser's filter label for
   * `profile.corrected` (BR §13.2's Oversight view, BR §14's filterable action
   * name).
   *
   * Short enough for a menu row, and it names the thing a super administrator
   * is actually looking for: a details change that nobody approved. "Sửa
   * thông tin bạn đọc" alone would not distinguish it from
   * `profile_change.approved`, which is also a manager changing a reader's
   * details.
   */
  auditFilterLabel: "Quản lý sửa trực tiếp thông tin bạn đọc",

  /**
   * NEWLY AUTHORED (3 of 3). One audit entry, as a sentence (BR §14).
   *
   * Written as a template rather than a fixed string because BR §14 wants the
   * entry to name the actor and the subject; the browser substitutes both. The
   * fields that changed are rendered from the entry's own `before`/`after`
   * bags and are deliberately not named in this sentence — one sentence that
   * has to list an arbitrary subset of eight fields becomes unreadable, and
   * the two bags are already there.
   */
  auditSentence: "{actor} đã sửa trực tiếp thông tin của {subject}.",
} as const;
