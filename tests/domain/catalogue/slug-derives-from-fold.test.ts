import { expect, test } from "vitest";
import { fold } from "../../../src/domain/kernel/fold";
import { slugifyTitle } from "../../../src/domain/catalogue/policy";
import { books } from "../../../src/lib/fixtures";

/**
 * `slugifyTitle` and `fold` must stay one rule, not two that happen to agree.
 *
 * BR §12's requirement is that the normalisation applied when storing a title
 * is the *identical* normalisation applied to the search term. `books.slug`
 * and `books.title_folded` are both derived from a title, so a divergence
 * between them is a book that can be found but not linked to, or linked to but
 * not found — and it would appear only for titles containing whatever
 * character the two implementations came to disagree about.
 *
 * `tests/db/folding.test.ts` holds `fold` and SQL `olibra_fold()` together.
 * This holds `fold` and `slugifyTitle` together. Between them, one rule.
 */
test("every fixture title's slug is its folded title with hyphens", () => {
  for (const book of books) {
    expect(slugifyTitle(book.title)).toBe(fold(book.title).replace(/ /g, "-"));
  }
});

test("the derivation holds for the titles DATABASE.md §5 singles out", () => {
  // The same four the SQL parity test uses: a plain title, one starting with
  // đ, one carrying a hyphen, one carrying a digit. Kept in step deliberately
  // — if that test's cases change, these should too.
  for (const title of [
    "Dế Mèn Phiêu Lưu Ký",
    "Đất Rừng Phương Nam",
    "Totto-chan Bên Cửa Sổ",
    "Kính Vạn Hoa tập 4",
  ]) {
    expect(slugifyTitle(title)).toBe(fold(title).replace(/ /g, "-"));
  }
});

test("đ folds to d in a slug, not just in search", () => {
  // The letter that neither NFD nor a naive slugify library handles: đ is a
  // distinct letter, not a d with a diacritic.
  expect(slugifyTitle("Đất Rừng Phương Nam")).toBe("dat-rung-phuong-nam");
  expect(slugifyTitle("Cô gái đến từ hôm qua")).toBe("co-gai-den-tu-hom-qua");
});

test("a title that folds to nothing still yields a routable slug", () => {
  // An empty slug is not a URL segment — `/sach/` does not route. Punctuation-
  // only titles are implausible but cheap to survive, and `pickSlug` takes it
  // from here if two of them ever land on one shelf.
  expect(slugifyTitle("...")).toBe("sach");
  expect(slugifyTitle("   ")).toBe("sach");
  expect(slugifyTitle("")).toBe("sach");
});
