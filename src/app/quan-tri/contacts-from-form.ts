import type { ShelfContact } from "../../domain/shelf/queries/get-shelf-settings";

/**
 * Extracted from `./admin-actions.ts` (2026-08-12, PO feedback round 1 Task
 * 13's final check) because a `"use server"` file may only export async
 * functions — every top-level export in such a file is treated as a Server
 * Action, and Next.js refuses to compile one that is not `async`.
 * `contactsFromForm` is a pure form-parsing helper, not an action, so it
 * cannot live in `admin-actions.ts` as an export; this file carries no `"use
 * server"` directive and is imported by `admin-actions.ts` rather than
 * re-exported from it, which is what actually satisfies the constraint.
 * `tests/lib/admin-actions.test.ts` imports it from here directly, same as
 * before, just from its new home.
 */

function optional(form: FormData, name: string): string | null {
  const value = String(form.get(name) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * The three contact blocks both shelf forms post, as the domain's list.
 *
 * A block with no name is not a contact — an empty block is how a super admin
 * says "there is no third volunteer", and a phone with nobody attached to it
 * is a number nobody can be asked for. The domain refuses a whitespace-only
 * name (`contact_name_required`) for the case where a name *was* typed and is
 * blank; this filter is for the ordinary empty block, which is not an error.
 *
 * Positions are kept, not compacted: a contact left in block 3 stays at
 * position 3, because moving them would change what the reader's accordion
 * shows without anybody asking for it.
 */
export function contactsFromForm(form: FormData): ShelfContact[] {
  return [1, 2, 3].flatMap((position) => {
    const name = (optional(form, `lien-he-${position}-ten`) ?? "").trim();
    if (name === "") return [];
    return [
      {
        position,
        name,
        phone: optional(form, `lien-he-${position}-sdt`),
        roleLabel: optional(form, `lien-he-${position}-vai-tro`),
      },
    ];
  });
}
