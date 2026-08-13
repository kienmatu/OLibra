import type { Block } from "../kernel/block";
import type { ErrorCode } from "../kernel/errors";
import { RuleViolated, ValidationFailed } from "../kernel/errors";
import { atLeast, type TenantContext } from "../kernel/tenant";

/**
 * The members domain's pure rules. No SQL, no clock, no I/O — everything here
 * is a function of its arguments, so BR §7.5's state machine can be read and
 * tested without a database, the same way `../catalogue/policy.ts` holds BR
 * §7.1's.
 */

/**
 * `membership_status` in the database, spelled exactly as the enum spells it.
 *
 * **An array, with the type derived from it** — the shape `COPY_CONDITIONS`
 * already uses in `../catalogue/policy.ts`, and U3 wave 2 needed the runtime
 * half of it. A bare union is invisible at runtime, so a surface that maps every
 * status to a Vietnamese word (`src/lib/membership-status.ts`) had no way to
 * assert it covered all five; a sixth status added to the union would simply not
 * have been offered as a filter, silently. This costs nothing and makes that
 * omission a red test.
 */
export const MEMBERSHIP_STATUSES = [
  "pending",
  "active",
  "suspended",
  "left",
  "rejected",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** `membership_role`. Distinct from kernel `Role`, which also knows super_admin. */
export type MembershipRole = "reader" | "manager" | "admin";

/**
 * BR §7.5's diagram, arrow for arrow, plus two arrows the diagram does not
 * draw but the catalogue and the requirements both require:
 *
 * - **any → left, including left → left.** OPS §4.3's MarkMembershipLeft is
 *   explicit: "Any status → left". BR §7.5 draws only `active`/`suspended →
 *   left` because those are the interesting cases; a pending application
 *   whose family moved away before anyone got to it is still a real thing to
 *   close. "Any" is read literally rather than "any status other than left
 *   itself": M6 (fix-report, 2026-08-08-b2-members) — without this self-loop
 *   a volunteer re-clicking "Đánh dấu đã rời" on someone who already left
 *   fell through to the same sentence ApproveMembership uses for a decided
 *   registration, which is not what happened here. Idempotent rather than a
 *   bespoke "already left" refusal, because OPS's sentence draws no
 *   distinction and a second click changing nothing is the least surprising
 *   reading of "Any status → left" for a status that is already `left`.
 * - **rejected → pending and left → pending.** BR §2: rejected registrations
 *   "are retained with a reason for audit purposes, and the person may
 *   re-apply". Re-applying cannot be a second row: `memberships_one_per_shelf`
 *   is `unique (bookshelf_id, user_id) where deleted_at is null` and ignores
 *   status entirely — verified live, a second insert over a `rejected` row
 *   raises 23505. So a re-application walks the existing row back to
 *   `pending`, which keeps its id, and therefore keeps every audit entry
 *   already pointing at that relationship pointing at the same one.
 *
 * Written as data rather than as a chain of `if`s so the diagram in the
 * requirements and the table here can be compared by eye.
 */
const ALLOWED: ReadonlySet<string> = new Set(
  (
    [
      ["pending", "active"],
      ["pending", "rejected"],
      ["active", "suspended"],
      ["suspended", "active"],
      ["pending", "left"],
      ["active", "left"],
      ["suspended", "left"],
      ["rejected", "left"],
      ["left", "left"],
      ["rejected", "pending"],
      ["left", "pending"],
    ] as const
  ).map(([from, to]) => `${from}->${to}`),
);

/**
 * Why a particular refusal, in the words the volunteer will actually read.
 *
 * Ordered by what the caller was *trying* to do, because unlike a copy (whose
 * current state usually explains the refusal) a membership's refusals are
 * command-shaped: OPS §4.3 gives suspend and reactivate their own sentences
 * naming what is allowed instead, exactly as BR §17.7 asks.
 *
 * `to === "active"` is ambiguous on its own — it is ReactivateMembership's
 * target (from `suspended`, already allowed above) *and* ApproveMembership's
 * (from `pending`, also already allowed above), so anything reaching this
 * function with `to === "active"` came from neither. `from` disambiguates
 * the two remaining cases: `left`/`rejected` is a genuine reactivation
 * attempt aimed at a terminal state ("only a suspended account can be
 * reactivated"), while `from === "active"` is an approval replayed against a
 * membership that is already active — that one gets ApproveMembership's own
 * sentence, not reactivate's, because nothing was ever suspended.
 */
function refusalFor(from: MembershipStatus, to: MembershipStatus): ErrorCode {
  if (to === "suspended") return "not_active_cannot_suspend";
  if (to === "active" && (from === "left" || from === "rejected")) {
    return "not_suspended_cannot_reactivate";
  }
  // Approve and reject both act on a pending application; reaching here means
  // it was already decided. OPS §4.3: "Đơn đăng ký này đã được xử lý."
  return "registration_not_pending";
}

export function membershipTransition(
  from: MembershipStatus,
  to: MembershipStatus,
): { allowed: boolean; reason?: ErrorCode } {
  if (ALLOWED.has(`${from}->${to}`)) return { allowed: true };
  return { allowed: false, reason: refusalFor(from, to) };
}

/**
 * INV-4, the members half: "A reader whose membership is not *active* cannot
 * start a new loan. Existing loans are unaffected."
 *
 * Deliberately narrow. It answers one question — is this relationship in good
 * standing right now — and knows nothing about how many books the person
 * already holds, which is INV-5 and needs an aggregate over `loans`. C1's
 * `memberMayBorrow` composes the two; it does not restate this one, because
 * two copies of a status list are two things that can disagree.
 *
 * Returns the kernel's shared `Block`, the same shape `validateSelection` in
 * `./parish-taxonomy.ts` already returns, so a screen can render a refusal
 * from either without knowing which domain produced it.
 */
export function membershipAllowsNewLoan(m: { status: MembershipStatus }): Block {
  if (m.status === "active") return { blocked: false };
  return { blocked: true, reason: "membership_not_active" };
}

/** OPS §4.3, in both RegisterMembership and SetReaderCredentials. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * `[...password].length`, not `password.length`.
 *
 * `String.prototype.length` counts UTF-16 code units, so a password written in
 * Vietnamese with characters outside the BMP would be over-counted, and one
 * built from surrogate pairs could pass at seven real characters. The spread
 * iterates code points. This is copy a child reads ("Mật khẩu cần ít nhất 8
 * ký tự" — *ký tự* is characters), so characters is what it must count.
 */
export function assertPasswordLength(
  password: string,
  code: "password_too_short" | "new_password_too_short",
): void {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new ValidationFailed(code, "password");
  }
}

