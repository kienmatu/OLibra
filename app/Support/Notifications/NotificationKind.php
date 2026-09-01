<?php

declare(strict_types=1);

namespace App\Support\Notifications;

/**
 * The closed set of notification kinds — the port of kinds.ts, where the
 * map is the type: notifications.kind is a bare string column, so nothing
 * in the schema stops a command inventing a kind, and a kind with no
 * sentence would reach a child's bell as a raw token. A backed enum makes
 * an uncovered kind unrepresentable at the call site, and
 * NotificationSentences' exhaustive match makes a sentence-less case a
 * Larastan error rather than something a test notices afterwards.
 *
 * Managers get none of these — BR §15 / OPS §7, by design; every case is
 * phrased to a reader, and NotificationsAreReaderFacingTest enumerates
 * the call sites rather than trusting this comment.
 *
 * Grown per task (plan divergence 7). The pair Task 17 adds is written
 * by the reminder sweep rather than by a command — OPS §7's argued
 * exception, still reader-facing. The profile-change pair BR §15 names
 * had no reference implementation and was Phase 3's to decide; phase
 * 3c-i's Task 6 decided it, and the two cases below are that decision.
 *
 * BR:490 names both and BR:492 gives the reason: "without them a reader
 * would have to keep revisiting the page to find out whether their new
 * phone number took effect." The rejection carries the manager's reason,
 * which is why its payload has a `reason` key and the approval's payload
 * has none — the approval says only that the details moved, because the
 * reader's own profile page already shows what they now are.
 */
enum NotificationKind: string
{
    case MembershipApproved = 'membership_approved';
    case MembershipRejected = 'membership_rejected';
    case RequestApproved = 'request_approved';
    case RequestRejected = 'request_rejected';
    case LoanDueSoon = 'loan_due_soon';
    case LoanOverdue = 'loan_overdue';
    case CommentApproved = 'comment_approved';
    case ProfileChangeApproved = 'profile_change_approved';
    case ProfileChangeRejected = 'profile_change_rejected';
}
