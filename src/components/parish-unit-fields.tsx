"use client";

import { useState } from "react";
import { Field, Select } from "@/components/ui/field";
import {
  hasVisibleLevel2,
  unitOptions,
  type ParishTaxonomy,
  type ParishUnit,
} from "@/domain/members/parish-taxonomy";

/**
 * Zero, one or two `<select>`s for a shelf's parish taxonomy (design §6, §6.1).
 *
 * Holds no rules of its own — every filtering decision goes through
 * `unitOptions`, the same function the server trusts. This component only
 * decides how many fields to draw and how to lay them out; a submission that
 * disagrees with `unitOptions` is caught server-side by `validateSelection`,
 * not here.
 *
 * Both fields are permanently optional (design §5): a wrong tổ is worse than
 * a blank one because it looks like knowledge, so neither select is ever
 * marked required, and both carry a "— Không chọn —" option.
 *
 * "zero, one or two": a level whose unit list is empty renders no field at
 * all — an empty dropdown answers nothing a volunteer can act on, and a
 * brand-new shelf with no units yet must still let a form submit.
 *
 * ## Why this is a client component
 *
 * Every other form in this codebase is a plain server-rendered `<select>`.
 * This one is not, because nested filtering ("picking a giáo họ narrows the
 * tổ list to that giáo họ's own") is a live UI response to a previous
 * choice, and static HTML has no such response. That need is real but
 * narrow, so only this component pays for it.
 *
 * The base markup — what renders before any JS runs — already contains
 * every level-2 option, grouped under an `<optgroup>` per level-1 unit. A
 * volunteer on a bad connection or with JS disabled still gets a complete,
 * usable (if unfiltered) list, never an empty one — "progressive
 * degradation matters more than elegance." That baseline holds because the
 * server and the client's first render both start from the same `l1` state
 * (`defaultL1`), so nothing has to run for it to be true — it is simply what
 * the initial render already produces.
 *
 * Once a person picks a level-1 unit, this component narrows the *rendered*
 * `<optgroup>` list to that parent — omitting the other groups from the
 * option array entirely, not toggling a `hidden` attribute on them. An
 * earlier version used `hidden`, which WebKit has a long history of
 * ignoring on `<option>`/`<optgroup>` inside its native picker — exactly the
 * device this form is mostly filled out on (§17.5: the manager's mobile
 * layout is the primary experience). Filtering the array a browser never
 * sees the excluded elements in the first place, so there is nothing left
 * for any browser's picker quirks to get wrong.
 */
export function ParishUnitFields({
  idPrefix,
  taxonomy,
  units,
  defaultL1 = "",
  defaultL2 = "",
}: {
  /** Distinguishes ids/names when this renders more than once on a page. */
  idPrefix: string;
  taxonomy: ParishTaxonomy;
  units: ParishUnit[];
  /** Pre-selects a unit — used when editing an existing reader's profile. */
  defaultL1?: string;
  defaultL2?: string;
}) {
  const [l1, setL1] = useState(defaultL1);
  const [l2, setL2] = useState(defaultL2);

  const l1Options = unitOptions(units, 1);
  const showL1 = l1Options.length > 0;

  const allL2Options = taxonomy.levels === 2 ? unitOptions(units, 2) : [];
  // Uses `hasVisibleLevel2` rather than `allL2Options.length > 0`: when
  // nested, a level-2 unit whose parent has been soft-deleted must not count
  // — otherwise a nested shelf can render a level-2 select whose only real
  // content is "— Không chọn —" (IMPORTANT 6).
  const showL2 = hasVisibleLevel2(taxonomy, units);

  if (!showL1 && !showL2) return null;

  const l1FieldId = `${idPrefix}-bac-1`;
  const l2FieldId = `${idPrefix}-bac-2`;

  // Grouped by parent only when nested — a flat level 2 has nothing to
  // group by, and every unit is a plain, ungrouped option (matching
  // `unitOptions(units, 2)`, which does not filter by parent at all when
  // the shelf is not nested).
  const l2Groups = taxonomy.nested
    ? l1Options
        .map((parent) => ({ parent, children: unitOptions(units, 2, parent.id) }))
        .filter((g) => g.children.length > 0)
    : null;

  // Only the groups belonging to the chosen level 1 — or every group when
  // nothing is chosen yet, matching the no-JS baseline described above.
  const visibleL2Groups = l2Groups?.filter((g) => l1 === "" || l1 === g.parent.id);

  function handleL1Change(value: string) {
    setL1(value);
    // IMPORTANT 3: a previously chosen level-2 unit that belonged to the old
    // level-1 unit does not survive a change of parent — its optgroup would
    // no longer render, but an uncontrolled select had let the stale value
    // keep posting anyway. Clearing it here, in state, is what makes the
    // select's displayed value and its submitted value agree.
    if (!taxonomy.nested) return;
    const currentL2 = units.find((u) => u.id === l2);
    if (currentL2 && currentL2.parentId !== (value || null)) {
      setL2("");
    }
  }

  return (
    <>
      {showL1 ? (
        <Field
          label={taxonomy.level1Label}
          htmlFor={l1FieldId}
          hint="Không bắt buộc. Để trống nếu chưa biết — quản lý bổ sung sau cũng được."
        >
          <Select
            id={l1FieldId}
            name="parishUnitL1Id"
            value={l1}
            onChange={(e) => handleL1Change(e.target.value)}
          >
            <option value="">— Không chọn —</option>
            {l1Options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {showL2 ? (
        <Field
          label={taxonomy.level2Label}
          htmlFor={l2FieldId}
          hint={
            taxonomy.nested
              ? `Không bắt buộc. Danh sách sẽ theo đúng ${taxonomy.level1Label.toLowerCase()} đã chọn ở trên.`
              : "Không bắt buộc. Để trống nếu chưa biết — quản lý bổ sung sau cũng được."
          }
        >
          <Select
            id={l2FieldId}
            name="parishUnitL2Id"
            value={l2}
            onChange={(e) => setL2(e.target.value)}
          >
            <option value="">— Không chọn —</option>
            {visibleL2Groups
              ? visibleL2Groups.map(({ parent, children }) => (
                  <optgroup key={parent.id} label={parent.name}>
                    {children.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.name}
                      </option>
                    ))}
                  </optgroup>
                ))
              : allL2Options.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
          </Select>
        </Field>
      ) : null}
    </>
  );
}
