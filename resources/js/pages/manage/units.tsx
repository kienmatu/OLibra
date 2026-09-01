import { Head, router, useForm, usePage } from "@inertiajs/react";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ManageLayout from "@/layouts/manage-layout";
import { copy, t } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * `shelves/{shelf}/manage/units` (spec D5, D6) — BR §5.6's parish units,
 * the rows a reader picks from at registration. Port of the reference's
 * `quan-ly/co-cau`; the Vietnamese path does not carry across, only the
 * screen does.
 *
 * **`canEdit` SWITCHES THE WHOLE TREE, AND THAT IS THIS FILE'S ONE RULE.**
 * All four writes are super-admin-only (OPS §4.5, `ParishUnitPolicy`) while
 * the route lets a shelf's own manager read the screen, so a manager gets
 * the same values as read-only text and never a control the server would
 * refuse. The reference shipped this screen with the forms visible to
 * everyone and corrected it before merge — its docstring records exactly
 * that — and this repo has now produced the same defect three times. The
 * prop is a courtesy, not the guard: every write re-checks in its Form
 * Request and again in its command.
 *
 * **THE REORDER GROUP IS THE UNIT'S REAL SIBLINGS, NEVER THE DISPLAY
 * LIST.** `ReorderParishUnits` requires the posted ids to share one
 * `(level, parent_id)` AND to be the entire group. A shelf that was nested
 * and had `nested` switched off keeps whatever `parent_id` each unit
 * already had — `UpdateParishTaxonomy` never rewrites a unit row — so two
 * units in the one flat list below can easily not share a parent. Posting
 * that flat list as a group is what made the reference refuse EVERY click
 * on a shelf shaped like that, found in review on its seeded shelf.
 * `level2ByParent` is the same grouping the nested branch uses, so this is
 * one rule applied twice rather than two rules.
 *
 * **THE SHAPE IS READ-ONLY FOR EVERYONE HERE**, super administrators
 * included: levels, nesting and the two labels are properties of the shelf,
 * stored in its `settings`, and the admin shelf editor owns them (Task 4).
 * The section says where they are changed rather than leaving a super
 * administrator to hunt.
 *
 * **ONE PRIMARY ACTION** (AGENTS.md rule 3): the solid button is the
 * level-1 "Thêm đơn vị". Every other control is outline or destructive.
 * Single-column forms, labels above inputs, the word *Bắt buộc* rather than
 * an asterisk (rule 6); no table anywhere, so rule 5 has nothing to break.
 */
interface UnitRow {
    id: string;
    parentId: string | null;
    name: string;
}

interface PageProps extends SharedData {
    taxonomy: {
        levels: 1 | 2;
        nested: boolean;
        level1Label: string;
        level2Label: string;
    };
    /** Live level-1 units, already in the order the picker offers them. */
    level1: UnitRow[];
    /** Live level-2 units, same ordering, across every parent. */
    level2: UnitRow[];
    /** The viewer is a super administrator — see the file header. */
    canEdit: boolean;
}

/** A read-only label/value row, for the shape block and the manager's tree. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="border-t py-4 first:border-t-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium">{children}</dd>
        </div>
    );
}

/**
 * "Lên" / "Xuống" for one row. Renders nothing for a group of one — there
 * is nowhere to move a unit with no siblings — and each press posts the
 * WHOLE group in its new order, because a partial list ties the ranks and
 * silently restores name ordering.
 */
