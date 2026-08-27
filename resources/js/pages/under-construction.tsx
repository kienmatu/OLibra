import { Head, Link } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

export default function UnderConstruction() {
    return (
        <AppLayout>
            <Head title={copy.common.appName} />
            <p className="text-muted-foreground">{copy.common.underConstruction}</p>
            <Link href={route("home")} className="mt-4 inline-block underline">
                {copy.common.backHome}
            </Link>
        </AppLayout>
    );
}
