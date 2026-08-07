import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * That phone call is the actual mechanism by which books come back, so a
 * number is never plain text — it is always a generous, obvious tap target.
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
  return (
    <a
      href={`tel:${phone.replace(/\s/g, "")}`}
      className={cn(
        "-mx-1 inline-flex min-h-11 items-center gap-2 rounded-control px-1 font-semibold text-sage hover:underline",
        size === "lg" && "text-lg",
        size === "md" && "text-[17px]",
        size === "sm" && "text-[15px]",
        className,
      )}
    >
      <Phone aria-hidden className="size-[18px]" strokeWidth={1.75} />
      {phone}
    </a>
  );
}
