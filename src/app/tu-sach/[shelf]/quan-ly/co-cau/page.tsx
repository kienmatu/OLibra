import { AlertCircle, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import { defaultTaxonomy, type ParishUnit } from "@/domain/members/parish-taxonomy";
import { getParishUnits } from "@/domain/members/queries/get-parish-units";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { loadPage } from "@/lib/page-data";
import { refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import {
  createUnitAction,
  deleteUnitAction,
  renameUnitAction,
  reorderUnitsAction,
  updateTaxonomyAction,
} from "../actions";

/**
 * Task 3 (QA remediation) — the screen `updateParishTaxonomy`, `createParishUnit`,
 * `renameParishUnit`, `deleteParishUnit` and `reorderParishUnits` never had.
 *
 * All five commands shipped in B2b, fully tested against a real database
 * (`tests/domain/members/parish-units.test.ts`), and called from nowhere —
 * the QA sweep of 10/08/2026 found the consequence on the reader-registration
 * form: a "Giáo xứ" section with a heading, a line of helper text, and no
 * field at all, because `parish_units` had never once been written to
 * outside a test. `src/components/parish-unit-fields.tsx` now names this
 * screen in that empty state's sentence.
 *
 * **Modelled on `src/app/quan-tri/the-loai/page.tsx`**, the closest sibling —
 * a `<details>` disclosure for "create" and a per-row `<details>` pair for
 * rename and delete. This screen adds a third per-row control the categories
 * screen has no equivalent of: `reorderUnitsAction`'s "Lên"/"Xuống", because
 * unlike a category, a unit's position is meaning (BR §5.6, taxonomy design
 * §7 — "Tổ 10" must not sort ahead of "Tổ 2" because of its digits).
 *
 * **Every write here is `super_admin`-only** (OPS §4.5). `getManagerBadgeCounts`
 * below raises the *read* floor to `manager`, matching every other page under
 * `quan-ly/*` — but a bare `manager`, or a shelf's own `admin` role (the
 * kernel's `Role` ranks it below `super_admin`), cannot call any of the five
 * commands. Rendering the write forms to them anyway would be exactly the
 * defect this branch's own QA sweep spent itself cataloguing on other
 * screens: a control that looks enabled and does nothing. **This first
 * shipped that way — reviewed and corrected before merge.**
 *
 * `canEdit` (`viewer.role === "super_admin"`) below is what switches the page
 * between the interactive tree and a read-only rendering of the same values,
 * mirroring the split `quan-ly/cai-dat` already draws for its own
 * `super_admin`-only lending policy: plain text, under "Chỉ quản trị viên mới
 * đổi được các mục này." `viewer` already carries the role `loadPage`
 * resolved, so this reads it rather than adding a second query. BR §13.3's
 * rule still holds exactly — this is the page deciding *visibility*; every
 * one of the five commands re-checks `requireSuperAdmin` for itself
 * regardless of what this branch renders, and no second copy of that check
 * belongs here.
 *
 * `parish_units` is tenant-scoped under ordinary RLS, unlike `categories`
 * (global, no `bookshelf_id`), so this goes through `loadPage`/`submitCommand`
 * rather than the admin escalation `the-loai` needed.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Cơ cấu giáo xứ — Quản lý tủ sách OLibra" };

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="border-b border-hairline pb-3 text-xl font-semibold">
      {children}
    </h2>
  );
}

/**
 * A read-only label/value row — `quan-ly/cai-dat`'s own `InfoRow`, copied
 * rather than imported. Each manager page under `quan-ly/*` defines its own
 * small private layout helpers (`GroupHeading` alone has three separate
 * copies); reaching into another route's module for one is the more
 * surprising coupling of the two.
 */
function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-hairline py-4 first:border-t-0">
      <dt className="text-[15px] text-meta">{label}</dt>
      <dd className="mt-1 text-[16px] font-medium text-ink">{children}</dd>
    </div>
  );
}

