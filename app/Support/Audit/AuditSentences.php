<?php

declare(strict_types=1);

namespace App\Support\Audit;

/**
 * BR §14's readable sentences, and the closed map of actions this build
 * can describe — one entry per audit action a shipped command writes
 * (AuditActionCensusTest holds the two sets equal in both directions,
 * and AuditSentencesTest's partition block carries the count, which
 * every task that adds an action bumps deliberately).
 * Pure: the lang file is loaded by require, so nothing here
 * needs the framework, and the wording ships in lang/vi where server
 * copy lives (spec §7).
 *
 * No branch of sentence() interpolates $action — a raw action name in
 * front of a volunteer is a failure, not a fallback (the reference's
 * §3.1 rule). The stored name belongs to the expansion, where
 * AuditLogQuery places it.
 *
 * The actor's ROLE is deliberately never rendered, although BR §14's
 * example carries one ("Quản lý Maria Lan"): audit_log stores no role,
 * and a manager later made a reader would have every historical sentence
 * relabelled — a claim about authority the log never recorded (the
 * reference's argument, kept).
 */
final class AuditSentences
{
    /** @var array<string, string> action => group, one of GROUPS below */
    public const array ACTIONS = [
        'book.created' => 'books',
        'book.updated' => 'books',
        'book.deleted' => 'books',
        'copy.added' => 'books',
        'copy.condition_assessed' => 'books',
        'copy.lost_reported' => 'books',
        'copy.found' => 'books',
        'copy.retired' => 'books',
        'copy.qr_printed' => 'books',
        'loan.created' => 'loans',
        'loan.returned' => 'loans',
        'loan.renewed' => 'loans',
        'loan.voided' => 'loans',
        'loan.lost' => 'loans',
        // request.* joins the loan family, not a group of its own: the
        // reference files it under the same "muon-tra" group as loan.*
        // (audit-actions.ts:399), and its phrase there is the one
        // lang/vi/audit.php's request_created copies verbatim.
        'request.created' => 'loans',
        'request.approved' => 'loans',
        'request.rejected' => 'loans',
        'request.cancelled' => 'loans',
        'request.fulfilled' => 'loans',
        // Ruling 1's lapsed-hold exit (ReleaseExpiredHold): the same
        // "muon-tra" family as the rest of request.*, because what a
        // volunteer is reading about is a book that came back to the
        // shelf.
        'request.expired' => 'loans',
        'membership.registered' => 'readers',
        'membership.approved' => 'readers',
        'membership.rejected' => 'readers',
        'membership.suspended' => 'readers',
        'membership.reactivated' => 'readers',
        'membership.left' => 'readers',
        'credentials.set' => 'readers',
        'profile.corrected' => 'readers',
        // Phase 3c-i Task 2, spec D1 and D5 — the first of the lifecycle's
        // five, and 'readers' rather than 'administration' even though the
        // command lives in app/Actions/Admin/. That directory is forced by
        // the audit configurator's fence (spec D10), not by the act being
        // administrative: this is a reader on their own profile page, and
        // the group answers "which screen is this act from".
        'profile_change.proposed' => 'readers',
        // Phase 2b files every community action under its own group, the
        // reference's cong-dong (audit-actions.ts's comment.* family).
        // Folding comments into books would leave next task's shelf news
        // with no home at all.
        'comment.created' => 'community',
        'comment.approved' => 'community',
        'comment.rejected' => 'community',
        'comment.hidden' => 'community',
        // Slice B's shelf news, the same cong-dong family — the
        // reference files every announcement.* action there
        // (audit-actions.ts).
        'announcement.created' => 'community',
        'announcement.updated' => 'community',
        // Slice B's four state changes, the same cong-dong family — the
        // reference files every announcement.* action there
        // (audit-actions.ts).
        'announcement.published' => 'community',
        'announcement.pinned' => 'community',
        'announcement.unpinned' => 'community',
        'announcement.hidden' => 'community',
        // Slice C's donation offer, the same cong-dong family — the
        // reference files donation.offered there
        // (old_next/src/domain/kernel/audit-actions.ts, opened for this,
        // where its entry reads `group: "cong-dong"`).
        'donation.offered' => 'community',
        // Slice C's two decisions, the same cong-dong family — the
        // reference files donation.received and donation.declined there
        // (old_next/src/domain/kernel/audit-actions.ts, opened for this,
        // where both entries read `group: "cong-dong"`).
        'donation.received' => 'community',
        'donation.declined' => 'community',
        // Phase 3b-i's fifth group, administration — the cross-shelf acts
        // of the /admin area, which are the reference's own he-thong family
        // (audit-actions.ts:592-612 files every bookshelf.* entry there).
        // The group was opened empty by Task 2; these are its first two
        // members, and they land in the same commit as the commands that
        // write them, because the census holds the two sets equal in both
        // directions at every task boundary.
        //
        // bookshelf.updated is ONE action for both halves of the editor,
        // not two. Spec D2 splits profile from lending policy into separate
        // forms with separate submits and separate refusals, but what a
        // volunteer reads in the log is "somebody changed this shelf", and
        // which fields moved is in the payload rows one tap away — INV-8's
        // own placement. The reference agrees by construction: its two
        // server actions both run the single updateBookshelfSettings
        // command, which writes one action name.
        'bookshelf.created' => 'administration',
        'bookshelf.updated' => 'administration',
        // Task 6's pair, the same he-thong family — the reference files
        // bookshelf.archived there (audit-actions.ts:606-614). Its
        // un-archive has no entry because it has no command; this port
        // builds one (spec D4), so the restore is registered beside the
        // archive rather than left as the one administration act with no
        // sentence.
        'bookshelf.archived' => 'administration',
        'bookshelf.unarchived' => 'administration',
        // Task 7's three, the same he-thong family (audit-actions.ts:
        // 615-630). The two membership names are OPS §4.5's own rather
        // than the shorter manager.* they read as, and the reference
        // records why: they are facts about a MEMBERSHIP, and one person
        // may be given the keys to one parish while staying a reader at
        // another.
        //
        // They are 'administration' and not 'readers', even though every
        // other membership.* entry above is 'readers'. The group answers
        // "which screen is this act from", not "which table did it
        // touch": these two are made from the cross-shelf admin area by
        // somebody who is not a member of the shelf at all, and filing
        // them under readers would bury them among the approvals and
        // suspensions a shelf's own manager does daily.
        'membership.role_assigned' => 'administration',
        'membership.role_revoked' => 'administration',
        // THE ONLY ACTION IN THE WHOLE MAP THAT BELONGS TO NO SHELF. Its
        // row carries a null shelf column, which is the reason
        // AuditRecorder has a configurator at all (spec D0) — and why the
        // shelf-scoped audit screen never shows it.
        'user.promoted_super_admin' => 'administration',
        // Phase 3b-ii Task 1's pair, spec D1 and D8 — the same he-thong
        // family the reference files them under (audit-actions.ts:631-638).
        // TWO ACTIONS AND NOT ONE, unlike bookshelf.updated above, and the
        // difference is not the form split: these two forms write different
        // FACTS about different readers. `site_contact.updated` changes what
        // a stranger with no membership anywhere reads on /contact;
        // `system_settings.updated` changes what a shelf opened next month
        // will start with, and neither existing shelf nor existing reader is
        // touched. A volunteer reading the log needs to tell those apart,
        // and the reference names them separately for the same reason.
        //
        // BOTH ROWS BELONG TO NO SHELF, like user.promoted_super_admin
        // above: their subject is the installation. So both are written
        // through AuditRecorder's cross-shelf arm, and neither can appear on
        // a shelf's own audit screen.
        'system_settings.updated' => 'administration',
        'site_contact.updated' => 'administration',
        // Phase 3b-ii Task 3's three, spec D3 and D8 — the book genres.
        // 'administration' and not 'books', and the distinction is the one
        // the membership pair above already turns on: the group answers
        // "which screen is this act from", not "which table did it touch".
        // These three are made from the cross-shelf admin area by somebody
        // who holds the whole installation, not from a tủ sách's own
        // catalogue screens.
        //
        // ALL THREE ROWS BELONG TO NO SHELF, like the installation's own
        // pair above: categories carries no bookshelf_id, so there is no
        // shelf whose log this act could sit on. The reference records all
        // three globally for the same reason.
        //
        // THERE IS NO category.unarchived, because there is no command —
        // spec D3 ports the reference's omission as an omission, and an
        // action with no writer is instantly red in the census either way.
        'category.created' => 'administration',
        'category.renamed' => 'administration',
        'category.archived' => 'administration',
        // Phase 3b-ii Task 4's one, spec D5 and D8 — BR §5.6's parish
        // taxonomy, the SHAPE of how a parish subdivides its people.
        //
        // 'administration' for the reason the three above are: the group
        // answers "which screen is this act from", and this one is made on
        // the cross-shelf admin shelf editor by somebody who holds the
        // whole installation, not by the tủ sách's own manager.
        //
        // UNLIKE THE FOUR ABOVE, THIS ROW BELONGS TO A SHELF. The taxonomy
        // is one parish's own arrangement and lives in that shelf's
        // settings, so UpdateParishTaxonomy writes it through
        // AuditRecorder's forShelf() arm and it appears on that shelf's own
        // log rather than nowhere.
        'parish_taxonomy.updated' => 'administration',
        // Phase 3b-ii Task 5's four, spec D5, D6 and D8 — the đơn vị
        // themselves, as opposed to the shape above.
        //
        // 'administration' LIKE THE SHAPE, EVEN THOUGH THE SCREEN IS THE
        // MANAGER'S. This is the one place in the map where the group's
        // usual reading ("which screen is this act from") and its real
        // question part company, so it is worth saying which one wins.
        // `manage/units` lives in the manager area because ParishUnit is
        // shelf-scoped and that group binds a tenant (spec D5) — but every
        // one of these four acts is super-admin-only, and a manager reading
        // that screen can only look. The group answers "who could have done
        // this", and the answer is the same person who changed the shape.
        // Filing them under 'readers' because the units describe readers
        // would put four acts a manager cannot perform in the group a
        // manager's own work lives in.
        //
        // ALL FOUR ROWS BELONG TO A SHELF, like parish_taxonomy.updated and
        // unlike the five installation-wide actions above: a parish's đơn vị
        // are its own. They are written through the recorder's ORDINARY
        // arm — no forShelf(), no global() — because this route group binds
        // a tenant and the bound context is exactly the shelf they belong
        // to. That is the same fact that keeps the four commands out of
        // app/Actions/Admin/ and out of the widening fence altogether.
        'parish_unit.created' => 'administration',
        'parish_unit.renamed' => 'administration',
        'parish_unit.deleted' => 'administration',
        'parish_unit.reordered' => 'administration',
    ];

