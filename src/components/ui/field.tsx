import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Forms are single-column, always. Labels sit above inputs, never beside.
 * Required fields are marked with the word "Bắt buộc" — never a bare asterisk.
 */
export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={htmlFor} className="text-[17px] font-medium">
          {label}
        </label>
        {required ? (
          <span className="rounded-control bg-paper px-1.5 py-0.5 text-[13px] font-medium text-leather">
            Bắt buộc
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-[15px] text-meta">{hint}</p> : null}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-[15px] text-brick">
          <AlertCircle aria-hidden className="size-[18px]" strokeWidth={1.75} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "h-12 w-full rounded-control border border-hairline bg-surface px-3.5 text-[17px] " +
  "placeholder:text-meta/70 focus:border-terracotta focus:outline-none " +
  "focus-visible:outline-2 focus-visible:outline-terracotta focus-visible:outline-offset-0";

export function Input({
  className,
  invalid,
  icon: Icon,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  const input = (
    <input
      className={cn(CONTROL, Icon && "pl-11", invalid && "border-brick", className)}
      {...props}
    />
  );

  if (!Icon) return input;

  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-meta"
        strokeWidth={1.75}
      />
      {input}
    </div>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-control border border-hairline bg-surface px-3.5 py-3 text-[17px]",
        "placeholder:text-meta/70 focus:border-terracotta focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, "pr-10", className)} {...props}>
      {children}
    </select>
  );
}

/** A read-only value shown on paper, for fields only a manager can change. */
export function ReadOnlyValue({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex h-12 items-center rounded-control border border-hairline bg-paper px-3.5 text-[17px] text-ink/80">
        {children}
      </div>
      {note ? <p className="text-[15px] text-meta">{note}</p> : null}
    </div>
  );
}
