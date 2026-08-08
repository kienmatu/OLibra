import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrate } from "../../src/db/migrate";
import { closeAll, resetDatabase, sql } from "../support/db";

beforeAll(() => migrate(sql));
beforeEach(resetDatabase);
afterAll(closeAll);

const insert = (username: string | null, hash: string | null) => sql`
  insert into users (full_name, father_name, mother_name, phone, username, password_hash)
  values ('Giuse Trần Minh', 'Giuse Trần Văn A', 'Maria Nguyễn Thị B',
          '0900000000', ${username}, ${hash})
`;

test("INV-14: neither credential is a valid state", async () => {
  // BR §2: most readers are children who will never sign in. Forcing a
  // volunteer to invent credentials nobody will type is work that serves the
  // database, not the parish.
  await expect(insert(null, null)).resolves.toBeDefined();
});

test("INV-14: both credentials is valid", async () => {
  await expect(insert("tranminh", "$2b$dummy")).resolves.toBeDefined();
});

test("INV-14: a username without a password is rejected", async () => {
  await expect(insert("tranminh", null)).rejects.toMatchObject({ code: "23514" });
});

test("INV-14: a password without a username is rejected", async () => {
  await expect(insert(null, "$2b$dummy")).rejects.toMatchObject({ code: "23514" });
});
