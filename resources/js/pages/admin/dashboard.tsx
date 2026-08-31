import { Head, usePage } from "@inertiajs/react";
import { AlertTriangle, Archive, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/layouts/admin-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface AdminShelfRow {
    shelfId: string;
    slug: string;
    name: string;
    status: "active" | "archived";
    books: number;
    readers: number;
    loans: number;
    overdue: number;
    pending: number;
    contactsMissing: boolean;
}

interface PageProps extends SharedData {
    shelves: AdminShelfRow[];
}

const NUMBER = new Intl.NumberFormat("vi-VN");

function Stat({ label, value }: { label: string; value: number }) {
    return (
        <div>
            <Label className="text-muted-foreground">{label}</Label>
            <p className="text-lg font-semibold">{NUMBER.format(value)}</p>
        </div>
    );
}

function ShelfRow({ shelf }: { shelf: AdminShelfRow }) {
    return (
        <Card>
            <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <Label className="text-muted-foreground">
                            {copy.adminDashboard.shelfHeading}
                        </Label>
                        <p className="text-lg font-semibold">{shelf.name}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div>
                            <Label className="sr-only">{copy.adminDashboard.statusHeading}</Label>
                            <Badge
                                variant={shelf.status === "archived" ? "secondary" : "default"}
                                className="gap-1"
                            >
                                <Icon
                                    iconNode={shelf.status === "archived" ? Archive : CircleCheck}
                                    className="size-3.5"
                                />
                                {shelf.status === "archived"
                                    ? copy.adminDashboard.statusArchived
                                    : copy.adminDashboard.statusActive}
                            </Badge>
                        </div>
                        {shelf.contactsMissing && (
                            <Badge variant="destructive" className="gap-1">
                                <Icon iconNode={AlertTriangle} className="size-3.5" />
                                {copy.adminDashboard.contactsMissing}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                    <Stat label={copy.adminDashboard.booksHeading} value={shelf.books} />
                    <Stat label={copy.adminDashboard.readersHeading} value={shelf.readers} />
                    <Stat label={copy.adminDashboard.loansHeading} value={shelf.loans} />
                    <Stat label={copy.adminDashboard.overdueHeading} value={shelf.overdue} />
                    <Stat label={copy.adminDashboard.pendingHeading} value={shelf.pending} />
                </div>
            </CardContent>
        </Card>
    );
}

export default function AdminDashboard() {
    const { shelves } = usePage<PageProps>().props;

    return (
        <AdminLayout>
            <Head title={copy.adminDashboard.title} />
            <h2 className="mb-4 text-xl font-semibold">{copy.adminDashboard.title}</h2>

            {shelves.length === 0 ? (
                <p className="text-sm text-muted-foreground">{copy.adminDashboard.empty}</p>
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