function ReorderControls({ siblings, unit }: { siblings: UnitRow[]; unit: UnitRow }) {
    const { shelf } = usePage<PageProps>().props;
    const [sending, setSending] = useState(false);

    if (!shelf || siblings.length <= 1) return null;

    const index = siblings.findIndex((s) => s.id === unit.id);

    // router.post rather than useForm: the payload is derived from the
    // press (which group, in which new order) rather than held in fields,
    // and useForm's data would have to be written and read back in the
    // same tick to say so.
    const move = (to: number) => {
        const next = siblings.map((s) => s.id);
        const [moved] = next.splice(index, 1);
        next.splice(to, 0, moved);
        setSending(true);
        router.post(
            route("shelves.manage.units.reorder", { shelf: shelf.slug }),
            { unit_ids: next },
            {
                preserveScroll: (page) => !page.props.errors?.rule,
                onFinish: () => setSending(false),
            },
        );
    };

    return (
        <div className="flex shrink-0 gap-1">
            <Button
                type="button"
                variant="outline"
                className="size-11"
                disabled={index === 0 || sending}
                aria-label={t(copy.manageUnits.moveUp, { name: unit.name })}
                onClick={() => move(index - 1)}
            >
                <Icon iconNode={ChevronUp} className="size-4" />
            </Button>
            <Button
                type="button"
                variant="outline"
                className="size-11"
                disabled={index === siblings.length - 1 || sending}
                aria-label={t(copy.manageUnits.moveDown, { name: unit.name })}
                onClick={() => move(index + 1)}
            >
                <Icon iconNode={ChevronDown} className="size-4" />
            </Button>
        </div>
    );
}

/** "Đổi tên" — one row's rename form, closed until asked for. */
function RenameControl({ unit }: { unit: UnitRow }) {
    const { shelf } = usePage<PageProps>().props;
    const [open, setOpen] = useState(false);
    const renameForm = useForm({ name: unit.name });

    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        renameForm.patch(
            route("shelves.manage.units.rename", { shelf: shelf.slug, parishUnit: unit.id }),
            {
                preserveScroll: (page) => !page.props.errors?.rule,
                onSuccess: () => setOpen(false),
            },
        );
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.manageUnits.rename}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex w-full flex-col gap-3">
            <div>
                <Label htmlFor={`unit-name-${unit.id}`}>
                    {copy.manageUnits.renameName}
                    <span className="ml-2 font-normal text-muted-foreground">
                        {copy.adminShelves.required}
                    </span>
                </Label>
                <Input
                    id={`unit-name-${unit.id}`}
                    value={renameForm.data.name}
                    onChange={(event) => renameForm.setData("name", event.target.value)}
                />
                <InputError message={renameForm.errors.name} />
            </div>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant="outline"
                    className="h-11"
                    disabled={renameForm.processing}
                >
                    {copy.manageUnits.submitRename}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.manageUnits.cancel}
                </Button>
            </div>
        </form>
    );
}

/**
 * "Xoá đơn vị này". `cascades` names the level-1 case, where the command
 * retires the live level-2 children in the same transaction — said before
 * the press rather than surprising somebody who meant to remove one row.
 */
function DeleteControl({ unit, cascades }: { unit: UnitRow; cascades: boolean }) {
    const { shelf } = usePage<PageProps>().props;
    const [open, setOpen] = useState(false);
    const form = useForm({});

    if (!shelf) return null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("shelves.manage.units.delete", { shelf: shelf.slug, parishUnit: unit.id }),
            { preserveScroll: (page) => !page.props.errors?.rule },
        );
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.manageUnits.delete}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="max-w-md text-sm text-muted-foreground">
                {cascades ? copy.manageUnits.deleteWarningCascades : copy.manageUnits.deleteWarning}
            </p>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant="destructive"
                    className="h-11"
                    disabled={form.processing}
                >
                    {copy.manageUnits.deleteConfirm}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.manageUnits.cancel}
                </Button>
            </div>
        </form>
    );
}

/**
 * "Thêm đơn vị" for one level, or for one level-1 parent. `parentId` is
 * present only on a NESTED level-2 form: on a flat shelf a level-2 unit
 * legitimately has no parent, and posting one there would be refused.
 */
