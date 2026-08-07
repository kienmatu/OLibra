import { cn } from "@/lib/utils";

/** A subtle 1px border, never a shadow. Flat paper on a table. */
export function Card({
  className,
  children,
  tone = "surface",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: "surface" | "paper" }) {
  return (
    <div
      className={cn(
        "rounded-card border border-hairline p-6",
        tone === "paper" ? "bg-paper" : "bg-surface",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  className,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <h2 className="text-[20px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-meta">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A row of quiet totals split by vertical hairlines. No cards, no colour. */
export function StatStrip({
  items,
}: {
  items: { label: string; value: string; note?: string }[];
}) {
  return (
    <dl className="flex flex-wrap divide-x divide-hairline rounded-card border border-hairline bg-surface">
      {items.map((item) => (
        <div key={item.label} className="flex-1 px-6 py-4">
          <dt className="text-[14px] text-meta">{item.label}</dt>
          <dd className="mt-0.5 text-[24px] leading-none font-semibold">
            {item.value}
          </dd>
          {item.note ? (
            <p className="mt-1.5 text-[13px] text-meta">{item.note}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
