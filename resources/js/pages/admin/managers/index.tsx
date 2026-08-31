import { Head, useForm, usePage } from "@inertiajs/react";
import { KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy } from "@/lib/copy";
import { formatInstantParts } from "@/lib/dates";
import type { SharedData } from "@/types";

/**
 * OPS §3.4's GetManagersList — everyone who can do anything, anywhere —
 * and the three grants of §4.5 (spec D5, D7).
 *
 * Super administrators are in the list with no shelf and no revoke
 * control: there is deliberately no demotion command in this port, so a
 * row for them offering one would be a button with nothing behind it.
 */
interface ManagerRow {
    membershipId: string | null;
    userId: string;
    fullName: string;
    phone: string | null;
    role: string;
    /**
     * A fact about the PERSON, not about this row. A super administrator who
     * also manages a shelf gets two rows — the global one and the shelf one
     * — and both are real: the shelf grant is genuinely revocable. What the
     * shelf row must not do is offer Promote, which would throw
     * `already_super_admin`. The server decides this rather than the screen
     * scanning the list for a second row with the same user id.
     */
    isSuperAdmin: boolean;
    /**
     * The membership's status, `null` on a super administrator's row —
     * there is no membership there to have one. A manager whose membership
     * is not `active` cannot act, which is exactly why /admin/shelves counts
     * their shelf as unmanned; the row says so rather than leaving the two
     * screens contradicting each other.
     */
    status: string | null;
    shelfId: string | null;
    shelfName: string | null;
    shelfSlug: string | null;
    lastActiveAt: string | null;
    /**
     * BR §16.4's confirmation, assembled by the server so it can name both
     * the person and the shelf. Null for a super administrator's row, which
     * has nothing to revoke.
     */
    revokeConfirmation: string | null;
}

interface AppointableShelf {
    shelfId: string;
    /**
     * The route key. Bookshelf binds by slug, so every admin URL naming a
     * shelf is built from this and never from `shelfId`.
     */
    slug: string;
    name: string;
    candidates: { userId: string; fullName: string }[];
}

interface PageProps extends SharedData {
    managers: ManagerRow[];
    appointable: AppointableShelf[];
}

const ROLE_LABEL: Record<string, string> = {
    super_admin: copy.adminManagers.roleSuperAdmin,
    admin: copy.adminManagers.roleAdmin,
    manager: copy.adminManagers.roleManager,
};

/**
 * The membership statuses, shared with every other screen that shows one —
 * a second spelling here would be a second vocabulary for the same column.
 */
const STATUS_LABEL: Record<string, string> = copy.membershipStatus;

const selectClass = "mt-1 h-11 rounded-md border border-input bg-background px-2 text-sm";

/**
 * The appoint form. Two selects: the shelf narrows the people, in the
 * browser rather than by a page reload — the reference reloaded because it
 * ran with no client JavaScript at all, and this port does not.
 *
 * Only active shelves and only their active readers are offered; the server
 * refuses anything else, so a control that offered more would be a control
 * whose only outcome is a refusal.
 */
