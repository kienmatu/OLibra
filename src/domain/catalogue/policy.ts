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
 * The folding is the same folding search uses (`src/lib/search.ts`'s
 * `fold`, and its SQL twin `olibra_fold`), reimplemented here rather than
 * imported so the domain does not depend on `src/lib` for a rule of its own;
 * `tests/db/folding.test.ts` is what keeps the two SQL/TS implementations in
 * step, and Task 1's test is what keeps this one honest against the fixtures.
 */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
