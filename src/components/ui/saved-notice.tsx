import { CheckCircle2 } from "lucide-react";

/**
 * A sage-toned confirmation strip — "the tap took" — for a write that used to
 * complete silently.
 *
 * **QA remediation Task 16.** "Lưu cài đặt" (shelf settings), "Xác nhận cho
 * mượn" and "Xác nhận nhận trả" all redirected on success with nothing on the
 * next screen to say so — the settings form re-rendered identically, and a
 * manager had no way to tell a save had taken effect from a page that had
 * simply not changed. `/tu-sach/[shelf]/gop-y` already had the right idea —
 * "Đã gửi rồi, cảm ơn bạn nhé." beside a `CheckCircle2` — this is that same
 * shape, pulled out so the other three call sites do not each invent their
 * own markup for it. `src/lib/search-params.ts`'s `ACTION_DONE_PARAM` is the
 * query-string half of the pattern; a page decides *whether* to render this
 * (reading that param) and *what it says* (its own Vietnamese sentence,
 * passed as `children`) — this component only draws the strip.
 *
 * **Sage, not `available`.** `/gop-y`'s own version used `text-available`,
 * one of the status inks reserved for a copy's or a loan's state
 * (`available`/`onloan`/`overdue`/…, each always paired with a `StatusBadge`
 * word) — borrowed for a purpose it was not named for. Sage is this
 * application's actual "something good just happened" accent: the toggle in
 * `field.tsx` and every "back to…" link already draw it, and terracotta stays
 * reserved for the one primary action per screen, per that same file's own
 * note. A follow-up may want to fold `/gop-y`'s own banner into this
 * component too; not done here to keep this task to the three saves the brief
 * names.
 *
 * A `<p>`, not `role="alert"` or `aria-live`: this renders after a full page
 * navigation, where a screen reader already announces the new page and its
 * content in document order — the same reasoning `/gop-y`'s own version
 * applied, unlike the *inline* refusal banners next to a `<form>` that stays
 * on screen (`Field`'s own `role="alert"`, for a message appearing without a
 * navigation).
 */
export function SavedNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 flex items-start gap-2 rounded-card border border-sage/30 bg-sage/10 px-4 py-3 text-[14px] text-ink">
      <CheckCircle2
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-sage"
        strokeWidth={1.75}
      />
      {children}
    </p>
  );
}
