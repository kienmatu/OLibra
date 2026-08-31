import { Head } from "@inertiajs/react";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

/**
 * PLACEHOLDER — Task 10's minimal stub, not the screen. Task 10 (this
 * commit) needs a file at this path only so `assertInertia()
 * ->component('manage/labels')` can resolve it under Inertia's
 * `testing.ensure_pages_exist`; Task 11 replaces this file with the real
 * selection screen (BR §19) that submits to `shelves.manage.exports
 * .qr-labels` via a plain HTML `<form method="post">`, per this task's
 * controller docblock — an Inertia visit cannot consume the PDF response
 * `LabelController::export()` returns.
 */
interface PageProps extends SharedData {
    titles: unknown[];
    onlyUnprinted: boolean;
}

export default function Labels(_props: PageProps) {
    return (
        <ManageLayout>
            <Head title={copy.common.appName} />
            <p className="text-muted-foreground">{copy.common.underConstruction}</p>
        </ManageLayout>
    );
}