function AddControl({
    level,
    parentId,
    levelLabel,
    primary,
}: {
    level: 1 | 2;
    parentId?: string;
    levelLabel: string;
    /** The one solid button on the page (AGENTS.md rule 3). */
    primary?: boolean;
}) {
    const { shelf } = usePage<PageProps>().props;
    const [open, setOpen] = useState(false);
    const addForm = useForm({ level, parent_id: parentId ?? null, name: "" });

    if (!shelf) return null;

    const fieldId = `add-unit-${level}-${parentId ?? "flat"}`;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        addForm.post(route("shelves.manage.units.store", { shelf: shelf.slug }), {
            preserveScroll: (page) => !page.props.errors?.rule,
            onSuccess: () => {
                addForm.reset("name");
                setOpen(false);
            },
        });
    };

    if (!open) {
        return (
            <Button
                type="button"
                variant={primary ? "default" : "outline"}
                className={primary ? "h-14" : "h-11"}
                onClick={() => setOpen(true)}
            >
                <Icon iconNode={Plus} className="size-4" />
                {copy.manageUnits.add}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="max-w-xl space-y-4">
            <div>
                <Label htmlFor={fieldId}>
                    {t(copy.manageUnits.addName, { label: levelLabel.toLowerCase() })}
                    <span className="ml-2 font-normal text-muted-foreground">
                        {copy.adminShelves.required}
                    </span>
                </Label>
                <Input
                    id={fieldId}
                    value={addForm.data.name}
                    onChange={(event) => addForm.setData("name", event.target.value)}
                />
                <InputError message={addForm.errors.name} />
                <InputError message={addForm.errors.level} />
                <InputError message={addForm.errors.parent_id} />
            </div>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant={primary ? "default" : "outline"}
                    className={primary ? "h-14" : "h-11"}
                    disabled={addForm.processing || addForm.data.name.trim() === ""}
                >
                    {copy.manageUnits.submitAdd}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.manageUnits.cancel}
                </Button>
            </div>
        </form>
    );
}

/** One unit's row of controls — rendered only when `canEdit`. */
function RowControls({
    unit,
    siblings,
    cascades,
}: {
    unit: UnitRow;
    siblings: UnitRow[];
    cascades: boolean;
}) {
    return (
        <div className="mt-3 flex flex-wrap items-start gap-3">
            <RenameControl unit={unit} />
            <DeleteControl unit={unit} cascades={cascades} />
            <ReorderControls siblings={siblings} unit={unit} />
        </div>
    );
}

