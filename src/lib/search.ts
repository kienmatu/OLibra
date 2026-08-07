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
    // Punctuation becomes a space, then runs of space collapse. Without this,
    // "totto chan" failed to match "Totto-chan" — the hyphen survived folding
    // and broke the substring. Titles carry hyphens, colons and full stops
    // that nobody types into a search box.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matches(haystack: string, needle: string) {
  return fold(haystack).includes(fold(needle));
}
