import {
  Archive,
  AlertTriangle,
  BookMarked,
  BookOpen,
  Bookmark,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

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
