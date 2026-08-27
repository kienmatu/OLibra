/**
 * Diacritic- and case-insensitive folding of Vietnamese text.
 *
 * This is a domain rule, not a utility. BR §12 requires that a child typing
 * `tim kiem kho bau` on a phone without diacritics finds *Tìm Kiếm Kho Báu*,
 * and — the part that actually bites — that **whatever normalisation is
 * applied when storing a title is the identical normalisation applied to the
 * search term, so the two can never drift**.
 *
 * There are two other things in this system that must agree with this
 * function, and each has its own way of failing:
 *
 * - `olibra_fold()` in SQL (migration `0002_folding.sql`) backs the generated
 *   `books.title_folded` column. `tests/db/folding.test.ts` asserts the two
 *   return byte-identical output for a set of real titles, and that test has
 *   already caught a real break.
 * - `slugifyTitle` in `src/domain/catalogue/policy.ts` derives `books.slug`.
 *   It is this function with hyphens instead of spaces, and it now says so in
 *   code rather than by reimplementing the steps.
 *
 * A third hand-written copy, or a slugify library brought in for the same
 * job, would be a fourth party to an agreement that only holds because it is
 * tested. That is why this is not `npm install slugify`: the library question
 * is not whether it handles `đ` today, but who notices when it stops.
 */

/**
 * `đ` needs its own rule and must not be removed.
 *
 * It is a distinct Vietnamese letter, not a `d` carrying a diacritic, so
 * `normalize("NFD")` does not decompose it and the combining-mark strip below
 * leaves it untouched. This is the single most likely cause of "why does
 * searching *dat rung* not find *Đất Rừng Phương Nam*", and it is the same
 * trap `unaccent()` falls into on the SQL side (DATABASE.md §5).
 */
export function fold(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // combining marks
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      // Punctuation becomes a space, then runs of space collapse. Without
      // this, "totto chan" failed to match "Totto-chan" — the hyphen survived
      // folding and broke the substring. Titles carry hyphens, colons and full
      // stops that nobody types into a search box.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/** True when `needle`, folded, appears anywhere in `haystack`, folded. */
export function matches(haystack: string, needle: string): boolean {
  return fold(haystack).includes(fold(needle));
}