/**
 * BR §13.3: "the interface hiding an action is never the security control."
 *
 * Restated over the kernel's `atLeast` rather than imported from
 * `src/auth/guards.ts`, because `tests/architecture/boundaries.test.ts`
 * forbids `src/domain` importing `src/auth` — the same three lines
 * `../catalogue/policy.ts` already carries, and the same note applies: the
 * tidier end state is `requireRole` moving into `src/domain/kernel/tenant.ts`
 * with `guards.ts` re-exporting it, which touches `src/auth` and is outside
 * this slice.
 */
export function requireManager(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "manager")) throw new RuleViolated("not_permitted");
}

/** OPS §3.2: a member-facing read requires a membership *of this shelf*. */
export function requireReader(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "reader")) throw new RuleViolated("not_permitted");
}

/**
 * OPS §4.5's caller for every parish-unit and taxonomy command.
 *
 * **It is never enough on its own, and that is the point of this docstring.**
 * `systemContext` (`../kernel/tenant.ts`) yields
 * `{ userId: null, membershipId: null, role: "super_admin" }` — the highest rank
 * in the table, with nobody behind it — so a command gated on rank alone
 * *passes* under the seed's or a scheduled job's context and commits an audit
 * row whose actor columns are all null. INV-8 wants the actor by name. That
 * defect has already shipped once, in `voidLoan`, and `requireIdentifiedActor`
 * exists to record it; every one of the five commands calls **both**.
 *
 * `atLeast` is used rather than `ctx.actor.role === "super_admin"` for
 * consistency with the three gates above, even though `super_admin` is the top
 * of `ROLE_RANK` and the two are equivalent today. An equality test would
 * silently become the wrong check the day a rank is added above it, and would
 * read as if it were deliberately excluding something rather than requiring a
 * minimum.
 */
export function requireSuperAdmin(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "super_admin")) {
    throw new RuleViolated("not_permitted");
  }
}

/**
 * OPS §4.3's "reader (self only)" caller, with a manager admitted on top.
 *
 * The self check compares `ctx.actor.membershipId`, which `contextFor`
 * (`src/auth/guards.ts`) resolves from the session and the shelf — never a
 * value the caller supplied. A `guest` has `membershipId: null`, so the strict
 * inequality below refuses them without a separate branch; a `super_admin`
 * browsing a shelf they hold no membership of also has `null`, and passes on
 * the role check instead.
 */
export function requireSelfOrManager(
  ctx: TenantContext,
  membershipId: string,
): void {
  if (atLeast(ctx.actor.role, "manager")) return;
  if (ctx.actor.membershipId !== null && ctx.actor.membershipId === membershipId) {
    return;
  }
  throw new RuleViolated("not_permitted");
}