/** "Chỉ quản trị viên mới đổi được các mục này." — `cai-dat`'s own sentence,
 * for the same reason: both screens draw this line under a `super_admin`-only
 * section a `manager` can only read. */
function SuperAdminOnlyNote() {
  return (
    <p className="text-[14px] text-meta">
      Chỉ quản trị viên mới đổi được các mục này.
    </p>
  );
}

/**
 * "Lên" / "Xuống" on one row, sharing a single `<form>` (this file's own
 * header has the reasoning). Renders nothing for a group of one — there is
 * nowhere to move a unit with no siblings.
 */
function ReorderControls({
  shelfSlug,
  siblingIds,
  unit,
}: {
  shelfSlug: string;
  /** Every id in this unit's reorder group, in the order they render. */
  siblingIds: string[];
  unit: ParishUnit;
}) {
  if (siblingIds.length <= 1) return null;
  const index = siblingIds.indexOf(unit.id);

  return (
    <form action={reorderUnitsAction} className="flex shrink-0 gap-1">
      <input type="hidden" name="tu-sach" value={shelfSlug} />
      <input type="hidden" name="di-chuyen" value={unit.id} />
      {siblingIds.map((id) => (
        <input key={id} type="hidden" name="thu-tu" value={id} />
      ))}
      <button
        type="submit"
        name="huong"
        value="len"
        disabled={index === 0}
        aria-label={`Đưa ${unit.name} lên`}
        className={buttonClasses("quiet", "sm", "px-2.5")}
      >
        <ChevronUp aria-hidden className="size-4" strokeWidth={1.75} />
      </button>
      <button
        type="submit"
        name="huong"
        value="xuong"
        disabled={index === siblingIds.length - 1}
        aria-label={`Đưa ${unit.name} xuống`}
        className={buttonClasses("quiet", "sm", "px-2.5")}
      >
        <ChevronDown aria-hidden className="size-4" strokeWidth={1.75} />
      </button>
    </form>
  );
}