    /**
     * The filter whitelist, not just a fixture: Manage\AuditLogController
     * accepts a ?group= only when it is in here, and the Vietnamese labels
     * live beside it in resources/js/lib/copy.ts (manageAudit.groups).
     *
     * 'administration' is empty until the shelf and membership actions land;
     * actionsInGroup() returns [] for it and the partition above still holds.
     */
    public const array GROUPS = ['loans', 'books', 'readers', 'community', 'administration'];

    /** @return list<string> */
    public static function actionsInGroup(string $group): array
    {
        return array_keys(array_filter(self::ACTIONS, fn (string $g) => $g === $group));
    }

    public static function groupOf(string $action): ?string
    {
        return self::ACTIONS[$action] ?? null;
    }

    /** @param array{actor: ?string, subject: ?string, before: ?array<string, mixed>, after: ?array<string, mixed>} $facts */
    public static function sentence(string $action, array $facts): string
    {
        return strtr(self::line('frame'), [
            ':actor' => $facts['actor'] ?? self::line('system_actor'),
            ':phrase' => self::phrase($action, $facts),
        ]);
    }

    /**
     * The expansion's field/value rows — the stored values rendered as
     * JSON and nothing prettier (BR §14 puts the raw values here; a
     * Vietnamese rendering would be a re-derivation one layer down). An
     * em dash marks a key the bag does not hold AT ALL; the string
     * "null" marks one it holds as null — "not recorded" and "recorded
     * as nothing" are different facts, and an investigation that cannot
     * tell them apart is reading a different log (the reference's
     * measured lesson: its accidental `?? "—"` fallback erased the
     * distinction with every test green).
     *
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     * @return list<array{field: string, before: string, after: string}>
     */
    public static function payloadRows(?array $before, ?array $after): array
    {
        $keys = array_unique(array_merge(array_keys($before ?? []), array_keys($after ?? [])));
        sort($keys);

        return array_map(fn (string $field) => [
            'field' => $field,
            'before' => self::renderValue($before, $field),
            'after' => self::renderValue($after, $field),
        ], $keys);
    }

