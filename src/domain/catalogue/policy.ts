import { fold } from "../kernel/fold";
import type { ErrorCode } from "../kernel/errors";
import { RuleViolated } from "../kernel/errors";
import { atLeast, type TenantContext } from "../kernel/tenant";

/**
 * The catalogue's pure rules. No SQL, no clock, no I/O — everything here is
 * a function of its arguments, so the state machine can be read and tested
 * without a database, which is what BR §6 means by "the specification of
 * correctness".
 */

/** `copy_state` in the database, spelled exactly as the enum spells it. */
export type CopyState = "available" | "held" | "on_loan" | "lost" | "retired";

/** BR §9. A flat list, not a scale; `lost` is a state, not a condition. */
export const COPY_CONDITIONS = [
  "perfect",
  "slightly_worn",
  "worn",
  "torn",
  "missing_pages",
  "written_on",
] as const;

export type CopyCondition = (typeof COPY_CONDITIONS)[number];

export function isCopyCondition(value: unknown): value is CopyCondition {
  return (COPY_CONDITIONS as readonly unknown[]).includes(value);
}

/**
 * The Vietnamese word for each `copy_condition`.
 *
 * **Moved here from `src/lib/status.ts`, not copied** (P1). It shipped in
 * `src/lib/`, which was the right place while the only reader was a screen —
 * and stopped being the right place the moment the *domain* needed the word:
 * BR §14's audit sentence for a return is "…tình trạng Nguyên vẹn…", and that
 * sentence is owned by the domain for the reason `kernel/errors.ts:11-16`
 * gives about `ERROR_MESSAGES`. A domain module cannot import `src/lib/status
 * .ts` — that file imports `lucide-react` and re-imports this one, so the reach
 * would put a component library inside the domain and close a cycle.
 *
 * `src/lib/status.ts` re-exports both names, so every screen that already used
 * them is untouched. The words themselves are unchanged and are not new: they
 * are BR §9's, by way of that file.
 *
 * `Record<CopyCondition, …>` rather than a list zipped by index, which is the
 * version that silently mislabels every copy on the shelf the day somebody
 * reorders either side. A seventh grade added to `COPY_CONDITIONS` is a compile
 * error here.
 */
export const CONDITION_WORDS = [
  "Nguyên vẹn",
  "Hơi cũ",
  "Cũ",
  "Rách",
  "Mất trang",
  "Bị vẽ vào",
] as const;

export type ConditionWord = (typeof CONDITION_WORDS)[number];

export const CONDITION_LABELS: Record<CopyCondition, ConditionWord> = {
  perfect: "Nguyên vẹn",
  slightly_worn: "Hơi cũ",
  worn: "Cũ",
  torn: "Rách",
  missing_pages: "Mất trang",
  written_on: "Bị vẽ vào",
};

/**
 * BR §7.1's transition table, arrow for arrow.
 *
 * Written as data rather than as a chain of `if`s so that the table in the
 * requirements and the table here can be compared by eye, and so that adding
 * an arrow (see Q3, below) is one line.
 *
 * **Q3 — `available → lost` is deliberately absent.** BR §7.1 draws only
 * `on_loan → lost`, and OPS §4.1 flags the manager screen's broader "Báo
 * mất" affordance as an open question rather than a decision. The B1 plan
 * records the reasoning: widening this later is additive, while retracting a
 * transition that has already written rows is not. If the product owner says
 * yes, the change is `["available", "lost"]` in ALLOWED and one test.
 */
const ALLOWED: ReadonlySet<string> = new Set(
  (
    [
      ["available", "held"],
      ["available", "on_loan"],
      ["available", "retired"],
      ["held", "available"],
      ["held", "on_loan"],
      ["on_loan", "available"],
      ["on_loan", "lost"],
      ["lost", "available"],
      ["lost", "retired"],
    ] as const
  ).map(([from, to]) => `${from}->${to}`),
);

/**
 * Why a particular refusal, in the words the volunteer will actually read.
 *
 * Ordered most-specific first: the state the copy is *in* usually explains
 * the refusal better than the transition being attempted does.
 */
