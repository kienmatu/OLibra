import { Head, Link } from "@inertiajs/react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

export default function Home() {
    return (
        <AppLayout>
            <Head title={copy.home.title} />
            <h1 className="text-2xl font-semibold">{copy.home.title}</h1>
            <p className="mt-2 text-muted-foreground">{copy.home.lead}</p>
            <Link href={route("shelves.index")} className="mt-4 inline-block underline">
                {copy.home.browseShelves}
            </Link>
        </AppLayout>
    );
}
