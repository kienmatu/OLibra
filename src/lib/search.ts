/**
 * Diacritic- and case-insensitive matching (§12).
 *
 * A child typing "de men" on a phone without diacritics must find "Dế Mèn".
 * The same normalisation must be applied to the stored value and to the search
 * term, so both go through this one function and never drift apart.
 */
export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export function matches(haystack: string, needle: string) {
  return fold(haystack).includes(fold(needle));
}