function refusalFor(from: CopyState, to: CopyState): ErrorCode {
  if (from === "retired") return "already_retired";
  if (from === "lost" && to !== "available" && to !== "retired") {
    return "already_lost";
  }
  if (to === "lost") {
    // Q3. Reached from `available` and from `held`; both mean the same thing
    // to the person holding the phone — this copy is not out with anybody.
    return "copy_not_on_loan";
  }
  if (to === "retired") {
    return from === "on_loan" ? "copy_on_loan" : "copy_not_available";
  }
  if (to === "available") {
    // MarkCopyFound's failure mode (OPS §4.1): the copy is not lost.
    return "not_lost";
  }
  return "copy_not_available";
}

export function copyStateTransition(
  from: CopyState,
  to: CopyState,
): { allowed: boolean; reason?: ErrorCode } {
  if (ALLOWED.has(`${from}->${to}`)) return { allowed: true };
  return { allowed: false, reason: refusalFor(from, to) };
}

/**
 * `books.slug`, derived from the title exactly as `src/lib/fixtures.ts`
 * already spells it — verified against all twelve fixture titles.
 *
 * **This is `fold` with hyphens instead of spaces, and it says so in code.**
 * An earlier version reimplemented the five folding steps here, on the
 * reasoning that the domain should not depend on `src/lib` for a rule of its
 * own. That instinct was right and the resolution was backwards: folding *is*
 * a domain rule (BR §12), so it moved to `src/domain/kernel/fold` and `src/lib`
 * now borrows it. Two copies of a normalisation drift, and drift between the
 * slug and the search index is exactly the failure DATABASE.md §5 is written
 * about.
 *
 * A title that folds to nothing — punctuation only — would otherwise produce
 * an empty slug, which is not a routable URL segment. It falls back to `sach`,
 * and `pickSlug` disambiguates from there.
 */
export function slugifyTitle(title: string): string {
  return fold(title).replace(/ /g, "-") || "sach";
}

/**
 * Picks a live slug for a title, given the slugs already live on this shelf.
 *
 * CRITICAL 1 (fix-report, 2026-08-08-b1-catalogue): `books_bookshelf_id_slug_key`
 * is a live partial unique index — `unique (bookshelf_id, slug) where
 * deleted_at is null` — so cataloguing a second, different edition of a
 * title this shelf already holds collides on the identical slug the first
 * edition already claimed, and crashes with a raw `23505` (verified live).
 * A different edition is a new `books` row, not `AddCopies`, so the manager
 * has no other path than `CreateBook` for it.
 *
 * The decision this plan makes: disambiguate rather than reject. `base`,
 * then `base-2`, `base-3`, ... — a volunteer holding a second edition should
 * not have to invent a different title to get past a uniqueness rule they
 * cannot see. The slug is an opaque URL segment (see `UpdateBook`'s
 * docstring for why it is never edited once set), so a slightly uglier one
 * is far cheaper than blocking a real cataloguing action.
 *
 * Pure — the caller supplies `existingSlugs` (the live, non-deleted slugs on
 * this shelf that share `base`'s pattern) so this stays a function of its
 * arguments, testable with no database, matching the rest of this file.
 */