/** Whitespace is absence. A form posts "   " far more often than it posts null. */
export function blank(v: string | null | undefined): boolean {
  return !v || v.trim() === "";
}

/**
 * QA remediation Task 18. `khong-phai-so`, typed into the required "Số điện
 * thoại" on `/quan-ly/nguoi-doc/moi`, was accepted, stored, and rendered as a
 * `tel:khong-phai-so` link on the approval card, the reader profile and the
 * overdue list. `/tu-sach/[shelf]/gop-y` already used `type="tel"` on its own
 * phone box — the knowledge existed, it simply had never been written down as
 * a rule the *domain* checks, which is why every member-facing form that
 * forgot to mirror it let anything through.
 *
 * **The shape, and why it is this shape and not a stricter one.** "9-11
 * digits after stripping spaces, dots and dashes, optionally `+84`-prefixed"
 * was read off two sources before it was chosen, not assumed: `src/db/
 * seed.ts`'s fixture phone numbers and the live dev database (`select phone,
 * count(*) from users group by phone`, run against `olibra-db-1` while this
 * task was written) both carry every number as ten digits, sometimes grouped
 * with spaces ("0912 345 678") or written solid ("0999888777") — the ten
 * -digit mobile shape Vietnam has used since 2018. Nothing in either database
 * carries a `+84` prefix or a landline's shorter local shape today, but BR
 * §5.3's "the parents' number is fine too" and OPS §8's own examples do not
 * rule either out, so both are accepted rather than narrowed to exactly what
 * happens to exist right now. Dots and dashes are stripped for the same
 * reason spaces are: a number copied by hand off a printed parish list is as
 * likely to be grouped "091.234.5678" as "091 234 5678", and the person typing
 * it is not the one this rule should punish for a formatting choice.
 *
 * A function returning a boolean, not a `Block` — this file already has one
 * shape for "may I?" questions asked before a write (`membershipAllowsNewLoan`
 * above) and this is not that: nothing asks "would a phone number be accepted"
 * ahead of typing one, and `assertPhone` below is the only caller that needs
 * to *stop* anything. `PhoneLink` (`src/components/ui/phone-link.tsx`) is the
 * second caller, and it needs exactly a yes/no to decide whether to render a
 * `tel:` anchor — never a reason, since a reader viewing a profile is not the
 * audience for a validation message about data somebody else typed.
 */
export function isValidPhone(phone: string): boolean {
  return /^(\+84)?\d{9,11}$/.test(phone.trim().replace(/[\s.-]/g, ""));
}

/**
 * The HTML `pattern` a phone `<input type="tel">` mirrors this rule with, on
 * every form OPS §4.3 and §4.5 route a phone number through. A generous
 * approximation rather than an exact restatement of `isValidPhone` — HTML
 * `pattern` cannot express "strip separators, then count digits" in one
 * expression — so this accepts a slightly wider set (it does not verify the
 * digit count after stripping) than the domain does. That asymmetry is
 * deliberate and safe: the browser check is a hint that saves a round trip
 * for the ordinary typo, `assertPhone` below is what actually decides, the
 * same relationship Task 15's `checkPolicyBound` has with the `min`/`max`
 * mirrored onto the two admin forms.
 */
export const PHONE_PATTERN = "[+0-9][0-9 .-]{7,13}";

/**
 * Refuses `phone` unless `isValidPhone` accepts it — see that function's own
 * docstring for the shape and the two databases it was read off. `field` is
 * the caller's own field name (`"phone"`, `"contactPhone"`, or — since PO
 * feedback round 1, Task 2 replaced the shelf's single `keeperPhone` with up
 * to three `bookshelf_contacts` rows — `` `contact_${position}_phone` ``), so
 * `ValidationFailed.field` points at the box a volunteer actually typed into
 * rather than always saying "phone" regardless of which form it was.
 *
 * Every caller is responsible for its own blank check first: a shelf
 * contact's `phone`, the administration's `contactPhone`, and (PO feedback
 * round 1, Task 8) `register()`'s own `input.phone` must all skip this call
 * entirely when the field is absent or being cleared — `null` means "no
 * phone on file", not "an invalid one". `register()` no longer refuses a
 * blank phone unconditionally; it refuses `thieu-so-dien-thoai` only when no
 * reason accompanies it, and calls this function only once it has decided
 * the phone itself is not blank.
 */
export function assertPhone(phone: string, field: string): void {
  if (!isValidPhone(phone)) {
    throw new ValidationFailed("phone_invalid", field);
  }
}
