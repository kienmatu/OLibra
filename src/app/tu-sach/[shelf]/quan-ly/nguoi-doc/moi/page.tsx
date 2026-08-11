import Link from "next/link";
import { AlertCircle, ArrowLeft, Info } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Field, Input } from "@/components/ui/field";
import { ManagerShell } from "@/components/shell/manager-shell";
import { ParishUnitFields } from "@/components/parish-unit-fields";
import { messageFor } from "@/domain/kernel/errors";
import { getParishUnits } from "@/domain/members/queries/get-parish-units";
import { PHONE_PATTERN } from "@/domain/members/policy";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import { registerReaderOnBehalfAction } from "../../actions";

/** U1 §2. See `../../cho-muon/page.tsx` for what a cached manager screen leaks. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Đăng ký người đọc mới — Quản lý tủ sách OLibra" };

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-hairline pb-3 text-xl font-semibold">
      {children}
    </h2>
  );
}

/**
 * BR §16.1's on-behalf registration: "a manager can also complete this form on
 * behalf of a child standing in front of them, which is the common case for the
 * youngest readers."
 *
 * ── Which command, because the plan named the wrong one ──────────────────────
 *
 * U3's plan §2 sends this page to `RegisterMembership`. That is the **guest's
 * own** registration and it carries no manager gate at all, so a screen behind
 * `requireManager` would have been posting to a command that has none. The
 * on-behalf pair is `registerMemberOnBehalf` (creates `pending`) and
 * `managerRegisterReader` (creates `active`), whose own docstrings say they
 * "disagree about `pending` on purpose".
 *
 * **This page posts `registerMemberOnBehalf`**, and BR §16.1 settles it in one
 * sentence: "Registering on behalf still creates a pending application rather
 * than an active member, so the approval step and its audit record are never
 * skipped" — which BR §4's assumption 3 makes the consent step for holding a
 * minor's data. The page's own shipped copy already promised exactly that, above
 * a button reading **Tạo hồ sơ chờ duyệt**, so posting the other command would
 * have made this screen lie about what it did. `managerRegisterReader` is BR
 * §16.3's quick-lend escape hatch — a different screen
 * (`quan-ly/cho-muon/nguoi-doc`), for the moment a volunteer is standing at the
 * shelf with a book in hand and a child who is not yet a member.
 *
 * ── Two sections of the fixture form are gone ────────────────────────────────
 *
 * **The photograph.** BR:167 (§5.3, beside the rule that makes parents' names
 * required) collects one at registration and gives the reason — a volunteer
 * meeting forty children on a Sunday recognises a face faster than a name —
 * and `RegistrationInput.avatarUrl` takes one. But it takes
 * a *URL to an object already in storage*, and the only thing in this codebase
 * that puts an object there is `proposeAvatarChange`, which needs a membership
 * that does not exist until this form succeeds. So the field would have been a
 * file input with nowhere to send bytes. `registration.ts` already records the
 * retention half of the same gap (an avatar set this way has no storage key and
 * can never be deleted), and master plan §7.14 owns it.
 *
 * **The username and password.** The fixture form offered both, under copy
 * saying a manager can add them later. Nothing in the running application calls
 * `setPasswordHasher` — checked across `src/`, and
 * `tests/domain/members/registration-not-wired.test.ts` pins what the default
 * does — so a submission carrying a password reaches `NotWired`
 * ("password_hasher_not_wired"), which is a fault and not a refusal: the
 * volunteer would get a server error, not a sentence. Leaving the fields in and
 * catching `NotWired` into a friendly message would be worse, because it hides a
 * boot-time wiring bug behind a sentence describing a different problem — the
 * exact reasoning `NotWired` was reshaped to make impossible. Credentials are
 * `SetReaderCredentials`' job and BR §16.3 puts that on the reader's own detail
 * page. Wiring the hasher belongs to the slice that wires registration itself,
 * which `a-wired-page-renders-no-fixtures.test.ts` already names as an open one.
 *
 * ── And nothing typed comes back on a refusal ────────────────────────────────
 *
 * Every other form in this slice carries its state in the query string. These
 * fields are a child's date of birth, their parents' names and a family
 * telephone number, and a query string is written into browser history, a
 * proxy's log and the address bar of a shared parish phone. The action's own
 * docstring holds the decision; the cost — a re-typed form after a refusal — is
 * real and is the one being chosen.
 *
 * **Proposed and withdrawn once already (Task 13, 2026-08-10 QA remediation).**
 * A same-session task carried these six fields back through this same query
 * string, reasoning from the QA sweep's observation about a different form
 * (`/dang-ky`) without re-reading this paragraph first — the on-behalf form is
 * a manager typing a child's details standing at the shelf, and the parish
 * phone this address bar would sit in is exactly as shared as the one
 * `dang-ky/actions.ts` withholds a password from. Reverted before merge on the
 * ground stated above. See `registerReaderOnBehalfAction`'s own docstring for
 * the fuller account and the alternative (a same-origin cookie or
 * `useActionState`) that would get the UX without the leak, as its own task.
 */