export default function ManageUnits() {
    const {
        shelf,
        taxonomy,
        level1,
        level2,
        canEdit,
        errors: pageErrors,
        flash,
    } = usePage<PageProps>().props;

    if (!shelf) return null;

    // Grouped on the REAL parentId — the file header has the whole of why.
    const level2ByParent = new Map<string | null, UnitRow[]>();
    for (const unit of level2) {
        const group = level2ByParent.get(unit.parentId) ?? [];
        group.push(unit);
        level2ByParent.set(unit.parentId, group);
    }

    // The level-2 half renders only while the shelf is SET to two levels.
    // A shelf that drops to one keeps whatever level-2 rows it had —
    // nothing here deletes them — it simply stops managing them until it is
    // switched back, matching UpdateParishTaxonomy's own refusal to reset a
    // field it was not asked to change.
    const showLevel2 = taxonomy.levels === 2;

    return (
        <ManageLayout>
            <Head title={copy.manageUnits.title} />
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{copy.manageUnits.title}</h2>
                <p className="text-sm text-muted-foreground">
                    {t(copy.manageUnits.lead, { shelf: shelf.name })}
                </p>
            </div>

            {/* Four writes, four sentences — each names which act landed on
                a tree of many rows. role="status" so a screen reader is told
                without focus being stolen from the control just pressed. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/* The page-level bag: bootstrap/app.php turns a RuleViolated
                from any Action into back()->withErrors(['rule' => …]), so
                validation_failed (a duplicate name, a stale reorder list)
                and parish_unit_l1_not_found both land here already
                translated. Read under a local name, the shelf editor's own
                shape, so the forms' own bags stay separate from it. */}
            <InputError message={pageErrors.rule} />

            <section className="mb-10">
                <h3 className="mb-2 border-b pb-2 text-lg font-semibold">
                    {copy.manageUnits.shapeHeading}
                </h3>
                <dl className="max-w-xl">
                    <InfoRow label={copy.manageUnits.levelsLabel}>
                        {taxonomy.levels === 2
                            ? copy.manageUnits.levelsTwo
                            : copy.manageUnits.levelsOne}
                    </InfoRow>
                    {showLevel2 ? (
                        <InfoRow label={copy.manageUnits.nestedLabel}>
                            {taxonomy.nested ? copy.manageUnits.yes : copy.manageUnits.no}
                        </InfoRow>
                    ) : null}
                    <InfoRow label={copy.manageUnits.level1LabelLabel}>
                        {taxonomy.level1Label}
                    </InfoRow>
                    <InfoRow label={copy.manageUnits.level2LabelLabel}>
                        {taxonomy.level2Label}
                    </InfoRow>
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">{copy.manageUnits.shapeNote}</p>
            </section>

            <section className="space-y-4">
                <h3 className="border-b pb-2 text-lg font-semibold">
                    {copy.manageUnits.listHeading}
                </h3>

                {level1.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {t(copy.manageUnits.emptyLevel1, {
                            label: taxonomy.level1Label.toLowerCase(),
                        })}
                    </p>
                ) : null}

                {level1.map((unit) => {
                    const children = level2ByParent.get(unit.id) ?? [];
                    return (
                        <Card key={unit.id}>
                            <CardContent className="p-5">
                                <p className="font-semibold">
                                    {`${taxonomy.level1Label}: ${unit.name}`}
                                </p>
                                {canEdit ? (
                                    <RowControls unit={unit} siblings={level1} cascades />
                                ) : null}

                                {showLevel2 && taxonomy.nested ? (
                                    <div className="mt-4 ml-2 space-y-4 border-l-2 pl-4">
                                        {children.map((child) => (
                                            <div key={child.id}>
                                                <p className="text-sm">
                                                    {`${taxonomy.level2Label}: ${child.name}`}
                                                </p>
                                                {canEdit ? (
                                                    <RowControls
                                                        unit={child}
                                                        siblings={children}
                                                        cascades={false}
                                                    />
                                                ) : null}
                                            </div>
                                        ))}
                                        {canEdit ? (
                                            <AddControl
                                                level={2}
                                                parentId={unit.id}
                                                levelLabel={taxonomy.level2Label}
                                            />
                                        ) : null}
                                    </div>
                                ) : null}
                            </CardContent>
                        </Card>
                    );
                })}

                {canEdit ? (
                    <AddControl level={1} levelLabel={taxonomy.level1Label} primary />
                ) : null}

                {showLevel2 && !taxonomy.nested ? (
                    <div className="space-y-4 pt-4">
                        <h4 className="font-semibold">{taxonomy.level2Label}</h4>
                        {level2.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(copy.manageUnits.emptyLevel2, {
                                    label: taxonomy.level2Label.toLowerCase(),
                                })}
                            </p>
                        ) : null}
                        {level2.map((unit) => (
                            <Card key={unit.id}>
                                <CardContent className="p-5">
                                    <p className="font-semibold">{unit.name}</p>
                                    {canEdit ? (
                                        <RowControls
                                            unit={unit}
                                            // The unit's REAL siblings, never
                                            // this flat display list — see
                                            // the file header.
                                            siblings={level2ByParent.get(unit.parentId) ?? [unit]}
                                            cascades={false}
                                        />
                                    ) : null}
                                </CardContent>
                            </Card>
                        ))}
                        {canEdit ? (
                            <AddControl level={2} levelLabel={taxonomy.level2Label} />
                        ) : null}
                    </div>
                ) : null}

                {canEdit && showLevel2 && taxonomy.nested && level1.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {t(copy.manageUnits.needLevel1First, {
                            parent: taxonomy.level1Label.toLowerCase(),
                            child: taxonomy.level2Label.toLowerCase(),
                        })}
                    </p>
                ) : null}

                {canEdit ? null : (
                    <p className="text-sm text-muted-foreground">
                        {copy.manageUnits.superAdminOnly}
                    </p>
                )}
            </section>
        </ManageLayout>
    );
}