export function nextAvailableSlug(
  base: string,
  existingSlugs: readonly string[],
): string {
  if (!existingSlugs.includes(base)) return base;
  let n = 2;
  while (existingSlugs.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Escapes `%`, `_` and the escape character itself for a `LIKE` pattern, so
 * a value containing one is matched literally rather than as a wildcard.
 *
 * M7 (fix-report, 2026-08-08-b1-catalogue): `copy-codes.ts`'s allocator
 * builds `code like ${prefix + "-%"}` from a shelf's `copy_code_prefix`
 * override — free text from `settings`, not folded or restricted to
 * `[a-z0-9]`. A prefix containing `_` (Postgres's LIKE single-character
 * wildcard) would match any hand-imported code with a different letter in
 * that position, widening the max-code scan across codes that were never
 * meant to be in this shelf's sequence. Call this on `prefix` only — the
 * trailing `-%` the allocator appends afterwards is the intended wildcard
 * and must stay unescaped.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The letters in front of a copy code — `DT` in `DT-0215`.
 *
 * There is no `copy_code_prefix` column on `bookshelves`, and adding one
 * would be a migration this slice's file list (master §7.1) does not
 * include. `settings` is already `jsonb` and already the documented home for
 * per-shelf configuration (BR §5.5, DB §4.2: "a shelf row need only store
 * what it overrides"), so an override lives there and the default is derived.
 *
 * The derivation is the initials of the slug's hyphen-separated words, which
 * gives `dong-thap` → `DT`, `can-tho` → `CT`, `ben-tre` → `BT`,
 * `vinh-long` → `VL` — every shelf in the fixtures, unambiguously. A
 * single-word slug has only one initial, which is too thin for a label
 * somebody reads off a book, so it falls back to the slug's first two
 * letters.
 */
export function copyCodePrefix(shelf: {
  slug: string;
  settings: Record<string, unknown> | null;
}): string {
  const override = shelf.settings?.copy_code_prefix;
  if (typeof override === "string" && override.trim() !== "") {
    return override.trim().toUpperCase();
  }
  const initials = shelf.slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return initials.length >= 2
    ? initials.slice(0, 3)
    : shelf.slug.slice(0, 2).toUpperCase();
}

/**
 * `DT` + 215 -> `DT-0215`.
 *
 * Padded here rather than with SQL's `lpad`, which truncates on the right:
 * `lpad('10000', 4, '0')` is `'1000'`, so the ten-thousandth copy on a shelf
 * would collide with the thousandth. `padStart` never shortens a string.
 */
export function formatCopyCode(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

/**
 * BR §13.3: "the interface hiding an action is never the security control."
 *
 * `src/auth/guards.ts` has `requireRole`, but `tests/architecture/
 * boundaries.test.ts` forbids `src/domain` importing `src/auth` — the domain
 * takes a `TenantContext` and never resolves one. These two are the same
 * three lines over the kernel's own `atLeast`. The tidier end state is
 * `requireRole` moving into `src/domain/kernel/tenant.ts` with `guards.ts`
 * re-exporting it; that touches `src/auth`, which is outside this slice.
 */
export function requireManager(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "manager")) throw new RuleViolated("not_permitted");
}

/** OPS §3.2: every catalogue read requires a membership *of this shelf*. */
export function requireReader(ctx: TenantContext): void {
  if (!atLeast(ctx.actor.role, "reader")) throw new RuleViolated("not_permitted");
}

/**
 * QA remediation Task 19. `DonorFields` (`src/components/donor-fields.tsx`)
 * has said "chọn đúng MỘT trong hai cách" — choose exactly ONE of the two
 * ways — since it was written, and nothing enforced it: filling the donor
 * `<select>` **and** the free-text box together used to write
 * `acquired_from = 'bác Hoà'` *and* `acquired_from_membership_id = <that
 * member's id>` onto every copy `CreateBook`/`AddCopies` produced — two
 * contradicting attributions on one row. The CSV export
 * (`../queries/exports.ts`) reports the free text, so the membership link a
 * manager thought they had just recorded was silently discarded from every
 * screen that reads `acquired_from_membership_id` while surviving, wrongly,
 * in the export.
 *
 * A function that throws, not a `Block`. `CreateBook` and `AddCopies` are
 * both already throwing inline the moment their own field checks fail
 * (`required_fields_missing`, `copy_count_invalid`), and this is that same
 * shape, factored out so the one rule reads identically in both callers
 * rather than as two hand-written `if`s that could drift — the same
 * reasoning `checkPolicyBound` (`../admin/policy.ts`) gives for itself.
 *
 * **Both blank is not ambiguous.** OPS §4.1 and the form's own copy call the
 * donor optional — "nhiều sách là mua, không phải tặng" — so the ordinary
 * case of a purchased book with no donor at all must keep working, and does:
 * this only fires when *both* are non-blank.
 */
export function assertSingleDonor(
  donorMembershipId: string | null | undefined,
  donorName: string | null | undefined,
): void {
  const blank = (v: string | null | undefined) => !v || v.trim() === "";
  if (!blank(donorMembershipId) && !blank(donorName)) {
    throw new RuleViolated("donor_ambiguous");
  }
}
