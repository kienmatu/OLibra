import Link from "next/link";
import { CheckCircle2, Info } from "lucide-react";
import { Field, Input, ReadOnlyValue, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PhoneConfirmDialog } from "@/components/phone-confirm-dialog";
import { ShelfHeader } from "@/components/shell/public-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { ParishUnitFields } from "@/components/parish-unit-fields";
import { messageFor } from "@/domain/kernel/errors";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { findPublicShelf } from "@/domain/portal/queries/find-public-shelf";
import { loadPage, loadPublicPage, siteContact } from "@/lib/page-data";
import { loadParishContext } from "@/domain/members/parish-context";
import { SHELF_PARAM } from "@/lib/return-path";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { registerMembershipAction } from "./actions";

/**
 * BR §1.2's registration form — "someone who has no account yet must be able to
 * find their parish's shelf in order to register for it."
 *
 * **The shelf comes from `?tu-sach=`, and until U5 it came from
 * `src/lib/fixtures.ts`.** Every visitor, from every parish, saw a form headed
 * *Tủ sách Đồng Tháp* offering Đồng Tháp's parish units — the exact defect
 * `a-wired-page-renders-no-fixtures.test.ts` exists for, on the one page a
 * stranger reaches first. It was exempted there by name, with the reason
 * recorded ("what makes removing the link the worse option is that it is the
 * *only* way to register"), and this is the slice that entry named.
 *
 * **No shelf named means no form.** A visitor who arrives at a bare `/dang-ky`
 * is sent to choose a parish rather than shown a form that cannot be submitted
 * — the portal is one tap away and is where they came from.
 *
 * **Two seams on one page, and the split is what each is entitled to.** The
 * shelf's name comes through `loadPublicPage`, which reads five columns of
 * `bookshelves` as `olibra_public` and can reach nothing else. The parish units
 * come through `loadPage`, because `parish_units` carries an ordinary tenant
 * policy and is not public — a person filling in this form is a guest of that
 * shelf, which is precisely the reading `contextFor` gives them.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Đăng ký — OLibra" };

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-hairline pb-3 text-xl font-semibold">
      {children}
    </h2>
  );
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const search = await searchParams;
  // `SHELF_PARAM`, not the literal `"tu-sach"` this read for its whole life.
  // The constant exists precisely so a portal link and the page it targets
  // cannot drift apart over one string (its own docstring,
  // `src/lib/return-path.ts`), and U6 §4 makes the portal link at *this* page
  // for the first time — a signed-in visitor looking at a shelf they do not
  // belong to. Two spellings of one key is how that link silently stops
  // carrying a shelf.
  const slug = param(search, SHELF_PARAM) ?? null;
  const refusal = refusalFrom(search);
  const sent = param(search, "da-gui") === "1";

  const shelf = slug
    ? await loadPublicPage((tx) => findPublicShelf(tx, { slug }))
    : null;
  // U6 §6. Read before the branch below, because both returns render the
  // footer and a visitor who landed here with no shelf named is exactly the
  // person most likely to want the contact block in it.
  const contact = await siteContact();

  if (!shelf) {
    return (
      <>
        <ShelfHeader
          shelfName="OLibra"
          shelfSlug=""
          viewerName={null}
          canManage={false}
          isSuperAdmin={false}
        />
        <main className="mx-auto max-w-xl px-6 py-16">
          <h1 className="text-[28px] leading-tight font-semibold">
            Đăng ký làm bạn đọc
          </h1>
          <p className="mt-1.5 text-meta">
            Trước hết, bạn chọn tủ sách của giáo xứ mình nhé.
          </p>
          <Link
            href="/tu-sach"
            className="mt-6 inline-flex min-h-11 items-center text-[16px] font-medium text-sage hover:underline"
          >
            Xem danh sách tủ sách
          </Link>
        </main>

        <SiteFooter contact={contact} />
      </>
    );
  }

  const { taxonomy, units } = await loadPage(shelf.slug, (tx, ctx) =>
    loadParishContext(tx, ctx),
  );

  return (
    <>
      {/* The person filling this in has no membership yet, so there is no
          viewer to name. */}
      <ShelfHeader
        shelfName={shelf.name}
        shelfSlug={shelf.slug}
        viewerName={null}
        canManage={false}
        isSuperAdmin={false}
      />

      <main className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-[28px] leading-tight font-semibold">
          Đăng ký làm bạn đọc
        </h1>
        <p className="mt-1.5 text-meta">
          Điền giúp mình vài thông tin. Quản lý tủ sách sẽ gặp và duyệt tài khoản
          sau lễ Chúa nhật.
        </p>

        {sent ? (
          <p className="mt-6 flex items-start gap-2 rounded-card border border-hairline bg-surface px-4 py-3 text-[15px]">
            <CheckCircle2
              className="mt-0.5 size-5 shrink-0 text-available"
              aria-hidden
            />
            Đã gửi đăng ký. Quản lý sẽ gặp bạn ở nhà xứ để xác nhận.
          </p>
        ) : null}

        {refusal ? (
          <p className="mt-6 rounded-card border border-hairline bg-surface px-4 py-3 text-[15px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <form
          id="dang-ky-form"
          action={registerMembershipAction}
          // QA remediation T27: the browser's own required/pattern validation
          // messages ("Please fill out this field") come out in whatever
          // language the browser's UI runs in, not this document's `lang="vi"`
          // — measured live with a browser set to English. `noValidate`
          // stops the browser from blocking submission on its own and popping
          // that bubble up; `required`/`pattern` stay on every control below
          // unchanged, so `Field`'s `invalidHint` (shown via `:user-invalid`)
          // still only lights up a control that genuinely fails its own
          // constraint, and a submission the browser would have refused now
          // reaches `registerMembership`, which already refuses it in
          // Vietnamese (`required_fields_missing`) — see `Field`'s own
          // docstring for the fuller argument.
          noValidate
          className="mt-10 space-y-10"
        >
          <input type="hidden" name="tu-sach" value={shelf.slug} />

          <section className="space-y-3">
            <Field label="Đăng ký cho tủ sách">
              <ReadOnlyValue>{shelf.name}</ReadOnlyValue>
            </Field>
            <Link
              href="/tu-sach"
              className="inline-flex min-h-11 items-center text-[14px] text-sage hover:underline"
            >
              Chọn tủ sách khác
            </Link>
          </section>

          <section className="space-y-6">
            <GroupHeading>Đăng nhập</GroupHeading>

            <p className="text-[14px] text-meta">
              Để trống cũng được — bạn chỉ cần tên đăng nhập nếu muốn tự xem sách ở
              nhà. Quản lý có thể tạo sau.
            </p>

            <Field
              label="Tên đăng nhập"
              htmlFor="ten-dang-nhap"
              hint="Dùng để đăng nhập, nên chọn tên dễ nhớ."
            >
              <Input
                id="ten-dang-nhap"
                name="ten-dang-nhap"
                placeholder="vd: lan.nguyen"
                autoComplete="username"
              />
            </Field>

            <Field
              label="Mật khẩu"
              htmlFor="mat-khau"
              hint="Ít nhất 8 ký tự. Nếu quên, quản lý sẽ đặt lại giúp."
            >
              <Input
                id="mat-khau"
                name="mat-khau"
                type="password"
                autoComplete="new-password"
              />
            </Field>

            <Field label="Nhập lại mật khẩu" htmlFor="nhap-lai-mat-khau">
              <Input
                id="nhap-lai-mat-khau"
                name="nhap-lai-mat-khau"
                type="password"
                autoComplete="new-password"
              />
            </Field>
          </section>

          <section className="space-y-6">
            <GroupHeading>Bản thân</GroupHeading>

            {/* **No photograph here, and that is B6's gap surfacing.** The
                fixture showed a "Chạm để chọn ảnh" tile. `RegistrationInput`
                takes an `avatarUrl` and no storage key, so a photograph set at
                registration can never be deleted by any code path — the
                retention gap `registration.ts` records at length. A face is the
                most identifying fact this system can hold about a child, and
                offering to store one the parish cannot later remove is not a
                feature. `ProposeAvatarChange`, on the profile page, carries the
                key and is the way in until B6 closes this. */}

            <Field
              label="Tên thánh"
              required
              htmlFor="ten-thanh"
              hint="Theo sổ giáo xứ, để quản lý dễ nhận ra bạn."
              invalidHint="Vui lòng nhập tên thánh."
            >
              <Input
                id="ten-thanh"
                name="ten-thanh"
                required
                placeholder="vd: Maria"
              />
            </Field>

            <Field
              label="Họ và tên"
              required
              htmlFor="ho-ten"
              hint="Ghi đầy đủ như trong sổ giáo xứ."
              invalidHint="Vui lòng nhập họ và tên."
            >
              <Input
                id="ho-ten"
                name="ho-ten"
                required
                placeholder="vd: Nguyễn Thị Lan"
              />
            </Field>

            <Field
              label="Ngày sinh"
              required
              htmlFor="ngay-sinh"
              hint="Để tủ sách gợi ý sách hợp tuổi."
              invalidHint="Vui lòng chọn ngày sinh."
            >
              <Input id="ngay-sinh" name="ngay-sinh" type="date" required />
            </Field>
          </section>

          <section className="space-y-6">
            <GroupHeading>Gia đình</GroupHeading>

            <Field
              label="Tên cha"
              required
              htmlFor="ten-cha"
              hint="Giúp quản lý phân biệt các bạn đọc trùng tên."
              invalidHint="Vui lòng nhập tên cha."
            >
              <Input
                id="ten-cha"
                name="ten-cha"
                required
                placeholder="vd: Nguyễn Văn Hoà"
              />
            </Field>

            <Field
              label="Tên mẹ"
              required
              htmlFor="ten-me"
              hint="Giúp quản lý phân biệt các bạn đọc trùng tên."
              invalidHint="Vui lòng nhập tên mẹ."
            >
              <Input
                id="ten-me"
                name="ten-me"
                required
                placeholder="vd: Trần Thị Mai"
              />
            </Field>

            <Field
              label="Số điện thoại liên hệ"
              required
              htmlFor="dien-thoai"
              hint="Số của cha mẹ cũng được. Để trống thì cần cho biết lý do bên dưới."
              // The same sentence `phone_invalid` already gives a manager
              // editing this same shape of field elsewhere — reused rather
              // than newly written, per `errors.ts`'s own rule that a screen
              // borrows the domain's wording instead of inventing its own for
              // a rule it did not define. Only ever the *malformed* case now
              // (PO feedback round 1, Task 8): the `<Input>` below carries no
              // HTML `required`, so `:user-invalid` never fires on an empty
              // box, only on one holding digits `pattern` rejects.
              invalidHint={messageFor("phone_invalid")}
            >
              <Input
                id="dien-thoai"
                name="dien-thoai"
                type="tel"
                inputMode="numeric"
                pattern={PHONE_PATTERN}
                // Not HTML `required` — see this `Field`'s own `invalidHint`
                // comment. The real rule is "a phone, or a reason", and
                // `register()` is what enforces it now.
                placeholder="vd: 09xx xxx xxx"
              />
            </Field>

            {/* PO feedback round 1, Task 8. A brand-new registration has no
                record to consult, so this starts hidden — `PhoneConfirmDialog`
                fills it in on confirm — and only becomes a visible, required
                box once a `thieu-so-dien-thoai` refusal has actually happened:
                the no-JavaScript path this whole feature has to survive
                without. */}
            {refusal === "thieu-so-dien-thoai" ? (
              <Field
                label="Lý do chưa có số điện thoại"
                required
                htmlFor="ly-do-thieu-sdt"
                hint="Ví dụ: em bé chưa có điện thoại riêng, sẽ bổ sung sau."
              >
                <Textarea
                  id="ly-do-thieu-sdt"
                  name="ly-do-thieu-sdt"
                  required
                  rows={3}
                />
              </Field>
            ) : (
              <input type="hidden" name="ly-do-thieu-sdt" />
            )}
          </section>

          <section className="space-y-6">
            <GroupHeading>Giáo xứ</GroupHeading>

            <p className="text-[14px] text-meta">
              Không bắt buộc. Chưa biết cũng cứ gửi đăng ký — quản lý bổ sung giúp
              sau khi gặp bạn.
            </p>

            {/* This shelf's own labels and units, never Đồng Tháp's. */}
            <ParishUnitFields
              idPrefix="dang-ky"
              taxonomy={taxonomy}
              units={units}
            />
          </section>

          <div className="flex gap-3 rounded-card border border-hairline bg-paper p-5">
            <Info
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-leather"
              strokeWidth={1.75}
            />
            <div>
              <p className="text-[16px] font-semibold">Sau khi gửi thì sao?</p>
              <p className="mt-1.5 text-[15px] text-meta">
                Tài khoản chưa dùng được ngay. Quản lý sẽ gặp bạn ở nhà xứ để xác
                nhận, thường trong vòng một tuần.
              </p>
            </div>
          </div>

          <SubmitButton variant="primary" size="lg" className="w-full">
            Gửi đăng ký
          </SubmitButton>

          <p className="text-center text-[15px]">
            <Link
              href="/dang-nhap"
              className="font-medium text-sage hover:underline"
            >
              Đã có tài khoản? Đăng nhập
            </Link>
          </p>
        </form>
        <PhoneConfirmDialog formId="dang-ky-form" />
      </main>

      <SiteFooter contact={contact} />
    </>
  );
}
