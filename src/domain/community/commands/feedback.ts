import { createHash } from "node:crypto";
import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import type { TenantContext } from "../../kernel/tenant";
import type { Command } from "../../kernel/unit-of-work";
import { assertPhone, requireSuperAdmin } from "../../members/policy";

/**
 * Góp ý — a message to the administrator, shelf-scoped or site-wide.
 *
 * OPS §4.4: the `gop-y` and `lien-he` forms are "the same underlying command
 * with `bookshelfId` present or absent". `feedback.bookshelf_id` is the one
 * nullable tenant column in the schema (`0006_community.sql:51`, "null for
 * site-wide"), and `feedback_tenant`'s policy is `bookshelf_id = … OR
 * bookshelf_id IS NULL` — so a site-wide message is visible from inside every
 * shelf's scope, deliberately.
 *
 * **This is the only write in the system open to an unauthenticated caller.**
 * There is no actor to name, so `requireIdentifiedActor` does not apply and the
 * audit row's `actor_id` is null — which `auditSentence` already renders as
 * "Hệ thống đã…".
 */

export interface SubmitFeedbackInput {
  /**
   * **Omitted means *this shelf*; an explicit `null` means site-wide.**
   *
   * OPS §4.4 words it the other way round — "absent = site-wide" — and this
   * inverts the default deliberately. A caller that omits the field is almost
   * always a shelf's own `gop-y` form, which runs inside that shelf's scope and
   * has the id in its context; a caller that means site-wide is `/lien-he`,
   * which is a global page and has to say so. Under OPS's reading a shelf form
   * that simply forgot the field would file its parish's message into the
   * administrator's site-wide inbox and nothing would raise — silence in the
   * direction of the wrong inbox. Saying `null` out loud is one word, and it is
   * the rarer case.
   */
  bookshelfId?: string | null;
  senderName: string;
  phone: string;
  subject?: string;
  body: string;
}

/**
 * **Known gap, found and left open by Task 17 (2026-08-10 QA remediation),
 * recorded here rather than silently shipped.** OPS §8 states the limit flatly
 * — "3 per phone number per day" — with no "per shelf" qualifier
 * (`docs/OPERATIONS.md:1051` repeats it the same way). The `recent` query
 * below has always matched that reading in intent, but not in fact: it runs on
 * the guarded `tx` a `Command` receives, subject to RLS like any other query
 * on this connection, and `feedback_tenant`'s `using` clause admits only
 * *this session's own shelf's rows plus every site-wide row* — never another
 * shelf's. Two sessions counting the identical phone number can disagree:
 *
 * - A shelf-scoped caller (the ordinary `gop-y` form) sees its own shelf's
 *   messages *and* every site-wide one, so it is correctly throttled against
 *   both.
 * - A caller with **no** shelf at all (`/lien-he`'s form, reached through
 *   `runPublicCommand`) sees *only* site-wide messages — a phone number that
 *   has already spent its three at some shelf's own form is invisible to this
 *   query, and the same number can send three more here the same day.
 * - Symmetrically, two shelves' own `gop-y` forms are a blind spot from each
 *   other (a number maxed out at shelf A is unseen from shelf B), which
 *   predates this task — that half was already true the day `submitFeedback`
 *   shipped in B3. This task adds a second, always-reachable door onto the
 *   same shape, not a new kind of gap.
 *
 * This is a property of the row visibility RLS gives an `olibra_app` session,
 * not a bug in the count's arithmetic, and closing it honestly needs either a
 * `security definer` lookup that deliberately ignores the caller's scope (a
 * first for this schema, and a bigger decision than this task) or
 * restructuring this command to take the count outside the tenant-scoped
 * transaction entirely. Neither is done here.
 * `tests/domain/community/announcements-feedback-donations.test.ts` pins the
 * current, imperfect behaviour on purpose, so a future fix has a red test to
 * turn green instead of a surprise.
 */

/**
 * OPS §8's rate-limit key, and the reason it is a hash.
 *
 * *"It uses a **hashed** identifier (§5.4), not the raw phone number, so the
 * rate-limit store itself doesn't become another place personal data sits in
 * plaintext."* A parish's feedback table would otherwise accumulate every
 * number anybody ever typed, including people who never registered.
 *
 * SHA-256 with no salt, deliberately: the point is not to make the number
 * unrecoverable by an attacker who already has the table — a phone number has
 * far too little entropy for any hash to achieve that — it is that the column
 * is not itself a directory. A per-row salt would break the lookup this exists
 * to perform; a fixed pepper would be one more secret to lose.
 */
export function phoneHash(phone: string): string {
  return createHash("sha256").update(phone.replace(/\s+/g, "")).digest("hex");
}

/** OPS §8: three per phone number per day, stated verbatim in the shipped form. */
const DAILY_LIMIT = 3;

