import { afterAll, beforeAll, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, sql } from "../support/db";

beforeAll(async () => {
  await migrate(sql);
});
afterAll(closeAll);

/**
 * The two columns QR labels add to `book_copies`.
 *
 * Asserted against `information_schema` rather than by inserting a row: what
 * matters here is the *shape* the migration declares — nullability and the
 * default — and a row insert proves only that today's default happens to be
 * what today's insert saw.
 */
test("qr_printed_at is a nullable timestamptz", async () => {
  const [column] = await sql<{ data_type: string; is_nullable: string }[]>`
    select data_type, is_nullable
    from information_schema.columns
    where table_name = 'book_copies' and column_name = 'qr_printed_at'
  `;

  expect(column).toBeDefined();
  expect(column.data_type).toBe("timestamp with time zone");
  expect(column.is_nullable).toBe("YES");
});

test("qr_print_count is a non-null integer defaulting to zero", async () => {
  const [column] = await sql<
    { data_type: string; is_nullable: string; column_default: string | null }[]
  >`
    select data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'book_copies' and column_name = 'qr_print_count'
  `;

  expect(column).toBeDefined();
  expect(column.data_type).toBe("integer");
  expect(column.is_nullable).toBe("NO");
  expect(column.column_default).toContain("0");
});
