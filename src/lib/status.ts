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

/** The six condition grades from §9. A flat list, deliberately not a scale. */
export const CONDITIONS = [
  "Nguyên vẹn",
  "Hơi cũ",
  "Cũ",
  "Rách",
  "Mất trang",
  "Bị vẽ vào",
] as const;

export type Condition = (typeof CONDITIONS)[number];

/**
 * The Vietnamese word for each value of the `copy_condition` enum.
 *
 * Written out as a `Record<CopyCondition, Condition>` rather than zipped
 * against `CONDITIONS` by index, which is the version that looks tidier and
 * silently mislabels every copy on the shelf the day somebody reorders either
 * list. Typed on `CopyCondition`, so adding a seventh grade to
 * `COPY_CONDITIONS` (`domain/catalogue/policy.ts`) is a compile error here
 * rather than a picker that quietly cannot offer it.
 *
 * The words themselves are not new: they are `CONDITIONS` above, which came
 * from BR §9. The enum's spellings are the database's, from
 * `0004_catalogue.sql`. This is the only place the two meet.
 */
export const CONDITION_LABELS: Record<CopyCondition, Condition> = {
  perfect: "Nguyên vẹn",
  slightly_worn: "Hơi cũ",
  worn: "Cũ",
  torn: "Rách",
  missing_pages: "Mất trang",
  written_on: "Bị vẽ vào",
};