export const submitFeedback: Command<
  SubmitFeedbackInput,
  { feedbackId: string }
> = async (tx, ctx, input) => {
  // No `requireReader` and no `requireIdentifiedActor`: OPS §4.4 lists the
  // caller as `guest, reader`. This is the one command in the catalogue with
  // no floor at all.

  const senderName = input.senderName.trim();
  const phone = input.phone.trim();
  const body = input.body.trim();
  if (!senderName || !phone || !body) {
    throw new ValidationFailed("feedback_fields_required", "body");
  }
  // Found by the QA remediation branch's final fix wave: Task 18 put
  // `assertPhone` on every registration/profile/admin write, but missed this
  // command — the QA report's own literal test string for the finding,
  // "khong-phai-so", was still accepted and stored here, on the form that is
  // the *only* way a parish with no shelf reaches the administrator
  // (`/lien-he`). Blank is already refused above; `assertPhone` (see its own
  // docstring: "every caller is responsible for its own blank check first")
  // only needs to judge the shape now.
  assertPhone(phone, "phone");

  const hash = phoneHash(phone);

  // The window is a day of the **injected** clock, not `now()`, so a test can
  // advance past midnight without waiting and so a shelf's day is the shelf's
  // timezone rather than the database host's.
  const since = new Date(ctx.clock.now().getTime() - 24 * 60 * 60 * 1000);
  const recent = await tx<{ id: string }[]>`
      select id from feedback
       where guest_hash = ${hash} and created_at > ${since}
    `;
  if (recent.length >= DAILY_LIMIT) throw new RuleViolated("rate_limited");

  // **`=== null`, not `?? null`.** `input.bookshelfId` is `undefined` for the
  // overwhelmingly common case — a shelf's own `gop-y` form, which omits the
  // field to mean *this shelf* (see the field's own docstring above) — and
  // `undefined ?? null` collapses to `null` exactly the same as an explicit
  // one would. `isSiteWide` computed that way was true for *every* ordinary
  // shelf submission, which the `after.site_wide` audit flag below shipped
  // with unnoticed (a wrong fact recorded, but harmless on its own — nothing
  // read that field back). Task 17 (2026-08-10 QA remediation) reused the
  // same expression for `global`, where the identical mistake is not
  // harmless: `global: true` on an ordinary shelf message makes `toRow` bind
  // a null `bookshelf_id` onto its audit row, which `runCommand`'s
  // `olibra_app` insert then has rejected outright by `audit_log_tenant`'s
  // policy — caught by `tests/domain/community/announcements-feedback
  // -donations.test.ts`'s "omitting the shelf files feedback against the
  // shelf in scope", which started failing the moment `global` was added.
  const isSiteWide = input.bookshelfId === null;

  const [row] = await tx<{ id: string }[]>`
      insert into feedback
        (bookshelf_id, member_id, guest_name, guest_contact, guest_hash,
         subject, body, created_at)
      values
        (${input.bookshelfId === undefined ? ctx.bookshelfId : input.bookshelfId},
         ${ctx.actor.userId}, ${senderName},
         ${phone}, ${hash}, ${input.subject?.trim() ?? ""}, ${body},
         ${ctx.clock.now()})
      returning id
    `;

  return {
    result: { feedbackId: row.id },
    audit: {
      action: "feedback.submitted",
      entityType: "feedback",
      entityId: row.id,
      before: null,
      // Neither the number nor the hash is in the audit payload. The row
      // holds both because the administrator has to be able to reply; the
      // audit log is a different record with a different retention, and BR
      // §14 asks it to record what changed rather than duplicate it.
      after: { site_wide: isSiteWide },
      // **The message decides, matching `auditScopeFor` below for the same
      // entity.** A site-wide message needs a null-`bookshelf_id` audit row —
      // else `toRow` binds `ctx.bookshelfId` onto it, and for `/lien-he`'s
      // genuinely shelf-less caller that is `""`, the exact raw-uuid-cast
      // failure the kernel's own `assertValidBookshelfId` exists to prevent.
      // Task 17 (2026-08-10 QA remediation) is what first calls this command
      // with a `ctx.bookshelfId` that can be empty (`runPublicCommand`); the
      // in-shelf case a `gop-y` form's own guest session can also mark
      // site-wide (`bookshelfId: null` from a *scoped* caller) needs the same
      // flag for the identical reason and runs through `runGlobalCommand`
      // instead, which tolerates the escalated insert without an empty scope.
      global: isSiteWide,
    },
  };
};

/**
 * `new → read` and `→ resolved`.
 *
 * **`super_admin` only**, which is OPS §4.4's own reading of an open question:
 * BR §13.2 groups "view feedback, resolve feedback" under Community without
 * restricting the role, but the only built screen is the admin-only inbox at
 * `/quan-tri/gop-y`, which lists messages across every shelf in one view.
 * Whether a shelf's own manager should see feedback addressed to their shelf is
 * unresolved by either document; this follows the built UI, and widening it
 * later is one predicate.
 */
