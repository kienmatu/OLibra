import {
  Archive,
  AlertTriangle,
  BookMarked,
  BookOpen,
  Bookmark,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import type { CopyCondition, CopyState } from "@/domain/catalogue/policy";
import type { Availability } from "@/domain/catalogue/queries/get-catalogue";

/**
 * The six copy states from BUSINESS-REQUIREMENTS §17.2.
 *
 * Status is never carried by colour alone. Every state here bundles an icon,
 * a Vietnamese word and a colour together, so a component cannot render one
 * without the others — the rule is enforced by the type, not by discipline.
 */
export type CopyStatus =
  "available" | "onloan" | "held" | "overdue" | "lost" | "retired";

export type StatusDescriptor = {
  label: string;
  icon: LucideIcon;
  /** Tailwind text colour for the ink (icon + word). */
  ink: string;
  /** Tailwind background for the 10% tint fill. */
  fill: string;
  /** Tailwind border colour, for the large availability panels. */
  border: string;
};

export const STATUS: Record<CopyStatus, StatusDescriptor> = {
  available: {
    label: "Còn sách",
    icon: BookOpen,
    ink: "text-available",
    fill: "bg-available/10",
    border: "border-available",
  },
  onloan: {
    label: "Đang mượn",
    icon: BookMarked,
    ink: "text-onloan",
    fill: "bg-onloan/10",
    border: "border-onloan",
  },
  held: {
    label: "Đang giữ chỗ",
    icon: Bookmark,
    ink: "text-held",
    fill: "bg-held/10",
    border: "border-held",
  },
  overdue: {
    label: "Quá hạn",
    icon: AlertTriangle,
    ink: "text-overdue",
    fill: "bg-overdue/10",
    border: "border-overdue",
  },
  lost: {
    label: "Đã mất",
    icon: HelpCircle,
    ink: "text-lost",
    fill: "bg-lost/10",
    border: "border-lost",
  },
  retired: {
    label: "Ngừng dùng",
    icon: Archive,
    ink: "text-retired",
    fill: "bg-retired/10",
    border: "border-retired",
  },
};

/**
 * `book_copies.state` → the badge that describes it.
 *
 * Five of the six badges above; `overdue` is deliberately unreachable from
 * here, because it is not a copy state at all. BR §8 derives it from the loan
 * (`loans_current.is_overdue`, computed on read against `olibra_now()`), so a
 * screen showing an overdue badge must have a *loan* in hand — never a copy
 * row alone. Spelling the map out this way is what stops a caller from
 * reaching for "overdue" where it cannot honestly be known.
 */
export const COPY_STATE_STATUS: Record<CopyState, CopyStatus> = {
  available: "available",
  held: "held",
  on_loan: "onloan",
  lost: "lost",
  retired: "retired",
};

/**
 * A title's aggregate `availability` → the badge for it, or **no badge**.
 *
 * `Availability` is `CopyState | "none"` (`get-catalogue.ts`), and `"none"` is
 * the member M8 added precisely because a title with no live copies at all had
 * been indistinguishable from one whose copies are genuinely all retired. There
 * is no honest badge for it: `STATUS.retired` says "Ngừng dùng", which is a
 * claim about copies that were withdrawn, and this title has none to withdraw.
 * So this returns `null` and the caller renders nothing — the same answer the
 * lending search already gives a blocked row, whose comment records the same
 * reasoning ("a blocked title has no honest badge").
 *
 * A `Record` over the five real states rather than a `switch`, for the reason
 * `COPY_STATE_STATUS` above is one: adding a sixth `copy_state` is then a
 * compile error here rather than a title that quietly renders no badge.
 */
export function statusForAvailability(
  availability: Availability,
): CopyStatus | null {
  return availability === "none" ? null : COPY_STATE_STATUS[availability];
}

/**
 * BR §9's six condition grades, and the Vietnamese word for each.
 *
 * **Both now live in `domain/catalogue/policy.ts` and are re-exported here**
 * (P1). They shipped in this file, which was right while the only reader was a
 * screen; BR §14's audit sentence for a return names the condition
 * ("…tình trạng Nguyên vẹn…") and that sentence is the domain's, so the word
 * had to move to where the enum is. The domain cannot reach back into this
 * file — it imports `lucide-react` and `@/domain/catalogue/policy` — so a copy
 * here would have been a second set of words, which is exactly what the
 * moved-to docstring argues against.
 *
 * Re-exported rather than deleted so the screens already importing
 * `CONDITION_LABELS` and `CONDITIONS` from here keep compiling: this is a move,
 * and a move should not be a change to six call sites.
 */
export {
  CONDITION_LABELS,
  CONDITION_WORDS as CONDITIONS,
  type ConditionWord as Condition,
} from "@/domain/catalogue/policy";
