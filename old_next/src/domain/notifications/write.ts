import type { JSONValue } from "postgres";
import type { Tx } from "../kernel/unit-of-work";
import type { NotificationKind } from "./kinds";

export interface NotifyInput {
  /** A `users(id)` — the reader being told, never a membership id. */
  userId: string;
  kind: NotificationKind;
  payload?: Record<string, JSONValue>;
}

/**
 * Writes one reader-facing notification, **inside the caller's transaction**.
 *
 * That last part is the whole design. OPS §7: every reader notification "is
 * written by the command named, in the same transaction as the state change it
 * announces". So this takes a `Tx` and never opens one — a notification cannot
 * outlive a rolled-back approval, and an approval cannot commit without the
 * notification that tells the child about it. `tests/domain/notifications/
 * written-in-the-transaction.test.ts` fails a command mid-flight and asserts
 * nothing survives.
 *
 * **It is not a `Command`, deliberately.** A `Command` returns an audit entry
 * and is invoked through `runCommand`, which opens the transaction and sets the
 * tenant scope. A notification is not a thing a manager does; it is a
 * consequence of something they did, and the audit record already names that
 * act. Making it a command would put a second audit row beside every approval
 * saying "the system told somebody", which is noise in the one log BR §14 asks
 * to stay readable.
 *
 * **`bookshelf_id` comes from the transaction's scope, not from the caller.**
 * `notifications` is RLS-scoped like every other tenant table, so the insert
 * takes the shelf from `olibra.bookshelf_id` — the same GUC the policy checks.
 * A caller-supplied shelf id would be a second source of truth for scope, and
 * the one the policy does not consult.
 *
 * **`user_id` is a `users(id)`.** The recurring trap in this codebase — several
 * columns named for members hold user ids (`borrow_requests.member_id` most
 * dangerously). A membership id here inserts cleanly, because the FK is to
 * `users` and a membership id is also a uuid that could in principle collide
 * with none of them — it simply fails the FK, loudly. The parameter is named
 * `userId` so the mismatch reads wrong at the call site.
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<void> {
  await tx`
    insert into notifications (bookshelf_id, user_id, kind, payload)
    values (
      nullif(current_setting('olibra.bookshelf_id', true), '')::uuid,
      ${input.userId},
      ${input.kind},
      ${tx.json((input.payload ?? {}) as JSONValue)}
    )
  `;
}
