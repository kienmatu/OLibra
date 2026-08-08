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
    insert into users (full_name, father_name, mother_name, phone)
    values (
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
  const [row] = await sql<{ id: string }[]>`
    insert into memberships (bookshelf_id, user_id, role, status)
    values (
      ${bookshelfId}, ${user.id},
      ${over.role ?? "reader"}, ${over.status ?? "active"}
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