async function handled(
  tx: Parameters<typeof submitFeedback>[0],
  ctx: TenantContext,
  feedbackId: string,
): Promise<{ id: string; status: string; global: boolean }> {
  const [row] = await tx<
    { id: string; status: string; bookshelf_id: string | null }[]
  >`
    select id, status, bookshelf_id from feedback where id = ${feedbackId}
  `;
  if (!row) throw new RuleViolated("write_target_not_found");
  return {
    id: row.id,
    status: row.status,
    global: auditScopeFor(ctx, row.bookshelf_id),
  };
}

/**
 * Where the audit row for a feedback action lands, decided from the **message**
 * rather than from the caller — and refused outright when the two disagree.
 *
 * `feedback.bookshelf_id` is the schema's one nullable tenant column, so these
 * two commands are the only ones in the catalogue whose target may belong to a
 * shelf *or* to none. `toRow` (`../../kernel/audit.ts`) can only take the shelf
 * from `ctx.bookshelfId`, which a command cannot set — so without this check the
 * shelf on the audit row is whatever the *caller* happened to be scoped to, and
 * nothing anywhere compares it to the message.
 *
 * Both ways that goes wrong are silent. An administrator resolving Vĩnh Long's
 * message while scoped to Đồng Tháp writes "quản trị viên đã xử lý góp ý" into
 * Đồng Tháp's audit log, where its own manager reads it and Vĩnh Long's manager
 * never sees that anything happened. A site-wide message resolved under any
 * shelf scope files a decision about the whole deployment into one parish's
 * record. B3 shipped able to do both — `tests/domain/community/…` had the second
 * one green, resolving a `bookshelf_id is null` message under a shelf context.
 *
 * So the message decides and the context must agree:
 *
 * - **Site-wide message** (`bookshelf_id is null`) → a global audit entry, which
 *   only `runGlobalCommand`/`runAdminCommand` can write, and which requires the
 *   caller to hold no shelf scope. A caller who is scoped to one is refused.
 * - **A shelf's message** → an ordinary shelf-scoped entry, and the caller must
 *   be scoped to *that* shelf, so the parish whose message it is gets the trace.
 *
 * `not_permitted` rather than a new code: the caller is a super_admin either
 * way and no reader ever sees this. It is a wiring mistake, and the sentence a
 * volunteer would read is not the point — `submitAdminCommand`'s `bookshelfId`
 * parameter is what a correct caller passes.
 */
function auditScopeFor(ctx: TenantContext, messageShelf: string | null): boolean {
  if (messageShelf === null) {
    if (ctx.bookshelfId !== "") throw new RuleViolated("not_permitted");
    return true;
  }
  if (ctx.bookshelfId !== messageShelf) throw new RuleViolated("not_permitted");
  return false;
}

export const markFeedbackRead: Command<{ feedbackId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSuperAdmin(ctx);
  const row = await handled(tx, ctx, input.feedbackId);

  await tx`
    update feedback
       set status = 'read',
           handled_by = ${ctx.actor.userId},
           handled_at = ${ctx.clock.now()}
     where id = ${row.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "feedback.read",
      entityType: "feedback",
      entityId: row.id,
      before: { status: row.status },
      after: { status: "read" },
      global: row.global,
    },
  };
};

export const resolveFeedback: Command<{ feedbackId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireSuperAdmin(ctx);
  const row = await handled(tx, ctx, input.feedbackId);

  await tx`
    update feedback
       set status = 'resolved',
           handled_by = ${ctx.actor.userId},
           handled_at = ${ctx.clock.now()}
     where id = ${row.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "feedback.resolved",
      entityType: "feedback",
      entityId: row.id,
      before: { status: row.status },
      after: { status: "resolved" },
      global: row.global,
    },
  };
};

/**
 * **`ArchiveFeedback` is deliberately absent, and this is where that is
 * recorded.**
 *
 * OPS §4.4 lists it "provisionally" and says why: `feedback_status` is exactly
 * three values — `new`, `read`, `resolved` (`0006_community.sql:46`) — while the
 * built admin inbox has a fourth button, "Lưu trữ", with no corresponding status
 * in the domain model. The table also has no `deleted_at`, so a soft-delete
 * reading needs a column too.
 *
 * Either way it is a migration, and the two readings are different products: a
 * fourth *status* says the administrator finished with it, while a soft-delete
 * says it should stop appearing at all. Nothing in the requirements chooses.
 * The button is left doing nothing rather than wired to a guess — the same call
 * C2 made for `SkipRequest`.
 */