    /** @param array{actor: ?string, subject: ?string, before: ?array<string, mixed>, after: ?array<string, mixed>} $facts */
    private static function phrase(string $action, array $facts): string
    {
        $before = $facts['before'];
        $after = $facts['after'];
        $subject = $facts['subject'];

        return match ($action) {
            'book.created' => strtr(self::line('book_created'), [':title' => self::which(self::str($after, 'title'))]),
            'book.updated' => strtr(self::line('book_updated'), [':title' => self::which(self::str($after, 'title'))]),
            'book.deleted' => strtr(self::line('book_deleted'), [':title' => self::which(self::str($before, 'title'))]),
            'copy.added' => ($code = self::str($after, 'code')) !== null
                ? strtr(self::line('copy_added'), [':code' => $code])
                : self::line('copy_added_bare'),
            'copy.condition_assessed' => ($word = self::conditionWord($after)) !== null
                ? strtr(self::line('copy_condition_assessed'), [':condition' => $word])
                : self::line('copy_condition_assessed_bare'),
            'copy.retired' => strtr(self::line('copy_retired'), [':because' => self::because(self::str($after, 'reason'))]),
            'copy.lost_reported' => self::line('copy_lost_reported'),
            'copy.found' => self::line('copy_found'),
            // Batch bookkeeping, not a single copy: $after carries an INT
            // 'count', never a string, so str() (which only ever returns a
            // trimmed string) is the wrong helper here — the count is read
            // and cast directly instead.
            'copy.qr_printed' => strtr(self::line('copy_qr_printed'), [
                ':count' => (string) ($after['count'] ?? 0),
            ]),
            'loan.created' => $subject !== null
                ? strtr(self::line('loan_created'), [':subject' => $subject, ':title' => self::which(self::str($after, 'title'))])
                : strtr(self::line('loan_created_bare'), [':title' => self::which(self::str($after, 'title'))]),
            'loan.returned' => strtr(self::line('loan_returned'), [
                ':title' => self::which(self::str($after, 'title')),
                ':from' => $subject !== null ? strtr(self::line('loan_returned_from'), [':subject' => $subject]) : '',
                ':state' => ($word = self::conditionWord($after)) !== null
                    ? strtr(self::line('loan_returned_state'), [':condition' => $word])
                    : '',
            ]),
            'loan.renewed' => self::line('loan_renewed'),
            'loan.voided' => strtr(self::line('loan_voided'), [':because' => self::because(self::str($after, 'reason'))]),
            'loan.lost' => self::line('loan_lost'),
            'request.created' => strtr(self::line('request_created'), [':title' => self::which(self::str($after, 'title'))]),
            // No :title, and no subject — the approval's stored payload is
            // copy_id, the expiry and the reader, never the book. The
            // reference's own phrase takes no facts either
            // (audit-actions.ts:407-410), which is what lets ReceiveReturn's
            // second door onto a hold share this one sentence.
            'request.approved' => self::line('request_approved'),
            'request.rejected' => strtr(self::line('request_rejected'), [
                ':title' => self::which(self::str($after, 'title')),
                ':subject' => self::who($subject),
                ':because' => self::because(self::str($after, 'reason')),
            ]),
            // The one request sentence whose actor IS the subject — a
            // reader withdrawing their own row. No :subject, therefore:
            // naming them twice would read as though somebody withdrew
            // somebody else's request. Mirrors request.created's arm,
            // which is the other half of the same reader's pair.
            'request.cancelled' => strtr(self::line('request_cancelled'), [':title' => self::which(self::str($after, 'title'))]),
            // No :title and no :subject — the lend that collects a hold
            // stores status, copy_id and fulfilled_loan_id, never the book
            // or the reader. Same shape as request.approved: a fixed
            // phrase, the same one however thin the payload is.
            'request.fulfilled' => self::line('request_fulfilled'),
            // The reader is named and the book is not — ruling 1's own
            // worked example. A manager ending somebody's lapsed hold is
            // a sentence about whose turn ended; which copy went back is
            // in the payload rows one tap away. Same :subject fallback as
            // every other arm that names one.
            'request.expired' => strtr(self::line('request_expired'), [':subject' => self::who($subject)]),
            'membership.registered' => ($name = self::str($after, 'fullName')) !== null
                ? strtr(self::line('membership_registered'), [':name' => $name])
                : self::line('membership_registered_bare'),
            'membership.approved' => strtr(self::line('membership_approved'), [':subject' => self::who($subject)]),
            'membership.rejected' => strtr(self::line('membership_rejected'), [
                ':subject' => self::who($subject),
                ':because' => self::because(self::str($after, 'reason')),
            ]),
            'membership.suspended' => strtr(self::line('membership_suspended'), [':subject' => self::who($subject)]),
            'membership.reactivated' => strtr(self::line('membership_reactivated'), [':subject' => self::who($subject)]),
            'membership.left' => strtr(self::line('membership_left'), [':subject' => self::who($subject)]),
            'credentials.set' => strtr(self::line('credentials_set'), [':subject' => self::who($subject)]),
            'profile.corrected' => strtr(self::line('profile_corrected'), [':subject' => self::who($subject)]),
            // No strtr at all — the reference's phrase takes no
            // substitution, and the payload (the proposed values beside
            // their snapshot) is what a volunteer opens the row for.
            'profile_change.proposed' => self::line('profile_change_proposed'),
            // No strtr at all — the copy_lost_reported shape. The
            // reference's phrase names neither the title nor the author,
            // and that stays deliberate: the payload holds book_id and no
            // title, and the alternative is widening the payload to make
            // a sentence prettier.
            'comment.created' => self::line('comment_created'),
            // Same no-strtr shape and the same reason: the reference's
            // phrase names neither the comment nor its author, and the
            // payload holds only the two statuses.
            'comment.approved' => self::line('comment_approved'),
            // The reason travels through the existing :because helper —
            // RejectComment's payload always carries one (the reason is
            // required), so this arm's :because clause is never empty in
            // practice, but the helper itself does not assume that.
            'comment.rejected' => strtr(self::line('comment_rejected'), [':because' => self::because(self::str($after, 'reason'))]),
            // HideComment's reason is optional, so :because renders empty
            // when the payload carries no 'reason' key at all — the same
            // helper as copy.retired and loan.voided.
            'comment.hidden' => strtr(self::line('comment_hidden'), [':because' => self::because(self::str($after, 'reason'))]),
            // The title, with its own bare arm — copy.added's shape. NOT
            // self::which(), although the reference's phrase uses its own
            // `which`: this class's which() falls back to the some_book
            // line ('một cuốn sách'), which would describe an
            // announcement as a book.
            'announcement.created' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_created'), [':title' => $title])
                : self::line('announcement_created_bare'),
            // Task 10. The created arm's shape and its reason: the
            // reference's phrase runs the title through its own `which`,
            // and this class's which() falls back to the some_book line
            // ('một cuốn sách'), which would describe an announcement as
            // a book. So a bare line of its own again. The title read is
            // the AFTER one — an edit's sentence names what the
            // announcement is called now; the before title is a payload
            // row one tap away, which is where INV-8 puts it.
            'announcement.updated' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_updated'), [':title' => $title])
                : self::line('announcement_updated_bare'),
            // Task 11's four, all on the created arm's shape and for its
            // reason: the reference's phrases each run the title through
            // its own `which`, and this class's which() falls back to the
            // some_book line ('một cuốn sách'), which would describe an
            // announcement as a book. So a bare line each rather than a
            // which() call. The title read is the AFTER one — the four
            // commands that write these all put the row's title there,
            // and it is what the announcement is called at the moment of
            // the act.
            'announcement.published' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_published'), [':title' => $title])
                : self::line('announcement_published_bare'),
            'announcement.pinned' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_pinned'), [':title' => $title])
                : self::line('announcement_pinned_bare'),
            'announcement.unpinned' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_unpinned'), [':title' => $title])
                : self::line('announcement_unpinned_bare'),
            // Its own key rather than comment_hidden's: that sentence
            // carries a :because slot HideComment fills from an optional
            // reason, and HideAnnouncement records none.
            'announcement.hidden' => ($title = self::str($after, 'title')) !== null
                ? strtr(self::line('announcement_hidden'), [':title' => $title])
                : self::line('announcement_hidden_bare'),
            // No strtr and no bare twin — the request.approved shape. The
            // reference's phrase takes no facts (`phrase: () => "đề nghị
            // tặng sách"`), and there is nothing here for a fallback to
            // replace: INV-8's payload for this action is the status and
            // the rough count, and the description stays out of it.
            'donation.offered' => self::line('donation_offered'),
            // The offered arm's shape and its reason: the reference's
            // phrase takes no facts (`phrase: () => "nhận một đề nghị
            // tặng sách"`), and INV-8's payload for this action is the
            // two statuses, so there is nothing here for a fallback to
            // replace.
            'donation.received' => self::line('donation_received'),
            // The reason travels through the existing :because helper,
            // comment.rejected's arm exactly. DeclineDonation requires
            // and trims its reason before it opens a transaction, so the
            // clause is filled for every row that command writes; the
            // helper renders an empty clause rather than assuming it.
            'donation.declined' => strtr(self::line('donation_declined'), [':because' => self::because(self::str($after, 'reason'))]),
            // The reference's own arm (audit-actions.ts:592-598): the name
            // out of $after, with a bare twin when there is none. NOT
            // self::which() — that helper's fallback line reads 'một cuốn
            // sách' and would describe a bookshelf as a book, the trap
            // every announcement.* arm above documents.
            'bookshelf.created' => ($name = self::str($after, 'name')) !== null
                ? strtr(self::line('bookshelf_created'), [':name' => $name])
                : self::line('bookshelf_created_bare'),
            // AFTER first, then BEFORE — the reference's bookshelf.
            // settings_updated arm (`str(f.after, "name") ?? str(f.before,
            // "name")`).
            //
            // ALL THREE WRITERS OF THIS ACTION CARRY `name` IN BOTH BAGS,
            // and that is where the sentence is actually made true — not
            // here. UpdateBookshelfProfile always did; UpdateBookshelfPolicy
            // and UpdateBookshelfContacts did not, and both rendered the
            // bare twin for every real row they wrote, on a screen that is
            // shelf-stamped, and today's only reader (Manage\AuditLogController,
            // hard-scoped to one shelf) supplies the name from context — so this
            // is redundant today and load-bearing for the cross-shelf browser
            // Phase 3 plans. Each now puts the shelf's name on both
            // sides unchanged. So `?? $before` is belt and braces rather
            // than the load-bearing clause an earlier version of this
            // comment claimed it was: no writer in the codebase reaches it,
            // and a payload that names the shelf only in `before` would be
            // one nothing here can invent a name for anyway. It is kept for
            // a rename that recorded only the old name. The named form and
            // the bare form of all three writers' payloads are pinned in
            // AuditSentencesTest.
            'bookshelf.updated' => ($name = self::str($after, 'name') ?? self::str($before, 'name')) !== null
                ? strtr(self::line('bookshelf_updated'), [':name' => $name])
                : self::line('bookshelf_updated_bare'),
            // BEFORE, not after — the reference's own arm
            // (audit-actions.ts:606-614 reads `str(f.before, "name")`),
            // and here it is forced rather than copied: ArchiveBookshelf's
            // `after` carries the new status alone, because the name did
            // not move. Reading $after would leave every archive row
            // rendering the bare twin.
            'bookshelf.archived' => ($name = self::str($before, 'name')) !== null
                ? strtr(self::line('bookshelf_archived'), [':name' => $name])
                : self::line('bookshelf_archived_bare'),
            // The mirror, reading $before for the same reason.
            'bookshelf.unarchived' => ($name = self::str($before, 'name')) !== null
                ? strtr(self::line('bookshelf_unarchived'), [':name' => $name])
                : self::line('bookshelf_unarchived_bare'),
            // Task 7's three, all naming a PERSON — so all three go through
            // who(), and NONE of them needs the _bare twin the four
            // bookshelf.* arms above carry. That twin exists because a name
            // read out of the payload can be absent; who() has its own
            // fallback line ('một người') built in, which is why every
            // subject-naming arm in this file from membership.approved
            // onwards is a single strtr and not a conditional.
            //
            // The subject is resolved by AuditLogQuery from the entity id on
            // the row — a membership id joins through to its person, a user
            // id straight to one — so it is filled for a live row whether or
            // not the payload carried it. The commands also write 'subject'
            // into the payload as the fallback for a row whose person is
            // later soft-deleted.
            'membership.role_assigned' => strtr(self::line('membership_role_assigned'), [':subject' => self::who($subject)]),
            'membership.role_revoked' => strtr(self::line('membership_role_revoked'), [':subject' => self::who($subject)]),
            'user.promoted_super_admin' => strtr(self::line('user_promoted_super_admin'), [':subject' => self::who($subject)]),
            // Task 1's pair. NEITHER ARM READS ITS PAYLOAD, and neither
            // needs a _bare twin: what changed is the installation, which
            // has one name and no alternative, so there is nothing here for
            // a missing key to make unspeakable. The numbers that moved are
            // on the payload row one tap away — INV-8's own placement — and
            // the contact row deliberately carries no phone at all (see
            // UpdateSiteContact: BR §14 records what changed rather than
            // duplicating it, and the phone is the one field here somebody
            // could be identified by).
            'system_settings.updated' => self::line('system_settings_updated'),
            'site_contact.updated' => self::line('site_contact_updated'),
            // Task 3's three, each the reference's own arm (audit-actions.ts:
            // 644-665). UNLIKE THE PAIR ABOVE, EVERY ONE OF THESE READS ITS
            // PAYLOAD AND EVERY ONE CARRIES A BARE TWIN — what changed here
            // is one genre out of many, so a sentence that could not name it
            // would leave a volunteer with no way to tell which.
            //
            // AFTER for the create, BEFORE for the archive, and both for the
            // rename — each reading the side where the name is a fact. The
            // archive's `after` deliberately carries only the instant, so
            // reading it would render every archive row bare.
            'category.created' => ($name = self::str($after, 'name')) !== null
                ? strtr(self::line('category_created'), [':name' => $name])
                : self::line('category_created_bare'),
            'category.renamed' => self::categoryRenamed($before, $after),
            'category.archived' => ($name = self::str($before, 'name')) !== null
                ? strtr(self::line('category_archived'), [':name' => $name])
                : self::line('category_archived_bare'),
            // Task 4's one, the reference's phrase verbatim
            // (audit-actions.ts:580-583). NO SUBSTITUTION AND NO BARE TWIN,
            // like the installation's pair above and unlike the three
            // genres: the subject is the shelf, the row already carries its
            // bookshelf_id, and every screen that will render this sentence
            // is reading one shelf's log with the shelf's name in its own
            // heading. The four values that moved are on the payload row one
            // tap away — INV-8's placement.
            'parish_taxonomy.updated' => self::line('parish_taxonomy_updated'),
            // Task 5's four, each the reference's own arm
            // (audit-actions.ts:549-579). Three of them read the payload and
            // carry a bare twin, on the three genres' rule: what changed is
            // one đơn vị out of many, so a sentence that could not name it
            // would leave a volunteer with no way to tell which.
            //
            // CREATED reads `after`, RENAMED both sides, DELETED `before` —
            // each the side where the name is a fact. The delete's `after`
            // does carry the name too, and is deliberately not the side read
            // here: `before` is the row as it stood, which is what a
            // retirement is about.
            'parish_unit.created' => ($name = self::str($after, 'name')) !== null
                ? strtr(self::line('parish_unit_created'), [':name' => $name])
                : self::line('parish_unit_created_bare'),
            'parish_unit.renamed' => self::parishUnitRenamed($before, $after),
            // The cascade tail is what a reader of ONE row needs in order to
            // know the row was not clicked — `cascaded` rides on the payload
            // rather than becoming a second action name (DeleteParishUnit,
            // spec D6), so this arm is where it becomes a sentence. Read as
            // an identity against true, not a truthiness test: the payload is
            // data, and a stray 'false' string must not read as a cascade.
            'parish_unit.deleted' => self::parishUnitDeleted($before, $after),
            // NO SUBSTITUTION AND NO BARE TWIN, like parish_taxonomy.updated
            // above and unlike the three beside it. One press writes one row
            // PER UNIT THAT MOVED (ReorderParishUnits), so a sentence naming
            // a unit would repeat the same act two or three times under
            // different names while the two numbers that actually moved sit
            // on the payload row one tap away — INV-8's placement, and the
            // reference's own phrase.
            'parish_unit.reordered' => self::line('parish_unit_reordered'),
            default => self::line('unknown'),
        };
    }

