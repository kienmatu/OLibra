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
 * exception, still reader-facing. comment_approved is 2b's, with its
 * writer; the profile-change pair BR §15 names has no reference
 * implementation and is Phase 3's to decide.
 */
enum NotificationKind: string
{
    case MembershipApproved = 'membership_approved';
    case MembershipRejected = 'membership_rejected';
    case RequestApproved = 'request_approved';
    case RequestRejected = 'request_rejected';
    case LoanDueSoon = 'loan_due_soon';
    case LoanOverdue = 'loan_overdue';
}
