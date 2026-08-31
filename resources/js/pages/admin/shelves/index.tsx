import { Head, Link, usePage } from "@inertiajs/react";
import { AlertTriangle, Archive, CircleCheck, UserX } from "lucide-react";
import { route } from "ziggy-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * BR §16.4's Bookshelves screen. The rows come from AdminOverviewQuery —
 * the same shape the dashboard renders — so the two screens can never
 * disagree about which shelves exist or which of them need attention.
 */
interface AdminShelfRow {
    shelfId: string;
    slug: string;
    name: string;
    status: "active" | "archived";
    contactsMissing: boolean;
    managersMissing: boolean;
}

interface PageProps extends SharedData {
    shelves: AdminShelfRow[];
}

function ShelfRow({ shelf }: { shelf: AdminShelfRow }) {
    const archived = shelf.status === "archived";

    return (
        <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                    <p className="text-lg font-semibold">{shelf.name}</p>
                    <Label className="text-muted-foreground">{copy.adminShelves.slugHeading}</Label>
                    <p className="text-sm text-muted-foreground">{shelf.slug}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Label className="sr-only">{copy.adminShelves.statusHeading}</Label>
                    <Badge variant={archived ? "secondary" : "default"} className="gap-1">
                        <Icon iconNode={archived ? Archive : CircleCheck} className="size-3.5" />
                        {archived
                            ? copy.adminShelves.statusArchived
                            : copy.adminShelves.statusActive}
                    </Badge>
                    {shelf.contactsMissing && (
                        <Badge variant="destructive" className="gap-1">
                            <Icon iconNode={AlertTriangle} className="size-3.5" />
                            {copy.adminShelves.contactsMissing}
                        </Badge>
                    )}
                    {shelf.managersMissing && (
                        <Badge variant="destructive" className="gap-1">
                            <Icon iconNode={UserX} className="size-3.5" />
                            {copy.adminShelves.managersMissing}
                        </Badge>
                    )}
                    {/* Task 4's editor. A link rather than a button: this
                        row's own solid control is Task 6's archive, and two
                        solid controls on one row would be AGENTS.md rule 3
                        broken once per shelf. */}
                    <Link
                        href={route("admin.shelves.edit", { bookshelf: shelf.slug })}
                        className="text-sm underline"
                    >
                        {copy.adminShelves.editLink}
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}

export default function AdminShelves() {
    const { shelves } = usePage<PageProps>().props;

    return (
        <AdminLayout>
            <Head title={copy.adminShelves.title} />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <h2 className="text-xl font-semibold">{copy.adminShelves.title}</h2>
                {/* The one solid action on this screen, and the only route
                    in the application that creates a bookshelf — every
                    shelf before this task got there by seeder or by hand. */}
                <Button asChild className="h-14">
                    <Link href={route("admin.shelves.create")}>{copy.adminShelves.createLink}</Link>
                </Button>
            </div>

            {shelves.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.adminShelves.empty}</p>
            ) : (
                <div className="flex flex-col gap-4">
                    {shelves.map((shelf) => (
                        <ShelfRow key={shelf.shelfId} shelf={shelf} />
                    ))}
                </div>
            )}
        </AdminLayout>
    );
}