function AssignForm({ shelves }: { shelves: AppointableShelf[] }) {
    const [shelfId, setShelfId] = useState("");
    const form = useForm({ user_id: "", role: "manager" });

    const chosen = shelves.find((shelf) => shelf.shelfId === shelfId) ?? null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (chosen === null) {
            return;
        }
        form.post(route("admin.managers.assign", { bookshelf: chosen.slug }), {
        // preserveScroll is conditional, not true. Both banners on this page sit at
        // the top, and the list runs one row per manager-or-admin membership across
        // every shelf — so holding the scroll position on a refusal leaves a
        // volunteer who pressed a control on row 20 staring at an unchanged row with
        // the explanation far above the fold. Hold the position when the act
        // succeeded (the row rewrites itself in place); go to the banner when it did
        // not. Inertia hands the callback the fresh page, so this reads the refusal
        // the server just set, not the one from last time.
        preserveScroll: (page) => !page.props.errors?.rule,
            onSuccess: () => form.reset(),
        });
    };

    if (shelves.length === 0) {
        return (
            <Card className="mb-6">
                <CardContent className="p-5">
                    <h3 className="mb-2 text-lg font-semibold">
                        {copy.adminManagers.assignSection}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {copy.adminManagers.assignNoShelves}
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="mb-6">
            <CardContent className="p-5">
                <h3 className="mb-3 text-lg font-semibold">{copy.adminManagers.assignSection}</h3>
                <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col text-sm">
                        {copy.adminManagers.assignShelf}
                        <select
                            className={selectClass}
                            value={shelfId}
                            onChange={(event) => {
                                setShelfId(event.target.value);
                                form.setData("user_id", "");
                            }}
                        >
                            <option value="">{copy.adminManagers.assignShelfPlaceholder}</option>
                            {shelves.map((shelf) => (
                                <option key={shelf.shelfId} value={shelf.shelfId}>
                                    {shelf.name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col text-sm">
                        {copy.adminManagers.assignPerson}
                        <select
                            className={selectClass}
                            value={form.data.user_id}
                            disabled={chosen === null || chosen.candidates.length === 0}
                            onChange={(event) => form.setData("user_id", event.target.value)}
                        >
                            <option value="">{copy.adminManagers.assignPersonPlaceholder}</option>
                            {(chosen?.candidates ?? []).map((candidate) => (
                                <option key={candidate.userId} value={candidate.userId}>
                                    {candidate.fullName}
                                </option>
                            ))}
                        </select>
                        {/* AssignManagerRequest validates both fields, and
                            both refusals are reachable from this form: a
                            submit with no person chosen fails `required`,
                            and a hand-posted role fails the Rule::in. Until
                            these two blocks existed the press simply did
                            nothing. */}
                        <InputError message={form.errors.user_id} />
                    </label>

                    {/* Spec D7: the form offers the choice rather than
                        assuming the lower grant. `reader` is not an option
                        anywhere here — demotion has its own control. */}
                    <label className="flex flex-col text-sm">
                        {copy.adminManagers.assignRole}
                        <select
                            className={selectClass}
                            value={form.data.role}
                            onChange={(event) => form.setData("role", event.target.value)}
                        >
                            <option value="manager">{copy.adminManagers.roleManager}</option>
                            <option value="admin">{copy.adminManagers.roleAdmin}</option>
                        </select>
                        <InputError message={form.errors.role} />
                    </label>

                    <Button
                        type="submit"
                        className="h-11"
                        disabled={form.processing || form.data.user_id === ""}
                    >
                        {copy.adminManagers.submitAssign}
                    </Button>
                </form>

                {chosen !== null && chosen.candidates.length === 0 && (
                    <p className="mt-3 text-sm text-muted-foreground">
                        {copy.adminManagers.assignNoCandidates}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * BR §16.4: "Revocation requires confirmation and states plainly that
 * history is retained." The sentence comes down from the server already
 * naming the person and the shelf; this only decides when it is shown, and
 * shows it BEFORE the destructive button rather than after the press.
 */
function RevokeControl({ manager }: { manager: ManagerRow }) {
    const [open, setOpen] = useState(false);
    const form = useForm({});

    if (manager.membershipId === null || manager.shelfSlug === null) {
        return null;
    }

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(
            route("admin.managers.revoke", {
                bookshelf: manager.shelfSlug,
                membership: manager.membershipId,
            }),
            { preserveScroll: (page) => !page.props.errors?.rule },
        );
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.adminManagers.revoke}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="max-w-md text-sm text-muted-foreground">{manager.revokeConfirmation}</p>
            <div className="flex gap-2">
                <Button
                    type="submit"
                    variant="destructive"
                    className="h-11"
                    disabled={form.processing}
                >
                    {copy.adminManagers.revokeConfirm}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.adminManagers.cancel}
                </Button>
            </div>
        </form>
    );
}

/** The global grant — the one control here with no way back. */
function PromoteControl({ manager }: { manager: ManagerRow }) {
    const [open, setOpen] = useState(false);
    const form = useForm({});

    // isSuperAdmin, not role — the role on a super administrator's SHELF row
    // reads `manager`, so a check on the role alone rendered a live button
    // whose only outcome was the `already_super_admin` refusal.
    if (manager.isSuperAdmin) {
        return null;
    }

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("admin.managers.promote", { user: manager.userId }), {
            preserveScroll: (page) => !page.props.errors?.rule,
        });
    };

    if (!open) {
        return (
            <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
                {copy.adminManagers.promote}
            </Button>
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            <p className="max-w-md text-sm text-muted-foreground">
                {copy.adminManagers.promoteWarning}
            </p>
            <div className="flex gap-2">
                <Button type="submit" className="h-11" disabled={form.processing}>
                    <Icon iconNode={KeyRound} className="size-4" />
                    {copy.adminManagers.promoteConfirm}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setOpen(false)}
                >
                    {copy.adminManagers.cancel}
                </Button>
            </div>
        </form>
    );
}

function ManagerCard({ manager }: { manager: ManagerRow }) {
    const superAdmin = manager.role === "super_admin";
    // A membership that is not active is a grant its holder cannot use.
    // Null is a super administrator's row, which has no membership at all.
    const dormant = manager.status !== null && manager.status !== "active";
    const lastActive =
        manager.lastActiveAt === null ? null : formatInstantParts(manager.lastActiveAt);

    return (
        <Card>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                    <p className="text-lg font-semibold">{manager.fullName}</p>
                    <Label className="sr-only">{copy.adminManagers.assignShelf}</Label>
                    <p className="text-sm text-muted-foreground">
                        {manager.shelfName ?? copy.adminManagers.wholeSystem}
                        {manager.phone === null ? "" : ` · ${manager.phone}`}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {lastActive === null
                            ? copy.adminManagers.neverActive
                            : `${copy.adminManagers.lastActive}: ${lastActive.date}`}
                    </p>
                    {/* Said in words, not only as the chip beside the role:
                        this is the sentence that explains why the same
                        shelf reads "Chưa có quản lý" on /admin/shelves. */}
                    {dormant && (
                        <p className="mt-1 text-sm text-destructive">
                            {copy.adminManagers.cannotActNote}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={superAdmin ? "default" : "secondary"} className="gap-1">
                        <Icon iconNode={superAdmin ? ShieldCheck : UserCog} className="size-3.5" />
                        {ROLE_LABEL[manager.role] ?? manager.role}
                    </Badge>
                    {dormant && (
                        <Badge variant="destructive">
                            {STATUS_LABEL[manager.status ?? ""] ?? manager.status}
                        </Badge>
                    )}
                    <RevokeControl manager={manager} />
                    <PromoteControl manager={manager} />
                </div>
            </CardContent>
        </Card>
    );
}

export default function AdminManagers() {
    const { managers, appointable, errors, flash } = usePage<PageProps>().props;

    return (
        <AdminLayout>
            <Head title={copy.adminManagers.title} />
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{copy.adminManagers.title}</h2>
                <p className="text-sm text-muted-foreground">{copy.adminManagers.lead}</p>
            </div>

            {/* Every one of the three grants redirects back here with a
                flash, and all three change a row further down that a
                volunteer would otherwise have to hunt for. role="status" so
                a screen reader is told without focus being stolen from the
                control that was just pressed. */}
            {flash.success ? (
                <p
                    role="status"
                    className="mb-4 rounded-md border border-green-700/30 bg-green-700/10 px-3 py-2 text-sm"
                >
                    {flash.success}
                </p>
            ) : null}

            {/* The page-level bag, by construction: bootstrap/app.php turns
                a RuleViolated from any Action into
                back()->withErrors(['rule' => …]) and back() follows the
                Referer, so `already_super_admin`, `not_a_manager` and
                `membership_not_found` all land here already translated —
                the manage/ pages' convention. Before this block every one
                of them was a press that did nothing and said nothing. */}
            {errors.rule ? (
                <p
                    role="alert"
                    className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                    {errors.rule}
                </p>
            ) : null}

            <AssignForm shelves={appointable} />

            {managers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.adminManagers.empty}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {managers.map((manager) => (
                        <ManagerCard
                            key={`${manager.userId}:${manager.membershipId ?? "global"}`}
                            manager={manager}
                        />
                    ))}
                </div>
            )}
        </AdminLayout>
    );
}
