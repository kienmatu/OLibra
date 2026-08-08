import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { fold } from "../../src/lib/search";
import { closeAll, sql } from "../support/db";

beforeAll(async () => {
  await migrate(sql);
});
afterAll(closeAll);

// DB §5 names these four exactly: a plain title, one starting with đ, one
// with a hyphen, one with a digit.
const CASES = [
  "Dế Mèn Phiêu Lưu Ký",
  "Đất Rừng Phương Nam",
  "Totto-chan Bên Cửa Sổ",
  "Kính Vạn Hoa tập 4",
  // None of the twelve titles in src/lib/fixtures.ts contain a lowercase đ:
  // every đ in that file starts a title-cased word, so it is always Đ.
  // Without a case like this one, the parity test above never exercises the
  // .replace(/đ/g, "d") branch of fold() — only the capital-Đ branch — so a
  // regression isolated to lowercase đ would pass unnoticed. Sentence case
  // here (only the first word capitalised) is how the real title is
  // published (Nguyễn Nhật Ánh, NXB Trẻ), and it puts "đến" mid-string,
  // lowercase, exactly where that gap was.
  "Cô gái đến từ hôm qua",
];

test.each(CASES)("SQL and TypeScript fold %s identically", async (input) => {
  // BR §12: "whatever normalisation is applied when storing a title must be
  // the identical normalisation applied to the search term, so the two can
  // never drift." This test is the mechanism that stops the drift — the two
  // implementations are kept in sync by a test, not by hope.
  const [row] = await sql<{ folded: string }[]>`
    select olibra_fold(${input}) as folded
  `;
  expect(row.folded).toBe(fold(input));
});

test("đ folds to d", async () => {
  // The single most likely cause of "why does searching dat rung not find
  // Đất Rừng Phương Nam". unaccent does not reliably handle đ, because it is
  // a distinct Vietnamese letter rather than a d with a diacritic.
  const [row] = await sql<{ folded: string }[]>`
    select olibra_fold('Đất Rừng') as folded
  `;
  expect(row.folded).toBe("dat rung");
});

test("olibra_fold is immutable enough for a generated column", async () => {
  // A STABLE function cannot be used in a generated column or a functional
  // index. If this fails, the schema will not build.
  const [row] = await sql<{ provolatile: string }[]>`
    select provolatile from pg_proc where proname = 'olibra_fold'
  `;
  expect(row.provolatile).toBe("i");
});