/** "Đổi tên" — one row's rename disclosure, pre-filled with its own name. */
function RenameDisclosure({
  shelfSlug,
  unit,
}: {
  shelfSlug: string;
  unit: ParishUnit;
}) {
  const fieldId = `ten-${unit.id}`;
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
        Đổi tên
      </summary>
      <form
        action={renameUnitAction}
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="don-vi" value={unit.id} />
        <Field label="Tên mới" required htmlFor={fieldId}>
          <Input
            id={fieldId}
            name="ten"
            required
            defaultValue={unit.name}
            className="max-w-64"
          />
        </Field>
        <SubmitButton variant="quiet" size="sm">
          Lưu tên
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * "Xoá đơn vị này" — one row's delete disclosure. `cascades` names the
 * level-1 case: `deleteParishUnit` soft-deletes its live level-2 children in
 * the same transaction, and the copy says so rather than surprise a manager
 * who only meant to remove one row.
 */
function DeleteDisclosure({
  shelfSlug,
  unit,
  cascades,
}: {
  shelfSlug: string;
  unit: ParishUnit;
  cascades: boolean;
}) {
  return (
    <details>
      <summary className="cursor-pointer list-none text-[14px] text-brick underline [&::-webkit-details-marker]:hidden">
        Xoá đơn vị này
      </summary>
      <form action={deleteUnitAction} className="mt-3 max-w-md space-y-3">
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="don-vi" value={unit.id} />
        <p className="text-[14px] text-meta">
          {cascades
            ? "Các đơn vị bậc 2 bên trong đơn vị này cũng sẽ bị xoá theo. "
            : ""}
          Bạn đọc đã ghi ở đây vẫn giữ lại lịch sử, chỉ không còn chọn được đơn vị
          này nữa.
        </p>
        <SubmitButton variant="danger" size="sm">
          Xác nhận xoá
        </SubmitButton>
      </form>
    </details>
  );
}

/** "Thêm đơn vị" — one level's (or one parent's) creation disclosure. */
function AddUnitDisclosure({
  shelfSlug,
  level,
  parentId,
  levelLabel,
}: {
  shelfSlug: string;
  level: 1 | 2;
  /** Present only for a nested level-2 form — see `createUnitAction`'s header. */
  parentId?: string;
  levelLabel: string;
}) {
  const fieldId = `them-${level}-${parentId ?? "chung"}`;
  return (
    <details>
      <summary
        className={buttonClasses(
          "outline",
          "sm",
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <Plus aria-hidden className="size-4" strokeWidth={1.75} />
        Thêm đơn vị
      </summary>
      <form
        action={createUnitAction}
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="tu-sach" value={shelfSlug} />
        <input type="hidden" name="bac" value={String(level)} />
        {parentId ? <input type="hidden" name="cha" value={parentId} /> : null}
        <Field
          label={`Tên ${levelLabel.toLowerCase()} mới`}
          required
          htmlFor={fieldId}
        >
          <Input id={fieldId} name="ten" required className="max-w-64" />
        </Field>
        <SubmitButton variant="quiet" size="sm">
          Thêm
        </SubmitButton>
      </form>
    </details>
  );
}

export default async function ParishStructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const refused = refusalFrom(await searchParams);

  const { shelf, viewer, counts, parish } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      parish: await getParishUnits(tx, ctx),
    }),
  );

  const { taxonomy, units } = parish;
  const fallback = defaultTaxonomy();

  // Level-1 units, and level-2 ones grouped by their real `parentId` — not
  // by `taxonomy.nested`, because a flat shelf's level-2 units all legitimately
  // share `parentId: null` and this grouping has to produce exactly the
  // sibling group `reorderParishUnits` itself requires ("all at one level,
  // under one parent") whichever shape the shelf is in.
  const l1Units = units.filter((u) => u.level === 1);
  const l2Units = units.filter((u) => u.level === 2);
  const l2ByParent = new Map<string | null, ParishUnit[]>();
  for (const u of l2Units) {
    const group = l2ByParent.get(u.parentId) ?? [];
    group.push(u);
    l2ByParent.set(u.parentId, group);
  }
  const l1Ids = l1Units.map((u) => u.id);

  // The level-2 tree renders only when the shelf is currently set to two
  // levels — the same gate `ParishUnitFields` uses for the reader-facing
  // field (`taxonomy.levels === 2`). A shelf that drops to one level keeps
  // any level-2 rows it already had (nothing here deletes them), it simply
  // stops managing them until it is switched back — matching
  // `updateParishTaxonomy`'s own "never resets a field it wasn't asked to
  // change".
  const showLevel2Tree = taxonomy.levels === 2;

  // The write gate this file's own header explains: all five commands are
  // `super_admin`-only, so a `manager` (or a shelf's own `admin`, which ranks
  // below it) gets a read-only rendering of the same values rather than forms
  // that would only ever answer "Bạn không có quyền thực hiện việc này."
  const canEdit = viewer.role === "super_admin";

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="co-cau"
      viewer={viewer}
      counts={counts}
    >
      <PageHeading
        title="Cơ cấu giáo xứ"
        subtitle={`Cách chia bạn đọc theo đơn vị, và danh sách đơn vị của ${shelf.name}.`}
      />

      {refused ? (
        <p
          role="alert"
          className="mt-5 flex max-w-2xl items-center gap-2 rounded-card border border-brick bg-brick/8 px-4 py-3 text-[15px] text-brick"
        >
          <AlertCircle aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
          {messageFor(refused)}
        </p>
      ) : null}

      <div className="mt-8 max-w-2xl space-y-12">
        <section className="space-y-6">
          <SectionHeading>Cách gọi các đơn vị</SectionHeading>

          {canEdit ? (
            <form action={updateTaxonomyAction} className="space-y-6">
              <input type="hidden" name="tu-sach" value={slug} />

              <fieldset className="space-y-3">
                <legend className="text-[16px] font-medium">Số bậc</legend>
                <p className="text-[14px] text-meta">
                  Giáo xứ chia bạn đọc theo một bậc (chỉ giáo họ), hay theo hai bậc
                  (giáo họ rồi tới tổ)?
                </p>
                <div className="flex flex-wrap gap-5">
                  <label className="flex min-h-11 items-center gap-2.5 text-[16px]">
                    <input
                      type="radio"
                      name="so-bac"
                      value="1"
                      defaultChecked={taxonomy.levels === 1}
                      className="size-5 accent-terracotta"
                    />
                    Một bậc
                  </label>
                  <label className="flex min-h-11 items-center gap-2.5 text-[16px]">
                    <input
                      type="radio"
                      name="so-bac"
                      value="2"
                      defaultChecked={taxonomy.levels === 2}
                      className="size-5 accent-terracotta"
                    />
                    Hai bậc
                  </label>
                </div>
              </fieldset>

              <label className="flex min-h-11 items-start gap-3 rounded-card border border-hairline bg-surface p-4">
                <input
                  type="checkbox"
                  name="long-nhau"
                  defaultChecked={taxonomy.nested}
                  className="mt-1 size-5 shrink-0 accent-terracotta"
                />
                <span>
                  <span className="block text-[16px] font-medium">
                    Bậc 2 thuộc về một đơn vị bậc 1 cụ thể
                  </span>
                  <span className="mt-0.5 block text-[14px] text-meta">
                    Ví dụ: mỗi tổ thuộc về một giáo họ. Bỏ chọn nếu bậc 2 là một
                    danh sách chung, không theo giáo họ nào.
                  </span>
                </span>
              </label>

              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Tên gọi bậc 1" required htmlFor="ten-bac-1">
                  <Input
                    id="ten-bac-1"
                    name="ten-bac-1"
                    required
                    defaultValue={taxonomy.level1Label}
                    placeholder={fallback.level1Label}
                  />
                </Field>
                <Field label="Tên gọi bậc 2" required htmlFor="ten-bac-2">
                  <Input
                    id="ten-bac-2"
                    name="ten-bac-2"
                    required
                    defaultValue={taxonomy.level2Label}
                    placeholder={fallback.level2Label}
                  />
                </Field>
              </div>

              <SubmitButton variant="primary">Lưu cách gọi</SubmitButton>
            </form>
          ) : (
            <div className="space-y-3">
              <dl>
                <InfoRow label="Số bậc">
                  {taxonomy.levels === 2 ? "Hai bậc" : "Một bậc"}
                </InfoRow>
                {taxonomy.levels === 2 ? (
                  <InfoRow label="Bậc 2 thuộc về một đơn vị bậc 1 cụ thể">
                    {taxonomy.nested ? "Có" : "Không"}
                  </InfoRow>
                ) : null}
                <InfoRow label="Tên gọi bậc 1">{taxonomy.level1Label}</InfoRow>
                <InfoRow label="Tên gọi bậc 2">{taxonomy.level2Label}</InfoRow>
              </dl>
              <SuperAdminOnlyNote />
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionHeading>Danh sách đơn vị</SectionHeading>

          <ul className="divide-y divide-hairline rounded-card border border-hairline">
            {l1Units.map((unit) => {
              const children = l2ByParent.get(unit.id) ?? [];
              return (
                <li key={unit.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[16px] font-medium">
                      {taxonomy.level1Label}: {unit.name}
                    </p>
                    {canEdit ? (
                      <ReorderControls
                        shelfSlug={slug}
                        siblingIds={l1Ids}
                        unit={unit}
                      />
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="mt-3 flex flex-wrap items-center gap-5">
                      <RenameDisclosure shelfSlug={slug} unit={unit} />
                      <DeleteDisclosure shelfSlug={slug} unit={unit} cascades />
                    </div>
                  ) : null}

                  {showLevel2Tree && taxonomy.nested ? (
                    <div className="mt-4 ml-2 space-y-4 border-l-2 border-hairline pl-4">
                      {children.map((child) => (
                        <div key={child.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-[15px]">
                              {taxonomy.level2Label}: {child.name}
                            </p>
                            {canEdit ? (
                              <ReorderControls
                                shelfSlug={slug}
                                siblingIds={children.map((c) => c.id)}
                                unit={child}
                              />
                            ) : null}
                          </div>
                          {canEdit ? (
                            <div className="mt-2 flex flex-wrap items-center gap-5">
                              <RenameDisclosure shelfSlug={slug} unit={child} />
                              <DeleteDisclosure
                                shelfSlug={slug}
                                unit={child}
                                cascades={false}
                              />
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {canEdit ? (
                        <AddUnitDisclosure
                          shelfSlug={slug}
                          level={2}
                          parentId={unit.id}
                          levelLabel={taxonomy.level2Label}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {l1Units.length === 0 ? (
            <p className="text-[15px] text-meta">
              Chưa có đơn vị {taxonomy.level1Label.toLowerCase()} nào.
            </p>
          ) : null}

          {canEdit ? (
            <AddUnitDisclosure
              shelfSlug={slug}
              level={1}
              levelLabel={taxonomy.level1Label}
            />
          ) : null}

          {showLevel2Tree && !taxonomy.nested ? (
            <div className="space-y-4 pt-4">
              <h3 className="text-[16px] font-semibold">{taxonomy.level2Label}</h3>
              <ul className="divide-y divide-hairline rounded-card border border-hairline">
                {l2Units.map((unit) => {
                  // The reorder group is this unit's *real* siblings — every
                  // live level-2 unit sharing its actual `parentId` — never
                  // the flat `l2Units` display list. A shelf that was nested
                  // before and just had `nested` switched off keeps whatever
                  // `parentId` each unit already had (`updateParishTaxonomy`
                  // never rewrites a unit row), so two units in this one
                  // visual list can easily not share a parent; posting the
                  // whole flat list as one `unitIds` group is exactly what
                  // made `reorderParishUnits`'s own "share one parent" check
                  // refuse every click on a shelf shaped like that — found in
                  // review, on the seeded `dong-thap` shelf. `l2ByParent` is
                  // the same grouping the nested branch above already uses,
                  // so this is one rule applied twice, not two rules.
                  const siblings = l2ByParent.get(unit.parentId) ?? [unit];
                  return (
                    <li key={unit.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-[16px] font-medium">{unit.name}</p>
                        {canEdit ? (
                          <ReorderControls
                            shelfSlug={slug}
                            siblingIds={siblings.map((u) => u.id)}
                            unit={unit}
                          />
                        ) : null}
                      </div>
                      {canEdit ? (
                        <div className="mt-3 flex flex-wrap items-center gap-5">
                          <RenameDisclosure shelfSlug={slug} unit={unit} />
                          <DeleteDisclosure
                            shelfSlug={slug}
                            unit={unit}
                            cascades={false}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {l2Units.length === 0 ? (
                <p className="text-[15px] text-meta">
                  Chưa có đơn vị {taxonomy.level2Label.toLowerCase()} nào.
                </p>
              ) : null}
              {canEdit ? (
                <AddUnitDisclosure
                  shelfSlug={slug}
                  level={2}
                  levelLabel={taxonomy.level2Label}
                />
              ) : null}
            </div>
          ) : null}

          {canEdit && showLevel2Tree && taxonomy.nested && l1Units.length === 0 ? (
            <p className="text-[15px] text-meta">
              Cần có ít nhất một đơn vị {taxonomy.level1Label.toLowerCase()} trước
              khi thêm đơn vị {taxonomy.level2Label.toLowerCase()}.
            </p>
          ) : null}

          {canEdit ? null : <SuperAdminOnlyNote />}
        </section>
      </div>
    </ManagerShell>
  );
}
