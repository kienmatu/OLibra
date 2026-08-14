// Relative, not the `@/` alias: `avatar-proposal.tsx` is the first client
// component to pull this file into a test's import graph
// (`tests/components/avatar-proposal.test.tsx`), and `vitest.config.ts` has
// no `resolve.alias` for `@/`. `./button.tsx`, `./phone-link.tsx`,
// `./field.tsx` and `./segmented.tsx` already made this same switch for the
// identical reason.
import { cn } from "../../lib/utils";

/**
 * A tinted pill carrying an icon, a Vietnamese word and a colour — together,
 * always.
 *
 * `StatusBadge` covers the six copy states from §7.1, whose labels are fixed.
 * This is for every other state in the product — membership, role, post status,
 * days remaining, return condition — where the wording varies but the rule that
 * status is never colour alone still holds. Six pages had each grown their own
 * near-identical version of this before it was consolidated here.
 *
 * Both props are required, so a colour-only pill cannot be written.
 */
export type PillTone =
  | "available"
  | "onloan"
  | "held"
  | "overdue"
  | "lost"
  | "retired"
  | "sage"
  | "neutral";

const TONES: Record<PillTone, string> = {
  available: "bg-available/10 text-available",
  onloan: "bg-onloan/10 text-onloan",
  held: "bg-held/10 text-held",
  overdue: "bg-overdue/10 text-overdue",
  lost: "bg-lost/10 text-lost",
  retired: "bg-retired/10 text-retired",
  sage: "bg-sage/10 text-sage",
  neutral: "bg-paper text-leather",
};

export function Pill({
  icon: Icon,
  label,
  tone = "neutral",
  className,
}: {
  /** Required: a pill without an icon is a defect. */
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Required: a pill without a word is a defect. */
  label: string;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-control px-2.5 py-1 text-[14px] font-medium",
        TONES[tone],
        className,
      )}
    >
      <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {label}
    </span>
  );
}
