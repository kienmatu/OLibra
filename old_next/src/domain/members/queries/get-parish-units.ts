import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { loadParishContext } from "../parish-context";
import {
  hasVisibleLevel2,
  type ParishTaxonomy,
  type ParishUnit,
  unitOptions,
} from "../parish-taxonomy";
import { requireReader } from "../policy";

export interface ParishUnitsResult {
  taxonomy: ParishTaxonomy;
  /** Live units only, level 1 then level 2, each in `unitOptions`' order. */
  units: ParishUnit[];
  /** design §6: an empty level renders no field, never an empty `<select>`. */
  showLevel2: boolean;
}

/**
 * OPS §3.2's `GetParishUnits`. `reader`, not `guest` — design §8: "a stranger
 * has no business enumerating a parish's internal divisions".
 *
 * OPS §3.2 records an open question about this: the registration form is
 * `guest`-callable and renders the same picker. **This slice does not resolve
 * it by widening the caller.** `RegisterMembership` (Task 3) loads the
 * taxonomy itself, inside its own transaction, through `loadParishContext` —
 * the *command* reads it, not the caller — so the rule is enforced without a
 * guest ever being handed the unit list through this query. What the
 * registration *screen* renders is E's problem, and OPS is explicit that
 * neither source document says how; a server-rendered page already scoped to
 * its own shelf is the plausible answer and is not this slice's to invent.
 *
 * Soft-deleted units are excluded here and only here (`unitOptions`), which is
 * the split OPS §3.2 states: "a unit stops appearing in the picker once
 * deleted, but keeps describing whoever already references it".
 */
export async function getParishUnits(
  tx: Tx,
  ctx: TenantContext,
): Promise<ParishUnitsResult> {
  requireReader(ctx);
  const { taxonomy, units } = await loadParishContext(tx, ctx);
  return {
    taxonomy,
    units: [...unitOptions(units, 1), ...unitOptions(units, 2)],
    showLevel2: hasVisibleLevel2(taxonomy, units),
  };
}
