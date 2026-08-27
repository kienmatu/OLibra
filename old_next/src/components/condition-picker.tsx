import {
  Archive,
  Check,
  CheckCircle2,
  Clock3,
  FileX,
  PenLine,
  Scissors,
} from "lucide-react";
import { Field, Textarea } from "./ui/field";
import { COPY_CONDITIONS, type CopyCondition } from "@/domain/catalogue/policy";
import { CONDITION_LABELS } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * The six-way condition selector, extracted from `/quan-ly/nhan-tra` (Task 11,
 * QA remediation) so the book detail page's "Đánh giá" control can post to
 * `AssessCondition` with the identical picker instead of a second, drifting
 * copy of BR §16.3's tiles.
 *
 * **Every visual behaviour is unchanged**, and it needs no client JavaScript,
 * matching the rest of this app: `has-checked:` (a first-class Tailwind v4
 * variant, scoped to each `<label>` by `:has()`) draws the selected tile —
 * filled background, heavier border, **and** a check mark, because BR
 * §17.4:648 is explicit that "selection is shown by a filled background and a
 * check, not by colour alone" — and the "Ghi chú" field appears only once a
 * worse-than-perfect grade is chosen (BR §16.3), hidden by default so the
 * common case stays untouched if the selector below ever stops matching.
 *
 * **One thing changed on the way out, and it had to.** `nhan-tra/page.tsx`'s
 * note-reveal read `group-has-[#tinh-trang-perfect:checked]:hidden` — an
 * `id`-based selector, safe there because that screen renders exactly one
 * picker. The book detail page renders one *per copy row*, and an `id` cannot
 * be reused: Tailwind's scanner generates CSS from the literal text in this
 * file, not from a runtime `idPrefix`, so a template-interpolated id would
 * generate no rule for any instance at all; and even a hand-rolled unique id
 * would leave every row's radios sharing the *same* id if the caller forgot
 * to prefix it, which `#id` selectors do not scope away — a duplicate `id` is
 * matched everywhere it appears, not just the first. The fix is a selector on
 * the **value**, `input[value=perfect]`, which is the same six literal
 * strings on every row and needs no per-instance rule at all; the surrounding
 * `.group` (rendered fresh by every instance, below) is what keeps the
 * `:has()` scoped to *this* row's own radios and nobody else's.
 */

const CONDITION_ICONS: Record<CopyCondition, typeof CheckCircle2> = {
  perfect: CheckCircle2,
  slightly_worn: Clock3,
  worn: Archive,
  torn: Scissors,
  missing_pages: FileX,
  written_on: PenLine,
};

export function ConditionPicker({
  idPrefix,
  defaultCondition = "perfect",
  noteHint,
}: {
  /** Distinguishes radio/label ids between instances — required the moment a
   *  page can render more than one (`sach/[id]/page.tsx`, one per copy row). */
  idPrefix: string;
  /** BR §16.3: "the common case is two taps", so the picker starts here unless
   *  a caller has a better prior — `sach/[id]/page.tsx` passes the copy's own
   *  current grade, since re-assessing a copy usually confirms it. */
  defaultCondition?: CopyCondition;
  /** Shown under "Ghi chú"; absent reproduces `nhan-tra`'s own unhinted field. */
  noteHint?: string;
}) {
  const noteId = `${idPrefix}-ghi-chu`;

  return (
    <div className="group">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {COPY_CONDITIONS.map((condition) => {
          const Icon = CONDITION_ICONS[condition];
          const id = `${idPrefix}-${condition}`;
          return (
            // A radio inside its own label, rather than a `<button>`: the
            // grade has to survive to the POST with no client JavaScript.
            <label
              key={condition}
              htmlFor={id}
              className={cn(
                "relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-card px-2 py-3 text-center text-[13px] font-medium",
                "border border-hairline bg-surface text-ink",
                "has-checked:border-2 has-checked:border-terracotta has-checked:bg-terracotta/10 has-checked:text-terracotta-ink",
              )}
            >
              <input
                type="radio"
                id={id}
                name="tinh-trang"
                value={condition}
                defaultChecked={condition === defaultCondition}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 hidden size-4 items-center justify-center rounded-full bg-terracotta text-white peer-checked:flex"
              >
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              <Icon aria-hidden className="size-6" strokeWidth={1.75} />
              {CONDITION_LABELS[condition]}
            </label>
          );
        })}
      </div>

      {/* Hide-on-perfect, not show-on-worse: if this selector ever stops
          matching, the field is *visible* when it need not be, rather than
          invisible when a manager needs it. See this file's own docstring for
          why the selector is value-based rather than id-based. */}
      <div className="mt-5 group-has-[input[value=perfect]:checked]:hidden">
        <Field label="Ghi chú" htmlFor={noteId} hint={noteHint}>
          <Textarea id={noteId} name="ghi-chu" rows={3} />
        </Field>
      </div>
    </div>
  );
}