    /**
     * `category.renamed`'s three cases, the reference's own ladder
     * (audit-actions.ts:651-659): both names, the new one alone, neither.
     *
     * A METHOD RATHER THAN A NESTED TERNARY IN THE MATCH ARM, because two
     * independent nullable reads is where a chained ternary stops being
     * readable — and this is the one arm in the map whose sentence changes
     * SHAPE rather than only its substitution.
     *
     * `RenameCategory` always writes both names, so the two fallbacks are
     * unreachable from this codebase today. They are here for the reason the
     * `bookshelf.updated` arm keeps its own: a payload is data, and a
     * sentence that assumed its shape would render an unsubstituted `:from`
     * to a volunteer the day one did not.
     *
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     */
    private static function categoryRenamed(?array $before, ?array $after): string
    {
        $from = self::str($before, 'name');
        $to = self::str($after, 'name');

        if ($from !== null && $to !== null) {
            return strtr(self::line('category_renamed'), [':from' => $from, ':to' => $to]);
        }

        if ($to !== null) {
            return strtr(self::line('category_renamed_to'), [':to' => $to]);
        }

        return self::line('category_renamed_bare');
    }

    /**
     * `parish_unit.renamed`'s three cases, the reference's own ladder
     * (audit-actions.ts:558-563) and `categoryRenamed`'s shape above: both
     * names, the new one alone, neither. A method rather than a nested
     * ternary for that arm's reason — two independent nullable reads is
     * where a chained ternary stops being readable.
     *
     * `RenameParishUnit` always writes both names, so the two fallbacks are
     * unreachable from this codebase today. They are here because a payload
     * is data: a sentence that assumed its shape would render an
     * unsubstituted `:from` to a volunteer the day one did not.
     *
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     */
    private static function parishUnitRenamed(?array $before, ?array $after): string
    {
        $from = self::str($before, 'name');
        $to = self::str($after, 'name');

        if ($from !== null && $to !== null) {
            return strtr(self::line('parish_unit_renamed'), [':from' => $from, ':to' => $to]);
        }

        if ($to !== null) {
            return strtr(self::line('parish_unit_renamed_to'), [':to' => $to]);
        }

        return self::line('parish_unit_renamed_bare');
    }

