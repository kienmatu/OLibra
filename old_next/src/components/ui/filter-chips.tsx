import { Chip } from "./segmented";

/** SDD §6.6. Even a count of three goes through the locale. */
const NUMBER = new Intl.NumberFormat("vi-VN");

export interface FilterChipDescriptor {
  label: string;
  href: string;
  active: boolean;
  /**
   * Rendered as "Label (count)" when given. Omit it entirely rather than
   * pass `0` for "no count to show" — `nguoi-doc/page.tsx`'s own chips carry
   * none at all (see its docstring: showing the other four statuses' totals
   * would cost four more counting queries on every render, and an invented
   * number beside a real one is indistinguishable from data), so `count` has
   * to be able to mean "absent", which `0 | undefined` cannot.
   */
  count?: number;
}

/**
 * The reader list's filter chip (Task 14, 2026-08-10 QA remediation),
 * factored out so `/quan-ly/thong-bao` and `/quan-ly/binh-luan` can have the
 * real thing instead of the look of it. Both rendered
 * `<span className="rounded-control bg-surface px-3 py-1.5">Tất cả (0)</span>`
 * — a count with nowhere to click, visually close enough to `nguoi-doc`'s own
 * chips that a volunteer had no way to tell, from looking, that one row
 * responded to a tap and the other never would.
 *
 * **Built on `Chip`, not a second copy of it.** `src/components/ui/segmented.tsx`
 * already draws this exact pill — border, background and text colour keyed off
 * one `active` boolean — for nine other call sites; `FilterChips` only adds the
 * shape those nine did not need: an array of `{ label, href, active, count? }`
 * instead of one child element at a time. This means the `aria-current="page"`
 * this task adds to `Chip` (fixing P3-4, which the QA sweep found on
 * `nguoi-doc/page.tsx`'s own chips even though their active styling was
 * already correct) reaches every caller of `Chip`, `nguoi-doc` included, in
 * the one place it is drawn rather than in each of the three screens this task
 * touches plus the six it does not.
 *
 * **No wrapping `<div>`.** A caller's own flex-wrap row is where a group label
 * ("Trạng thái" on `nguoi-doc`) sits beside the chips as a sibling, all
 * wrapping together as one unit; a second flex container in here would wrap
 * the label onto its own line independently of the chips it labels the day the
 * row got tight. `nguoi-doc/page.tsx` is the caller that needs the label;
 * `thong-bao` and `binh-luan` render `<FilterChips>` alone in their own row and
 * pay nothing for the flexibility they do not use.
 *
 * **Renders links, always** — never a disabled-looking span for a chip with
 * nothing to filter to. That case does not arise for any of this task's three
 * screens: every chip here names a real, reachable state (`nguoi-doc`'s "Tất
 * cả" already worked this way, and `?trang-thai=` for an unrecognised value on
 * every caller resolves before it reaches this component — see each page's own
 * `…FromParam` for the fallback, the same shape `src/lib/membership-status.ts`
 * established first).
 */
export function FilterChips({ chips }: { chips: FilterChipDescriptor[] }) {
  return (
    <>
      {chips.map((chip) => (
        <Chip key={chip.href} href={chip.href} active={chip.active}>
          {chip.count === undefined
            ? chip.label
            : `${chip.label} (${NUMBER.format(chip.count)})`}
        </Chip>
      ))}
    </>
  );
}
