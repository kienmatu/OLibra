/**
 * Search folding, for the UI.
 *
 * The rule itself lives in the domain (`src/domain/kernel/fold`), because
 * BR §12 makes it a business requirement rather than a presentation detail —
 * and because `books.slug` and the SQL `olibra_fold()` must agree with it.
 * This module exists so screens keep importing the short path they always
 * have; it deliberately adds nothing.
 */
export { fold, matches } from "../domain/kernel/fold";
