import type { Sql } from "postgres";

/**
 * Minimal row builders. Each takes only what a test must vary and defaults
 * everything else, so a test reads as the rule it is checking rather than as
 * a wall of setup.
 */

let counter = 0;
const next = () => ++counter;

export async function makeShelf(sql: Sql, over: { slug?: string } = {}) {
  const slug = over.slug ?? `shelf-${next()}`;
  const [row] = await sql<{ id: string }[]>`
    insert into bookshelves (slug, name, address, status)
    values (${slug}, ${`Tủ sách ${slug}`}, 'Đồng Tháp', 'active')
    returning id
  `;
  return { id: row.id, slug };
}

export async function makeUser(sql: Sql, over: { fullName?: string } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into users (saint_name, full_name, father_name, mother_name, phone)
    values (
      'Maria',
      ${over.fullName ?? `Người đọc ${next()}`},
      'Giuse Trần Văn A', 'Maria Nguyễn Thị B', '0900000000'
    )
    returning id
  `;
  return { id: row.id };
}

export async function makeMember(
  sql: Sql,
  bookshelfId: string,
  over: { role?: string; status?: string } = {},
) {
  const user = await makeUser(sql);
  const status = over.status ?? "active";
  // memberships_rejected_has_reason (verified live) requires a reason
  // whenever status = 'rejected'. A fixture that only varies status must
  // still satisfy it, so a rejected row gets a placeholder reason nobody
  // asserts on rather than tripping a 23514 unrelated to what the test means
  // to check.
  const rejectionReason =
    status === "rejected" ? "lý do khởi tạo cho kiểm thử" : null;
  const [row] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status, rejection_reason)
    values (
      ${bookshelfId}, ${user.id},
      ${over.role ?? "reader"}, ${status}, ${rejectionReason}
    )
    returning id
  `;
  return { id: row.id, userId: user.id };
}

export async function makeBookWithCopies(
  sql: Sql,
  bookshelfId: string,
  copies = 1,
) {
  const n = next();
  const [book] = await sql<{ id: string }[]>`
    insert into books (bookshelf_id, title, author, slug, is_published)
    values (${bookshelfId}, ${`Sách ${n}`}, 'Tô Hoài', ${`sach-${n}`}, true)
    returning id
  `;
  const copyIds: string[] = [];
  for (let i = 0; i < copies; i++) {
    const [copy] = await sql<{ id: string }[]>`
      insert into book_copies (bookshelf_id, book_id, code, state, condition)
      values (
        ${bookshelfId}, ${book.id},
        ${`DT-${String(n * 100 + i).padStart(4, "0")}`},
        'available', 'perfect'
      )
      returning id
    `;
    copyIds.push(copy.id);
  }
  return { bookId: book.id, copyIds };
}

/**
 * A user with the full personal record BR §5.3 requires, so a test about
 * identity reuse can vary exactly the fields the match rule reads.
 * `makeUser` above stays as it is: B1's tests call it and only need a name.
 */
export async function makePerson(
  sql: Sql,
  over: {
    fullName?: string;
    saintName?: string;
    dateOfBirth?: string;
    phone?: string;
    username?: string | null;
    passwordHash?: string | null;
  } = {},
) {
  const n = next();
  const [row] = await sql<{ id: string }[]>`
    insert into users (
      saint_name, full_name, father_name, mother_name, date_of_birth, phone,
      username, password_hash
    )
    values (
      ${over.saintName ?? "Maria"},
      ${over.fullName ?? `Giuse Trần Minh ${n}`},
      'Giuse Trần Văn A', 'Maria Nguyễn Thị B',
      ${over.dateOfBirth ?? "2015-04-02"}::date,
      ${over.phone ?? `09000000${String(n).padStart(2, "0")}`},
      ${over.username ?? null}, ${over.passwordHash ?? null}
    )
    returning id
  `;
  return { id: row.id };
}

/**
 * A shelf's parish taxonomy and units, written the way `src/db/seed.ts`
 * writes them — `settings.parish_taxonomy` with **snake_case** keys
 * (`level1_label`), which is what the database actually holds and what
 * `loadParishContext` translates from.
 */
export async function makeParishUnits(
  sql: Sql,
  bookshelfId: string,
  taxonomy: {
    levels: 1 | 2;
    nested: boolean;
    level1Label: string;
    level2Label: string;
  },
  units: { level: 1 | 2; name: string; parentName?: string; sortOrder?: number }[],
) {
  await sql`
    update bookshelves
    set settings = settings || ${sql.json({
      parish_taxonomy: {
        levels: taxonomy.levels,
        nested: taxonomy.nested,
        level1_label: taxonomy.level1Label,
        level2_label: taxonomy.level2Label,
      },
    })}
    where id = ${bookshelfId}
  `;
  const byName = new Map<string, string>();
  // Level 1 first, so a level-2 unit's parent is always already inserted.
  for (const u of [...units].sort((a, b) => a.level - b.level)) {
    const [row] = await sql<{ id: string }[]>`
      insert into parish_units (bookshelf_id, level, parent_id, name, sort_order)
      values (
        ${bookshelfId}, ${u.level},
        ${u.parentName ? (byName.get(u.parentName) ?? null) : null},
        ${u.name}, ${u.sortOrder ?? 0}
      )
      returning id
    `;
    byName.set(u.name, row.id);
  }
  return byName;
}
