import { Head, useForm, usePage } from "@inertiajs/react";
import { KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
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
            preserveScroll: true,
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
            { preserveScroll: true },
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

    if (manager.role === "super_admin") {
        return null;
    }

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("admin.managers.promote", { user: manager.userId }), {
            preserveScroll: true,
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
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={superAdmin ? "default" : "secondary"} className="gap-1">
                        <Icon iconNode={superAdmin ? ShieldCheck : UserCog} className="size-3.5" />
                        {ROLE_LABEL[manager.role] ?? manager.role}
                    </Badge>
                    <RevokeControl manager={manager} />
                    <PromoteControl manager={manager} />
                </div>
            </CardContent>
        </Card>
    );
}

export default function AdminManagers() {
    const { managers, appointable } = usePage<PageProps>().props;

    return (
        <AdminLayout>
            <Head title={copy.adminManagers.title} />
            <div className="mb-4">
                <h2 className="text-xl font-semibold">{copy.adminManagers.title}</h2>
                <p className="text-sm text-muted-foreground">{copy.adminManagers.lead}</p>
            </div>

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
