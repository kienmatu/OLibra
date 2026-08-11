import { Phone } from "lucide-react";
import { isValidPhone } from "../../domain/members/policy";
import { cn } from "../../lib/utils";

/**
 * That phone call is the actual mechanism by which books come back, so a
 * number is never plain text — it is always a generous, obvious tap target.
 *
 * **Except when `phone` does not parse as one.** QA remediation Task 18:
 * `khong-phai-so`, typed into "Số điện thoại" and stored before this task
 * added `assertPhone` (`src/domain/members/policy.ts`) to every write path,
 * used to render here as `<a href="tel:khong-phai-so">` — a tap target that
 * looks exactly as generous and obvious as a real one, and dials nothing. A
 * bad value can still reach this component even after Task 18: a row written
 * before the guard existed, or written directly against the database. Rather
 * than trust every caller to have validated first, this component checks for
 * itself and falls back to plain text — no `tel:`, no phone icon suggesting a
 * call will do anything — so a manager reading a profile sees that the number
 * on file is wrong instead of a working-looking link that silently is not.
 *
 * Relative imports throughout, not the `@/` alias: this file is exercised by
 * `tests/components/phone-link.test.tsx`, and Vitest has no alias configured
 * (`vitest.config.ts`) — the same reason `ui/button.tsx` and `ui/segmented.tsx`
 * already import `cn` this way.
 */
export function PhoneLink({
  phone,
  className,
  size = "md",
}: {
  phone: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClass = cn(
    size === "lg" && "text-lg",
    size === "md" && "text-[17px]",
    size === "sm" && "text-[15px]",
  );

  if (!isValidPhone(phone)) {
    return (
      <span
        className={cn(
          "-mx-1 inline-flex min-h-11 items-center gap-2 rounded-control px-1 font-semibold text-meta",
          sizeClass,
          className,
        )}
      >
        <Phone aria-hidden className="size-[18px]" strokeWidth={1.75} />
        {phone}
      </span>
    );
  }

  return (
    <a
      // QA remediation T27: a dot- or dash-formatted number (accepted since
      // Task 18 widened `isValidPhone` to strip `[\s.-]` before counting
      // digits — see that function's own docstring) used to reach `tel:`
      // with the separators still in it, e.g. `tel:091.234.5678`. Most phone
      // apps dial that anyway, but it is not the normalised form
      // `isValidPhone` already treats as authoritative, and this mirrors its
      // exact separator set rather than inventing a second one.
      href={`tel:${phone.replace(/[\s.-]/g, "")}`}
      className={cn(
        "-mx-1 inline-flex min-h-11 items-center gap-2 rounded-control px-1 font-semibold text-sage hover:underline",
        sizeClass,
        className,
      )}
    >
      <Phone aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {phone}
    </a>
  );
}
