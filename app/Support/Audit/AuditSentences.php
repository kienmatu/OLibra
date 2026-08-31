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
            // "name")`), and the fallback is not decoration. The profile
            // form can change the name itself, so $after carries the new
            // one; the lending-policy form changes no name at all, and its
            // payload is the settings bag either side. Reading only $after
            // would leave every policy save saying 'sửa thông tin tủ sách'
            // with no shelf named, on a screen that is cross-shelf by
            // nature.
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
            default => self::line('unknown'),
        };
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
