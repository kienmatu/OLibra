"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import { Button } from "./ui/button";

/**
 * "Chọn tất cả" / "Bỏ chọn tất cả" for the label selection form.
 *
 * **The only client component on this screen, and it stays that way.** The
 * accordion is `<details>`, the checkboxes are uncontrolled inputs inside a
 * plain `<form>` that posts — none of it needs JavaScript. This one control
 * does, because "tick four hundred boxes" is not something HTML offers. So it
 * is scoped to exactly that: it reads and writes the form's existing inputs and
 * owns no state the form does not already hold.
 *
 * **Without JavaScript it simply is not there**, and nothing else breaks: a
 * volunteer on a phone that fails to run this still has every checkbox and the
 * submit button. That is the same reason the parent-title checkbox does not tick
 * its children in the browser — the server expands a ticked title into its
 * copies, so the feature does not depend on script having run.
 *
 * **The label tells the truth after a manual tick, too.** A `change` listener on
 * the form recomputes it, so ticking one box by hand does not leave a button
 * saying "Bỏ chọn tất cả" over a mostly-empty list.
 */
export function SelectAllCopies({ formId }: { formId: string }) {
  const [allSelected, setAllSelected] = useState(false);

  const boxesOf = (form: HTMLFormElement) =>
    Array.from(
      form.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="sach"], input[type="checkbox"][name="ban"]',
      ),
    );

  const recompute = useCallback(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const boxes = boxesOf(form);
    setAllSelected(boxes.length > 0 && boxes.every((b) => b.checked));
  }, [formId]);

  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("change", recompute);
    return () => form.removeEventListener("change", recompute);
  }, [formId, recompute]);

  const toggle = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    // Read what to do from the *inputs*, not from `allSelected`. The React
    // state exists only to word the label, and it lags by a render — two clicks
    // in quick succession both saw the stale value and both checked everything,
    // found by driving this in a browser rather than by reading it. The form
    // holds the real state, which is this component's whole premise, so it is
    // also what decides the direction.
    const next = !boxesOf(form).every((b) => b.checked);
    // Titles *and* copies. A ticked title already means every one of its copies
    // to the server, so ticking both is redundant there — but a volunteer who
    // opens an accordion after "Chọn tất cả" should see its copies ticked
    // rather than an empty list under a selected title. `listCopiesForLabels`
    // unions the two and deduplicates, so the redundancy costs nothing.
    for (const box of boxesOf(form)) box.checked = next;
    setAllSelected(next);
  };

  const Icon = allSelected ? CheckSquare : Square;

  return (
    <Button type="button" variant="quiet" size="sm" onClick={toggle}>
      <Icon aria-hidden className="size-5" strokeWidth={1.75} />
      {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
    </Button>
  );
}
