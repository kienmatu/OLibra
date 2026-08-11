import { cloneElement, isValidElement } from "react";
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
  invalidHint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /**
   * QA remediation T27. The inline Vietnamese line a required/patterned
   * control shows in place of the browser's own validation bubble —
   * "Please fill out this field", "Please select an item in the list" for an
   * empty required `<select>` — which `lang="vi"` on the document does
   * nothing to, because that text comes from the browser's own UI language,
   * not the page's. Each of the three forms this closed pairs it with
   * `noValidate` on the `<form>`: that stops the browser from blocking
   * submission and popping up its bubble, `required`/`pattern` stay on the
   * control exactly as before so the constraint (and its accessibility
   * exposure — invalid state is native, not invented here) is unchanged, and
   * this paragraph is shown by `group-has-[:user-invalid]` — no JavaScript,
   * the same CSS-only conditional-visibility idiom `condition-picker.tsx` and
   * `donor-fields.tsx` already use for an unrelated reason (there, a radio's
   * `:checked`).
   *
   * **`:user-invalid`, not `:invalid`.** The latter would mark every empty
   * required field red from first paint, before anyone has touched the form —
   * `:user-invalid` only matches once the visitor has interacted with the
   * control *or* tried to submit the form, confirmed empirically before this
   * shipped: a first submit attempt on a field nobody has ever focused still
   * lights it up, because `novalidate` only cancels the browser's own
   * block-and-bubble, not the "an attempt happened" flag `:user-invalid`
   * reads.
   *
   * A real behaviour change, not only a cosmetic one, and worth stating
   * plainly rather than leaving implicit: `novalidate` means a required field
   * left empty now reaches the server — dropping `required` outright would
   * have meant the same thing with less warning. The server was already the
   * authority (`required_fields_missing`, `errors.ts`); this trades "the
   * browser refuses to send it" for "the browser tells you before you send
   * it, in your own language, and the server backstops what CSS cannot
   * enforce" — matching this codebase's stated rule everywhere else that the
   * domain owns validation and a form merely repeats it
   * (`domain/admin/policy.ts`).
   */
  invalidHint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  // M9: this error paragraph used to be purely decorative — no `role="alert"`,
  // no link back to the control it describes. That was tolerable while these
  // pages were static; it stopped being tolerable the moment a page reload
  // (dang-nhap/actions.ts's redirect) could put a real validation failure
  // here with nothing announcing it to a screen-reader user. `errorId` ties
  // the message to the control via `aria-describedby`, and the control also
  // gets `aria-invalid` — both injected onto `children` here rather than
  // pushed onto every call site, so a caller cannot forget the wiring the
  // way `dang-nhap/page.tsx` had (it separately, and still correctly, sets
  // `invalid` on `Input` for the red border, which is a visual concern this
  // does not replace).
  const errorId = error && htmlFor ? `${htmlFor}-loi` : undefined;
  // Same idea, for `invalidHint`: a screen-reader user tabbing into the
  // control should hear the Vietnamese line too, not just see it painted in
  // by CSS once `:user-invalid` matches — `aria-describedby` names it
  // regardless of the paragraph's current visibility, exactly as browsers
  // already tolerate for any other `aria-describedby` target.
  const invalidId = invalidHint && htmlFor ? `${htmlFor}-khong-hop-le` : undefined;
  const describedBy = [errorId, invalidId].filter(Boolean).join(" ") || undefined;
  const control =
    (error || invalidHint) && isValidElement(children)
      ? cloneElement(
          children as React.ReactElement<{
            "aria-invalid"?: boolean;
            "aria-describedby"?: string;
          }>,
          {
            // Only a server-confirmed refusal earns a static `aria-invalid`.
            // `invalidHint` alone describes a control that *might* fail
            // constraint validation, not one that has — the native
            // `required`/`pattern` attributes already carry the real state to
            // assistive tech the moment a browser's own validity check runs.
            "aria-invalid": error ? true : undefined,
            "aria-describedby": describedBy,
          },
        )
      : children;

  return (
    // `group` scopes `group-has-[:user-invalid]` below to this one field —
    // see `invalidHint`'s own docstring.
    <div className="group space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* Only emit a <label> when there is a control to associate it with.
            Some fields wrap a read-only value, and a label pointing at nothing
            is worse for a screen reader than a plain span. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[16px] font-medium">
            {label}
          </label>
        ) : (
          <span className="text-[16px] font-medium">{label}</span>
        )}
        {required ? (
          <span className="rounded-control bg-paper px-1.5 py-0.5 text-[12px] font-medium text-leather">
            Bắt buộc
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-[14px] text-meta">{hint}</p> : null}
      {control}
      {invalidHint ? (
        <p
          id={invalidId}
          role="alert"
          className="hidden items-center gap-1.5 text-[14px] text-brick group-has-[:user-invalid]:flex"
        >
          <AlertCircle aria-hidden className="size-[18px]" strokeWidth={1.75} />
          {invalidHint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 text-[14px] text-brick"
        >
          <AlertCircle aria-hidden className="size-[18px]" strokeWidth={1.75} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "h-12 w-full rounded-control border border-hairline bg-surface px-3.5 text-[16px] " +
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
        "w-full rounded-control border border-hairline bg-surface px-3.5 py-3 text-[16px]",
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
      <div className="flex h-12 items-center rounded-control border border-hairline bg-paper px-3.5 text-[16px] text-ink/80">
        {children}
      </div>
      {note ? <p className="text-[14px] text-meta">{note}</p> : null}
    </div>
  );
}

/**
 * A settings toggle, drawn in sage rather than a bright accent — terracotta is
 * reserved for the one primary action on a screen.
 *
 * Purely presentational: these pages are static, so it renders a state rather
 * than owning one. Two pages had grown their own copy before this existed.
 */
export function Toggle({
  on,
  label,
  disabled,
}: {
  on: boolean;
  /** Describes what the toggle controls, for screen readers. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
        on ? "bg-sage" : "bg-leather/35",
        disabled && "opacity-45",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-5 rounded-full bg-surface transition-transform",
          on && "translate-x-5",
        )}
      />
    </span>
  );
}
