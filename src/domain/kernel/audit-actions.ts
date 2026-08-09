// The one import in this file that points *out* of the kernel, and the trade
// it makes. BR §9's six condition words are defined beside the enum they
// translate (`../catalogue/policy.ts`), because that is where this project puts
// a translation of an enum — `src/lib/roles.ts`, `membership-status.ts` and
// `profile-labels.ts` all make the argument, and all three refuse a second
// copy. Two audit sentences need those words, so the choice is this import or a
// seventh place the words are written. There is no cycle: `catalogue/policy.ts`
// reaches only `kernel/fold`, `kernel/errors` and `kernel/tenant`, none of
// which reach back here. It is data, not behaviour.
//
// This module is in the kernel for the reason `errors.ts` is: the mapping spans
// catalogue, circulation and members, so it belongs to no one of them, and one
// closed union in one place is what keeps totality checkable.
import { CONDITION_LABELS, isCopyCondition } from "../catalogue/policy";

/**
 * Every audit action this system writes, and the Vietnamese sentence for it.
 *
 * BR §14: "The audit browser renders each entry as a readable Vietnamese
 * sentence — 'Quản lý Maria Lan đã cho Giuse Minh mượn *Dế Mèn Phiêu Lưu Ký*
 * lúc 14:32 ngày 03/08' — with the raw before/after values available on
 * expansion."
 *
 * **Why the wording lives in the domain.** `errors.ts:11-16` already settled
 * it for the other family of user-facing sentences this project owns: "a screen
 * calls `ERROR_MESSAGES[code]` rather than writing its own wording for a rule it
 * did not define." An audit sentence is a fact about a domain event — what
 * `receiveReturn` did is `receiveReturn`'s to describe — so the same rule
 * applies, and for the same reason: a UI-owned copy of this mapping eventually
 * drifts from the commands it describes, and nothing would notice.
 *
 * **The map *is* the type, and that is the whole design.** `AuditAction` below
 * is `keyof typeof ACTIONS`, and `AuditEntry.action` is `AuditAction` — so
 * there is no second list anywhere to fall out of step with this one. A command
 * cannot name an action that has no sentence, because the name it would have to
 * write does not exist as a type. That is stronger than the totality *test*
 * the P1 plan §3.1 asks for as a floor, and it is stronger in the direction
 * that matters: a test runs after the fact, while this refuses to compile.
 *
 * §3.1 is explicit about why a weaker guard is not good enough here: "a
 * hand-maintained list beside a transition graph is exactly what let a
 * suspended reader clear their own suspension in B2a." So there is no
 * hand-maintained list. There is one object, and it carries both halves.
 *
 * **The test still exists, and it guards the one hole a type cannot.**
 * `tests/domain/kernel/audit-actions.test.ts` discovers every `action: "…"`
 * literal under `src/domain` from *source text* and asserts the two sets are
 * equal. That catches the two things the compiler cannot see: an action written
 * through an `as AuditAction` cast, and an entry in this map that no command
 * writes any more — a sentence for an event that cannot happen, which is the
 * shape that makes a reader trust a stale map.
 *
 * **Discovery is over `src/domain` entire, never the `commands/` directories.**
 * The P1 reconciliation found `membership.registered` written by
 * `../members/registration.ts`, a helper three commands share, outside any
 * `commands/` directory. A discovery rule shaped like the directory layout
 * would have missed exactly one action, and it is the one a *reader-facing*
 * registration writes.
 *
 * **No sentence renders a raw action name.** `loan.created` on a volunteer's
 * screen is a failure, not a fallback (§3.1). `auditSentence` below therefore
 * has no branch that interpolates `action`, including its unrecognised branch —
 * the raw name is a *stored value*, and BR §14 puts stored values behind the
 * expansion, which is where the browser shows it.
 */