    /**
     * `parish_unit.deleted`'s four cases — the reference's two-by-two
     * (audit-actions.ts:565-574): the name is there or it is not, and the
     * row went with a parent or was itself the click.
     *
     * FOUR LINES RATHER THAN A LINE PLUS A GLUED-ON TAIL. The reference
     * concatenates a suffix onto its phrase; done here that would mean
     * assembling a Vietnamese sentence out of two `lang/vi` fragments, which
     * is the shape this file avoids everywhere else — a translator editing
     * one half cannot see the other, and `:name` would sit next to a
     * fragment that has to agree with it grammatically.
     *
     * `=== true`, not a truthiness test: `cascaded` arrives off a stored
     * JSON payload, and the string 'false' is truthy in PHP.
     *
     * @param  ?array<string, mixed>  $before
     * @param  ?array<string, mixed>  $after
     */
    private static function parishUnitDeleted(?array $before, ?array $after): string
    {
        $cascaded = ($after['cascaded'] ?? null) === true;
        $name = self::str($before, 'name');

        if ($name === null) {
            return self::line($cascaded ? 'parish_unit_deleted_cascaded_bare' : 'parish_unit_deleted_bare');
        }

        return strtr(
            self::line($cascaded ? 'parish_unit_deleted_cascaded' : 'parish_unit_deleted'),
            [':name' => $name],
        );
    }

