import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The quiet three-step marker for the quick-lend flow. Restrained on purpose —
 * it orients, it does not decorate, and it must never compete with the one
 * primary action on the screen.
 *
 * Was duplicated across all three step pages before being consolidated here.
 */
export function StepIndicator({
  steps,
  current,
  className,
}: {
  steps: string[];
  /** 1-based index of the step being shown. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                done && "bg-terracotta text-white",
                active && "bg-terracotta text-white",
                !done && !active && "border border-hairline text-meta",
              )}
            >
              {done ? <Check className="size-[14px]" strokeWidth={2.5} /> : n}
            </span>
            <span
              className={cn(
                "text-[15px]",
                active ? "font-medium text-ink" : "text-meta",
              )}
            >
              {label}
            </span>
            {n < steps.length ? (
              <span aria-hidden className="ml-2 h-px w-8 bg-hairline" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