/**
 * The facts a sentence may draw on, and the two kinds are not read alike.
 *
 * - **`before` / `after` are values, printed exactly as stored.** They are what
 *   the command recorded at the time. Nothing here looks a value up: a title
 *   comes from `after.title`, never from `books`, because `UpdateBook` audits
 *   title changes and re-reading the table would quietly restate history the
 *   moment a title is corrected (P1 §3.2).
 * - **`actor` and `subject` are people, resolved from ids the row stores.** An
 *   id is not readable, and resolving one is what a reference is *for*. It stays
 *   true when the person's name changes: "this person did it" is the fact, and
 *   the name a volunteer recognises them by today is the only answer that lets
 *   BR §14's "who has been touching whose account" be answered at all.
 *
 * `subject` is `null` whenever the row names no person — a book, a copy, a
 * parish unit — and whenever it names one this shelf can no longer resolve. Each
 * phrase below states what it says in that case; none of them omits a word and
 * leaves a sentence with a hole in it.
 *
 * The actor's **role** is deliberately not here, and BR §14's example does carry
 * one ("Quản lý Maria Lan"). A role is a value, not a person: a manager who is
 * later made a reader would have every sentence they ever wrote relabelled
 * "Bạn đọc", which is a claim about authority that the log never recorded.
 * `audit_log` stores no role, so the honest sentence names the person and stops.
 */
