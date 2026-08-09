import { BookOpen, Cog, Repeat, Users, type LucideIcon } from "lucide-react";
import type { AuditGroup } from "../domain/kernel/audit-actions";

/**
 * The icon and colour for each of `AUDIT_GROUPS`' four families.
 *
 * **Keyed by the group, never by the action**, and that is what keeps this file
 * from becoming a second totality obligation. `AUDIT_ACTIONS` in the domain
 * already guarantees every action has a group; four entries here then cover all
 * thirty-three, and a thirty-fourth action inherits its family's mark for free.
 * A `Record<AuditAction, LucideIcon>` would have been a map somebody has to
 * remember to extend, which is the shape §3.1 spends its length arguing
 * against.
 *
 * **Why it is here and not in the domain.** The same reason `src/lib/status.ts`
 * and `membership-status.ts` are: an icon is a React component,
 * `tests/architecture/boundaries.test.ts` keeps `react` out of `src/domain`, and
 * SDD §3.1's whole point is that the domain stays movable to a service that
 * renders nothing.
 *
 * **Colour is never the only carrier.** BR §17.1's second principle, and the
 * rule `status.ts` enforces by construction: every entry pairs an icon with the
 * ink, and the row beside it renders the group's Vietnamese name from
 * `AUDIT_GROUPS`. A volunteer who cannot tell terracotta from olive still reads
 * the sentence and sees the shape.
 *
 * The four colours are the palette's existing state tokens, reused for their
 * nearest meaning rather than chosen: `onloan` for the family that is about
 * books moving, `available` for the shelf itself, `held` for people, `retired`
 * for settings. No new token.
 */
export const AUDIT_GROUP_STYLE: Record<
  AuditGroup,
  { icon: LucideIcon; ink: string; fill: string }
> = {
  "muon-tra": { icon: Repeat, ink: "text-onloan", fill: "bg-onloan/10" },
  sach: { icon: BookOpen, ink: "text-available", fill: "bg-available/10" },
  "nguoi-doc": { icon: Users, ink: "text-held", fill: "bg-held/10" },
  "cai-dat": { icon: Cog, ink: "text-retired", fill: "bg-retired/10" },
};

/**
 * A `jsonb` payload as the `field / value` pairs the expansion shows.
 *
 * **The stored value, rendered as JSON, and nothing prettier.** BR §14 puts the
 * raw before/after behind the expansion "for when something is genuinely being
 * investigated", and the person doing that investigating needs to see what the
 * row holds — `null` as `null`, `false` as `false`, a nested object as a nested
 * object. A Vietnamese rendering here would be the re-derivation §3.2 forbids,
 * one layer down: the sentence above is the readable version and this is the
 * evidence for it.
 *
 * Keys are sorted, so the same two entries always compare in the same order and
 * a manager reading two rows is not tripped by `jsonb`'s own key order — which
 * is a fact about how Postgres stored the object, not about the event.
 */
export function payloadRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { field: string; before: string; after: string }[] {
  const keys = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ].sort();
  return keys.map((field) => ({
    field,
    before: renderValue(before, field),
    after: renderValue(after, field),
  }));
}

/**
 * One cell of the expansion.
 *
 * An **em dash** for a key the bag does not have at all, and the string `null`
 * for one it holds as null: the two are different facts. `markCopyFound`'s
 * `before` names only `state`, so every other field of that entry was never
 * recorded; `proposeAvatarChange`'s `before.avatar_url` may genuinely be
 * `null`, meaning the person had no photograph. An investigation that cannot
 * tell "not recorded" from "recorded as nothing" is reading a different log.
 *
 * `Object.hasOwn` is the whole of that decision, and it is deliberately the
 * *only* thing standing behind it. An earlier version ended
 * `JSON.stringify(bag[field]) ?? "—"`, which produced the same em dash by
 * accident — `JSON.stringify(undefined)` is `undefined` — so deleting the
 * `hasOwn` left every test green while removing the check the paragraph above
 * describes. Measured, not assumed: the guard was removed and the suite stayed
 * green. Now the fallback is gone and the check carries its own weight.
 *
 * The keys themselves come from `Object.keys` in `payloadRows`, which lists
 * only own enumerable properties, so `constructor` and its seven siblings never
 * reach here as a `field` — this is not the `in`-versus-`hasOwn` hazard
 * `src/lib/search-params.ts` records, and saying so is what stops the next
 * reader from citing the wrong reason for keeping it.
 *
 * TypeScript types `JSON.stringify` as returning `string`, which is a lie for
 * `undefined` and is exactly why the accidental fallback was invisible.
 */
function renderValue(bag: Record<string, unknown> | null, field: string): string {
  if (!bag || !Object.hasOwn(bag, field)) return "—";
  return JSON.stringify(bag[field]);
}
