import { Field, Input, Select, Textarea } from "./ui/field";

/**
 * A book's metadata fields, extracted from `sach/moi/page.tsx` (Task 11, QA
 * remediation) so `sach/[id]/sua` can post the identical set to `UpdateBook`
 * instead of a second, drifting copy of `CreateBook`'s form.
 *
 * **What stayed behind on `sach/moi`, and why.** Two blocks of that page are
 * about *acquiring a copy*, not about the *title*, and `updateBook` has no
 * input for either:
 *
 * - `DonorFields` (`donorMembershipId`/`donorName`/`acquiredOn`) records who
 *   handed a physical copy over and when — provenance that lives on
 *   `book_copies`, not on `books`. An edit form changes a title's own record;
 *   it does not create, and therefore cannot attribute, a copy.
 * - "Số bản sách" (`so-ban`) is `CreateBook`'s own copy-count input, gone
 *   entirely from `updateBook`'s signature. Adding copies to an already-
 *   catalogued title is the "Thêm bản" disclosure on the book detail page
 *   (`addCopies`, still unwired — out of this task's five commands, and that
 *   page's own docstring already says why wiring it here would not be
 *   reviewable).
 *
 * `defaultValues` is omitted for a fresh create (every field starts blank) and
 * supplied for an edit, pre-filled from `getBookForEdit`. Every `name=` below
 * is unchanged from `sach/moi/page.tsx`'s original markup, so
 * `createBookAction` needed no edits and `updateBookAction` reads the same
 * field names by design.
 *
 * **`published` is a sibling export, `PublishedToggle`, not a field in here.**
 * `books.is_published` is a fact about the title exactly like `title` or
 * `category_id`, and `updateBook` accepts it on the same terms — so it
 * belongs in this module — but folding it into this component would also
 * fold in its *position*, and `sach/moi/page.tsx` places it after the
 * copy-count and donor sections rather than beside the metadata fields it is
 * not visually grouped with. Two call sites choosing their own layout is
 * cheaper and safer than this component silently reordering an
 * already-shipped page the day it started rendering the checkbox itself.
 */
export function BookFields({
  categories,
  defaultValues,
}: {
  categories: { slug: string; name: string }[];
  defaultValues?: {
    title: string;
    author: string | null;
    categorySlug: string | null;
    publisher: string | null;
    publishedYear: number | null;
    pageCount: number | null;
    isbn: string | null;
    description: string | null;
  };
}) {
  return (
    <div className="space-y-6">
      <Field
        label="Tên sách"
        required
        htmlFor="ten-sach"
        invalidHint="Vui lòng nhập tên sách."
      >
        <Input
          id="ten-sach"
          name="ten-sach"
          required
          defaultValue={defaultValues?.title}
          placeholder="vd: Dế Mèn Phiêu Lưu Ký"
        />
      </Field>

      <Field
        label="Tác giả"
        required
        htmlFor="tac-gia"
        invalidHint="Vui lòng nhập tên tác giả."
      >
        <Input
          id="tac-gia"
          name="tac-gia"
          required
          defaultValue={defaultValues?.author ?? undefined}
          placeholder="vd: Tô Hoài"
        />
      </Field>

      {/* `categories.slug`, not a name and not an id — a global table with a
          plain `unique (slug)`, which is the stable handle a form can post
          (`create-book.ts`, `update-book.ts`).

          QA remediation T27: an untouched required `<select>` left on its
          disabled placeholder option is exactly the case a browser shows
          "Please select an item in the list" for, in the browser's own UI
          language rather than this page's `lang="vi"` — `invalidHint` below
          is the Vietnamese line `Field` shows instead once the surrounding
          `<form>` carries `noValidate` (`sach/moi/page.tsx`,
          `sach/[id]/sua/page.tsx`). */}
      <Field
        label="Thể loại"
        required
        htmlFor="the-loai"
        invalidHint="Vui lòng chọn thể loại."
      >
        <Select
          id="the-loai"
          name="the-loai"
          required
          defaultValue={defaultValues?.categorySlug ?? ""}
        >
          <option value="" disabled>
            Chọn thể loại
          </option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Nhà xuất bản" htmlFor="nxb">
        <Input
          id="nxb"
          name="nxb"
          defaultValue={defaultValues?.publisher ?? undefined}
          placeholder="vd: Kim Đồng"
        />
      </Field>

      <Field label="Năm xuất bản" htmlFor="nam-xb">
        <Input
          id="nam-xb"
          name="nam-xb"
          inputMode="numeric"
          defaultValue={defaultValues?.publishedYear ?? undefined}
          placeholder="vd: 2019"
        />
      </Field>

      <Field label="Số trang" htmlFor="so-trang">
        <Input
          id="so-trang"
          name="so-trang"
          inputMode="numeric"
          defaultValue={defaultValues?.pageCount ?? undefined}
          placeholder="vd: 176"
        />
      </Field>

      <Field
        label="Mã ISBN"
        htmlFor="isbn"
        hint="Không bắt buộc. Sách cũ hoặc sách tặng thường không có mã."
      >
        <Input
          id="isbn"
          name="isbn"
          defaultValue={defaultValues?.isbn ?? undefined}
          placeholder="vd: 978-604-2-12345-6"
        />
      </Field>

      <Field label="Mô tả" htmlFor="mo-ta">
        <Textarea
          id="mo-ta"
          name="mo-ta"
          rows={4}
          defaultValue={defaultValues?.description ?? undefined}
          placeholder="Vài dòng giới thiệu nội dung cuốn sách"
        />
      </Field>
    </div>
  );
}

/**
 * "Hiện sách này cho bạn đọc" — `books.is_published`, unchanged from
 * `sach/moi/page.tsx`'s original markup. A sibling export rather than part of
 * `BookFields` itself; see that component's own docstring for why.
 *
 * An unchecked box posts nothing at all, which is what `createBookAction`'s
 * `form.get("hien-thi") !== null` and `updateBookAction`'s identical read
 * both rely on.
 */
export function PublishedToggle({
  defaultChecked = true,
}: {
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-card border border-hairline bg-surface p-4">
      <input
        type="checkbox"
        name="hien-thi"
        defaultChecked={defaultChecked}
        className="mt-1 size-5 shrink-0 accent-terracotta"
      />
      <span>
        <span className="block text-[16px] font-medium">
          Hiện sách này cho bạn đọc
        </span>
        <span className="mt-0.5 block text-[14px] text-meta">
          Bỏ chọn nếu bạn muốn ẩn sách này khỏi danh mục công khai trong khi đang
          chuẩn bị.
        </span>
      </span>
    </label>
  );
}