    /**
     * A trimmed, non-empty STRING at $key, or null — never a coerced
     * bool/number (the reference's str()).
     *
     * @param  ?array<string, mixed>  $bag
     */
    private static function str(?array $bag, string $key): ?string
    {
        if ($bag === null || ! array_key_exists($key, $bag) || ! is_string($bag[$key])) {
            return null;
        }
        $trimmed = trim($bag[$key]);

        return $trimmed === '' ? null : $trimmed;
    }

    /** @param ?array<string, mixed> $after */
    private static function conditionWord(?array $after): ?string
    {
        $raw = self::str($after, 'condition');
        /** @var array<string, string> $words */
        $words = self::lines()['conditions'];

        return $raw !== null && array_key_exists($raw, $words) ? $words[$raw] : null;
    }

    private static function because(?string $reason): string
    {
        return $reason === null ? '' : strtr(self::line('because'), [':reason' => $reason]);
    }

    private static function who(?string $subject): string
    {
        return $subject ?? self::line('someone');
    }

    private static function which(?string $title): string
    {
        return $title ?? self::line('some_book');
    }

    /** @param ?array<string, mixed> $bag */
    private static function renderValue(?array $bag, string $field): string
    {
        if ($bag === null || ! array_key_exists($field, $bag)) {
            return '—';
        }

        return (string) json_encode($bag[$field], JSON_UNESCAPED_UNICODE);
    }

    /** @return array<string, mixed> */
    private static function lines(): array
    {
        static $lines = null;

        return $lines ??= require dirname(__DIR__, 3).'/lang/vi/audit.php';
    }

    private static function line(string $key): string
    {
        // The (string) cast is not decoration: lines() is
        // array<string, mixed> (the 'conditions' entry is a nested array),
        // so Larastan level 8 rejects a bare return against a string
        // return type. `make analyse` is run at every commit.
        return (string) self::lines()[$key];
    }
}
