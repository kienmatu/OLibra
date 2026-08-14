"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
// Relative, not the `@/` alias: `avatar-proposal.tsx` is the first client
// component to pull this file into a test's import graph
// (`tests/components/avatar-proposal.test.tsx`), and `vitest.config.ts` has
// no `resolve.alias` for `@/` — `./button.tsx`'s own note records the
// identical reason.
import { Button } from "./button";

/**
 * A confirm button that disables itself while its form is in flight.
 *
 * BR §17.7: "Every button that triggers a change disables itself and shows a
 * spinner while in flight, which also prevents the double-submit that would
 * otherwise create duplicate loans." That sentence names these three buttons
 * and no others, and until U1 they submitted nothing at all — the rule had
 * nothing to be true of. It does now.
 *
 * **The database is not what this protects.** A second POST is already refused
 * on its own terms: `lendCopy` loses INV-1's unique index and comes back
 * `copy_not_available`, `receiveReturn` finds the loan closed and says "Lượt
 * mượn này đã được xử lý.", and `tests/lib/lending-actions.test.ts` pins both.
 * What the pending state buys is the volunteer's confidence — a tap that
 * appears to do nothing on a slow parish connection is a tap somebody makes
 * again, and then wonders whether they lent the book twice.
 *
 * **`useFormStatus`, which is why this file is a client component.** It reads
 * the status of the nearest enclosing `<form>` and must therefore be a
 * *child* of it, not the form itself — React's own constraint, and the reason
 * this is a separate component rather than a flag on `<Button>`. It is the App
 * Router's mechanism for exactly this, so the three screens keep their server
 * components and ship one small island between them instead of becoming client
 * pages.
 *
 * `disabled` composes rather than replaces: `xac-nhan` disables its button for
 * BR §16.3's blocking reasons, and a pending submit must not re-enable a button
 * that a rule already closed.
 *
 * **`icon` is an element, not a component.** A `LucideIcon` is a function, and
 * a function cannot cross the server/client boundary — `icon={Check}` from a
 * Server Component is an unconditional 500 on every render, which is how this
 * first shipped and what `bun run check:links` caught. Passing `<Check … />`
 * sends a serialised element instead, which is exactly what the boundary is
 * for.
 */
export function SubmitButton({
  variant = "primary",
  size = "lg",
  className,
  disabled,
  icon,
  children,
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  disabled?: boolean;
  /** The button's own icon element; swapped for the spinner while in flight. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending || disabled}
      // The label does not change — a button whose words move under a thumb is
      // harder to trust, not easier. `aria-busy` is what carries "still
      // working" to a screen reader, since the spinner is decorative.
      aria-busy={pending || undefined}
    >
      {pending ? (
        <LoaderCircle aria-hidden className="size-5 animate-spin" strokeWidth={2} />
      ) : (
        icon
      )}
      {children}
    </Button>
  );
}