export interface AuditFacts {
  /** `users.full_name` behind `audit_log.actor_id`. `null` for a system action. */
  actor: string | null;
  /** The person the entry is about, or `null` when it is about no person. */
  subject: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * The four families the browser filters by, and the reason it is four rather
 * than thirty-three.
 *
 * A volunteer looking for "what happened with the books last week" does not
 * think in `copy.condition_assessed`. Thirty-three options in a dropdown is a
 * list to read rather than a filter to use, and the words would all be English
 * enum spellings. So the actions are partitioned, the partition lives on the
 * same entry as the sentence — one object, one place, no second map to drift —
 * and the URL slugs are Vietnamese, matching `?trang-thai=`, `?the-loai=` and
 * every other filter this app puts in a query string.
 *
 * The group is on the entry rather than derived from the `noun.` prefix on
 * purpose: `loan.*` and `request.*` are one family to a volunteer, `profile.*`,
 * `profile_change.*`, `membership.*`, `credentials.*` and `user.*` are another,
 * and a prefix rule would have to encode that somewhere anyway — somewhere
 * being a second list.
 */
export const AUDIT_GROUPS = {
  "muon-tra": "Mượn và trả",
  sach: "Sách",
  "nguoi-doc": "Bạn đọc",
  "cai-dat": "Cài đặt tủ sách",
} as const;

export type AuditGroup = keyof typeof AUDIT_GROUPS;

export interface AuditActionSpec {
  group: AuditGroup;
  /** The verb phrase after "đã". `auditSentence` supplies the frame. */
  phrase: (facts: AuditFacts) => string;
}

/**
 * A trimmed, non-empty string at `key`, or `null`.
 *
 * `Object.hasOwn`, never `in` — `src/lib/search-params.ts`'s `refusalFrom`
 * carries the long version, and a `jsonb` payload is exactly the kind of bag it
 * is about: `before`/`after` are parsed by the driver into ordinary objects, so
 * `"constructor" in bag` is `true` and the read returns a *function*.
 * `String(function)` would then interpolate a function body into a sentence on a
 * volunteer's screen.
 *
 * Non-string values (a number, a boolean, `null`) answer `null` rather than
 * being coerced: a phrase that wants a number asks `flag`/`count`, and a
 * silent `String(false)` in the middle of a sentence is worse than a fallback.
 */
function str(bag: Record<string, unknown> | null, key: string): string | null {
  if (!bag || !Object.hasOwn(bag, key)) return null;
  const value = bag[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A boolean at `key`, or `null` — the same `Object.hasOwn` rule as `str`. */
function flag(bag: Record<string, unknown> | null, key: string): boolean | null {
  if (!bag || !Object.hasOwn(bag, key)) return null;
  const value = bag[key];
  return typeof value === "boolean" ? value : null;
}

/** " vì <lý do>", or nothing at all — never " vì undefined". */
function because(reason: string | null): string {
  return reason ? ` vì ${reason}` : "";
}

/** The person, or the word for "a reader" when the row names nobody. */
function who(subject: string | null): string {
  return subject ?? "một bạn đọc";
}

/** The title as it was stored, or the word for "a book". */
function which(title: string | null): string {
  return title ?? "một cuốn sách";
}

/**
 * Every action, its family, and its sentence.
 *
 * Declared with `satisfies` rather than an annotation so the keys stay literal:
 * `Record<string, AuditActionSpec>` as a type annotation would widen `keyof` to
 * `string` and the compile-time guarantee at the top of this file would quietly
 * become nothing. The `satisfies` still checks every value.
 */
const ACTIONS = {
  // — sách —
  "book.created": {
    group: "sach",
    phrase: (f) => `thêm sách ${which(str(f.after, "title"))}`,
  },
  "book.updated": {
    group: "sach",
    phrase: (f) => `sửa thông tin sách ${which(str(f.after, "title"))}`,
  },
  "book.deleted": {
    group: "sach",
    phrase: (f) => `xoá sách ${which(str(f.before, "title"))}`,
  },
  "copy.added": {
    group: "sach",
    phrase: (f) => {
      const code = str(f.after, "code");
      return code ? `thêm bản sách ${code}` : "thêm một bản sách";
    },
  },
  "copy.condition_assessed": {
    group: "sach",
    phrase: (f) => {
      // The stored enum value, translated by the map that owns the words
      // (`../catalogue/policy.ts`). `isCopyCondition` is what keeps a payload
      // written by an older or a future build from reaching `CONDITION_LABELS`
      // with a key it has no word for.
      const raw = str(f.after, "condition");
      const word = raw && isCopyCondition(raw) ? CONDITION_LABELS[raw] : null;
      return word
        ? `ghi nhận tình trạng một bản sách: ${word}`
        : "ghi nhận tình trạng một bản sách";
    },
  },
  "copy.retired": {
    group: "sach",
    phrase: (f) => `ngừng dùng một bản sách${because(str(f.after, "reason"))}`,
  },
  "copy.lost_reported": {
    group: "sach",
    phrase: () => "báo mất một bản sách",
  },
  "copy.found": {
    group: "sach",
    phrase: () => "tìm lại được một bản sách đã mất",
  },

  // — mượn và trả —
  "loan.created": {
    group: "muon-tra",
    phrase: (f) =>
      f.subject
        ? `cho ${f.subject} mượn ${which(str(f.after, "title"))}`
        : `cho mượn ${which(str(f.after, "title"))}`,
  },
  "loan.returned": {
    group: "muon-tra",
    phrase: (f) => {
      const raw = str(f.after, "condition");
      const word = raw && isCopyCondition(raw) ? CONDITION_LABELS[raw] : null;
      const from = f.subject ? ` từ ${f.subject}` : "";
      const state = word ? `, tình trạng ${word}` : "";
      return `nhận trả ${which(str(f.after, "title"))}${from}${state}`;
    },
  },
  "loan.voided": {
    group: "muon-tra",
    phrase: (f) => `huỷ một lượt mượn${because(str(f.after, "reason"))}`,
  },
  "loan.lost": {
    group: "muon-tra",
    // `reportCopyLost` writes this one *after* `copy.lost_reported`, so the two
    // read as a pair: the copy was reported missing, and the loan it was out on
    // ended because of it. "kết thúc … vì" is what `loans.status` actually did
    // — the earlier wording ("ghi nhận một lượt mượn là sách đã mất") stacked
    // two nouns on one verb and read as a translation rather than as a
    // sentence.
    phrase: () => "kết thúc một lượt mượn vì sách bị mất",
  },
  "request.approved": {
    group: "muon-tra",
    phrase: () => "giữ chỗ một cuốn sách cho bạn đọc đang chờ",
  },
  "request.fulfilled": {
    group: "muon-tra",
    phrase: () => "giao cuốn sách đã giữ chỗ cho bạn đọc",
  },

  // — bạn đọc —
  "membership.registered": {
    group: "nguoi-doc",
    phrase: (f) => {
      // `registrationAudit` stores the name it was given, so this one does not
      // need the subject join at all — and it is the entry most likely to name
      // somebody whose `users` row a later merge moved.
      const name = str(f.after, "fullName");
      return name ? `nhận đăng ký của ${name}` : "nhận một đăng ký mới";
    },
  },
  "membership.approved": {
    group: "nguoi-doc",
    phrase: (f) => `duyệt tài khoản của ${who(f.subject)}`,
  },
  "membership.rejected": {
    group: "nguoi-doc",
    phrase: (f) =>
      `từ chối đăng ký của ${who(f.subject)}${because(str(f.after, "reason"))}`,
  },
  "membership.suspended": {
    group: "nguoi-doc",
    phrase: (f) => `tạm khoá tài khoản của ${who(f.subject)}`,
  },
  "membership.reactivated": {
    group: "nguoi-doc",
    phrase: (f) => `mở lại tài khoản của ${who(f.subject)}`,
  },
  "membership.left": {
    group: "nguoi-doc",
    phrase: (f) => `đánh dấu ${who(f.subject)} đã rời tủ sách`,
  },
  "membership.updated": {
    group: "nguoi-doc",
    // `updateOwnProfile` is the only writer and it changes one field, so the
    // sentence says which way it went rather than that "something changed".
    // "bảng bạn đọc chăm nhất" is the shipped wording from the reader's own
    // profile form, not a new name for the leaderboard.
    phrase: (f) => {
      const on = flag(f.after, "leaderboard_opt_in");
      if (on === null) return "đổi cài đặt tài khoản của mình";
      return on
        ? "chọn hiện tên trong bảng bạn đọc chăm nhất"
        : "chọn ẩn tên khỏi bảng bạn đọc chăm nhất";
    },
  },
  "credentials.set": {
    group: "nguoi-doc",
    // BR §2, and the reason this action exists at all: "this manager set or
    // changed the sign-in details of this reader, at this time". The entry
    // carries no `before` and no `after` on purpose (`set-reader-credentials
    // .ts:138`), so the sentence carries no more than the act either.
    //
    // **"đặt hoặc đổi", both halves.** `setReaderCredentials` is the only
    // writer and it serves both cases — a child given a way in for the first
    // time, and a password reset for one who already had one — and the entry
    // deliberately stores nothing that could tell them apart. A sentence saying
    // only "đặt" would read as the first, which is the milder of the two: BR §2
    // makes visibility the entire mitigation for this power, and a log that
    // understates the act on the row a manager is being held to is the one
    // place understatement is not a style choice.
    phrase: (f) => `đặt hoặc đổi tài khoản đăng nhập cho ${who(f.subject)}`,
  },
  "user.password_changed": {
    group: "nguoi-doc",
    // `changeOwnPassword`. The actor and the subject are the same person, so
    // naming them twice would read as though somebody changed somebody else's.
    phrase: () => "đổi mật khẩu của mình",
  },
  "profile.corrected": {
    group: "nguoi-doc",
    phrase: (f) => `sửa hồ sơ của ${who(f.subject)}`,
  },
  "profile_change.proposed": {
    group: "nguoi-doc",
    phrase: () => "gửi yêu cầu đổi thông tin",
  },
  "profile_change.approved": {
    group: "nguoi-doc",
    phrase: (f) => `duyệt đổi thông tin cho ${who(f.subject)}`,
  },
  "profile_change.rejected": {
    group: "nguoi-doc",
    phrase: (f) =>
      `từ chối một yêu cầu đổi thông tin${because(str(f.after, "rejection_reason"))}`,
  },
  "profile_change.cancelled": {
    group: "nguoi-doc",
    phrase: () => "rút lại yêu cầu đổi thông tin của mình",
  },

  // — cài đặt tủ sách —
  "parish_unit.created": {
    group: "cai-dat",
    phrase: (f) => {
      const name = str(f.after, "name");
      return name ? `thêm đơn vị ${name}` : "thêm một đơn vị";
    },
  },
  "parish_unit.renamed": {
    group: "cai-dat",
    phrase: (f) => {
      const from = str(f.before, "name");
      const to = str(f.after, "name");
      if (from && to) return `đổi tên đơn vị ${from} thành ${to}`;
      return to ? `đổi tên một đơn vị thành ${to}` : "đổi tên một đơn vị";
    },
  },
  "parish_unit.deleted": {
    group: "cai-dat",
    phrase: (f) => {
      const name = str(f.before, "name");
      // `cascaded` is on the entry rather than in a second action name
      // (`delete-parish-unit.ts:93-95`), so the sentence is where a reader of
      // one entry learns it was not clicked.
      const tail = flag(f.after, "cascaded") ? " theo đơn vị cấp trên" : "";
      return name ? `xoá đơn vị ${name}${tail}` : `xoá một đơn vị${tail}`;
    },
  },
  "parish_unit.reordered": {
    group: "cai-dat",
    phrase: () => "đổi thứ tự các đơn vị",
  },
  "parish_taxonomy.updated": {
    group: "cai-dat",
    phrase: () => "đổi cách chia đơn vị của tủ sách",
  },
} satisfies Record<string, AuditActionSpec>;

/**
 * The closed set of actions. `AuditEntry.action` is this type, so a command
 * writing anything else does not compile.
 */
export type AuditAction = keyof typeof ACTIONS;

/** The same object, widened for iteration. `ACTIONS` keeps the literal keys. */
export const AUDIT_ACTIONS: Record<AuditAction, AuditActionSpec> = ACTIONS;

/** Every action name, as data — what a group filter turns into a `where`. */
export const AUDIT_ACTION_NAMES = Object.keys(ACTIONS) as AuditAction[];

/** The actions in one family, discovered from the map rather than listed. */
export function actionsInGroup(group: AuditGroup): AuditAction[] {
  return AUDIT_ACTION_NAMES.filter((a) => AUDIT_ACTIONS[a].group === group);
}

/**
 * The family an entry belongs to, or `null` for a stored action this build has
 * no sentence for.
 *
 * `action` is a plain `string` for `auditSentence`'s reason: it comes off an
 * append-only table whose rows were written by whichever build was deployed.
 * A `null` here is what lets the browser mark such an entry without guessing a
 * family for it.
 */
export function auditGroupOf(action: string): AuditGroup | null {
  return Object.hasOwn(AUDIT_ACTIONS, action)
    ? AUDIT_ACTIONS[action as AuditAction].group
    : null;
}

/** `?viec=` → a family, or `undefined` for anything else somebody typed. */
export function auditGroupFromParam(
  raw: string | undefined,
): AuditGroup | undefined {
  if (raw === undefined) return undefined;
  // `Object.hasOwn`, never `in` — this map is reachable from an address bar,
  // and `"constructor" in AUDIT_GROUPS` is `true`.
  return Object.hasOwn(AUDIT_GROUPS, raw) ? (raw as AuditGroup) : undefined;
}

/**
 * What an entry says, in one sentence.
 *
 * `action` is a plain `string` and not `AuditAction`, deliberately: it arrives
 * from `audit_log.action`, a `text` column on an **append-only** table, and the
 * rows in it were written by whatever build was deployed at the time. A row
 * whose action this build has no sentence for is therefore a real state — an
 * older name, a rolled-back feature — and not a programming error to throw on.
 * Refusing the whole page over one such row would take the audit trail away at
 * exactly the moment somebody is investigating something.
 *
 * **The unrecognised branch never prints the action.** §3.1: `loan.created` on
 * a volunteer's screen is a failure, not a fallback. The raw name is a stored
 * value like any other, and BR §14 puts stored values behind the expansion,
 * which is where the browser shows it — beside `before` and `after`, labelled,
 * in the place a person goes when they are genuinely investigating.
 *
 * `when` arrives already formatted, as two parts. Every word of the sentence is
 * this module's; every *number* in it is `Intl`'s, through `src/lib/dates.ts`
 * (SDD §6.6). Splitting it in two is what keeps both of those true at once —
 * a single pre-glued string would have had to contain the word "ngày", and a
 * `Date` passed in here would have put a formatter in the domain.
 */
export function auditSentence(
  action: string,
  facts: AuditFacts,
  when: { time: string; date: string },
): string {
  const spec = Object.hasOwn(AUDIT_ACTIONS, action)
    ? AUDIT_ACTIONS[action as AuditAction]
    : null;
  const phrase = spec
    ? spec.phrase(facts)
    : "thực hiện một thao tác hệ thống chưa được mô tả";
  // "Hệ thống" for a null actor — the same word the audit browser's own design
  // uses for an entry nobody clicked. `audit_log.actor_id` is nullable
  // (`0007:25`, "null for system actions").
  return `${facts.actor ?? "Hệ thống"} đã ${phrase} lúc ${when.time} ngày ${when.date}`;
}