export default async function RegisterReaderOnBehalfPage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refused = refusalFrom(search);

  const { shelf, viewer, counts, parish } = await loadPage(
    slug,
    async (tx, ctx, viewer) => ({
      shelf: await readShelf(tx, ctx),
      viewer,
      counts: await getManagerBadgeCounts(tx, ctx),
      parish: await getParishUnits(tx, ctx),
    }),
  );

  const base = `/tu-sach/${slug}/quan-ly`;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="nguoi-doc"
      viewer={viewer}
      counts={counts}
    >
      <Link
        href={`${base}/nguoi-doc`}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-meta hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Quay lại danh sách bạn đọc
      </Link>

      <h1 className="mt-3 text-[28px] leading-tight font-semibold">
        Đăng ký người đọc mới
      </h1>
      <p className="mt-1.5 max-w-xl text-meta">
        Dùng khi có một em đang đứng trước mặt bạn ở nhà xứ. Bạn điền giúp thay vì
        em tự điền — thông tin và bước duyệt sau đó vẫn như một đăng ký bình thường.
      </p>

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      <form
        action={registerReaderOnBehalfAction}
        // QA remediation T27. See `Field`'s `invalidHint` docstring
        // (`src/components/ui/field.tsx`): the browser's own validation
        // bubble speaks the browser's UI language, not this document's
        // `lang="vi"`, and `noValidate` is what lets the Vietnamese
        // `invalidHint` text on the four required fields below show instead.
        noValidate
        className="mt-8 max-w-xl space-y-10"
      >
        <input type="hidden" name="tu-sach" value={slug} />

        <div className="space-y-6">
          <GroupHeading>Bản thân</GroupHeading>

          <Field label="Tên thánh" htmlFor="ten-thanh">
            <Input id="ten-thanh" name="ten-thanh" placeholder="vd: Maria" />
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

          {/* `type="date"` posts `YYYY-MM-DD`, which is the one shape
              `assertStorableDate` accepts. A free-text box here is how
              "02/04/2015" gets stored as 3 February — measured, in
              `domain/members/profile-fields.ts`. */}
          <Field
            label="Ngày sinh"
            required
            htmlFor="ngay-sinh"
            invalidHint="Vui lòng chọn ngày sinh."
          >
            <Input id="ngay-sinh" name="ngay-sinh" type="date" required />
          </Field>
        </div>

        <div className="space-y-6">
          <GroupHeading>Gia đình</GroupHeading>

          {/* BR §5.3 requires both, against OPS §4.3's own input list, and
              `users.father_name`/`mother_name` are `not null` in the schema —
              `registration.ts` records the whole disagreement. `required` here
              matches the command rather than the catalogue. */}
          <Field
            label="Tên cha"
            required
            htmlFor="ten-cha"
            hint="Giúp phân biệt các em trùng tên."
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
            label="Số điện thoại"
            required
            htmlFor="dien-thoai"
            hint="Số của cha mẹ cũng được. Đây là cách tủ sách liên lạc khi cần nhắc trả sách."
            // Same reused sentence `/dang-ky` pairs with this field's own
            // shape — see that page's comment on why `messageFor` rather
            // than new copy.
            invalidHint={messageFor("phone_invalid")}
          >
            <Input
              id="dien-thoai"
              name="dien-thoai"
              required
              type="tel"
              inputMode="numeric"
              pattern={PHONE_PATTERN}
              placeholder="vd: 09xx xxx xxx"
            />
          </Field>
        </div>

        <div className="space-y-6">
          <GroupHeading>Giáo xứ</GroupHeading>

          <p className="text-[14px] text-meta">
            Không bắt buộc. Chưa biết cũng cứ tạo hồ sơ — bổ sung sau cũng được.
          </p>

          {/* The shelf's own taxonomy, from `getParishUnits` rather than from a
              fixture shelf. Both selects are permanently optional (BR §5.6): a
              guessed tổ looks like knowledge, and telling two similarly named
              children apart is already the parents' names' job. */}
          <ParishUnitFields
            idPrefix="nguoi-doc-moi"
            taxonomy={parish.taxonomy}
            units={parish.units}
            manageHref={`${base}/co-cau`}
            // QA remediation final fix wave: this screen's empty state used
            // to say "Quản lý thêm ở mục Cơ cấu giáo xứ" to every manager,
            // but only a super_admin can actually write there
            // (`co-cau/page.tsx`'s own `canEdit`). See `ParishUnitFields`'s
            // own docstring on `canManageUnits` for the full reasoning.
            canManageUnits={viewer.role === "super_admin"}
          />
        </div>

        <div className="flex gap-3 rounded-card border border-hairline bg-paper p-5">
          <Info
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-leather"
            strokeWidth={1.75}
          />
          <p className="text-[15px] text-ink/90">
            Hồ sơ này vẫn vào hàng chờ duyệt, kể cả khi bạn là người điền. Bước
            duyệt được ghi vào nhật ký.
          </p>
        </div>

        <SubmitButton className="w-full">Tạo hồ sơ chờ duyệt</SubmitButton>
      </form>
    </ManagerShell>
  );
}
