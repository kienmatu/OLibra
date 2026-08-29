import { Head, useForm, usePage } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import ParishUnitFields, {
    type ParishTaxonomyProp,
    type ParishUnitProp,
} from "@/components/parish-unit-fields";
import RegistrationPersonFields, {
    type PersonFieldValues,
} from "@/components/registration-person-fields";
import { Button } from "@/components/ui/button";
import ManageLayout from "@/layouts/manage-layout";
import { copy } from "@/lib/copy";
import type { SharedData } from "@/types";

interface PageProps extends SharedData {
    book: { slug: string; title: string; author: string | null; coverUrl: string | null } | null;
    taxonomy: ParishTaxonomyProp;
    units: ParishUnitProp[];
}

type QuickLendReaderValues = PersonFieldValues & {
    parish_unit_l1_id: string;
    parish_unit_l2_id: string;
    book: string;
};

export default function QuickLendNewReader() {
    const { shelf, book, taxonomy, units, errors } = usePage<PageProps>().props;

    const form = useForm<QuickLendReaderValues>({
        saint_name: "",
        full_name: "",
        date_of_birth: "",
        father_name: "",
        mother_name: "",
        phone: "",
        phone_missing_reason: "",
        email: "",
        parish_unit_l1_id: "",
        parish_unit_l2_id: "",
        // The book travels in the form body, not the URL: the POST is the
        // only place that knows where to send the volunteer next.
        book: book?.slug ?? "",
    });

    if (!shelf) return null;
    const ruleError = (errors as Record<string, string>).rule;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        form.post(route("shelves.manage.lend.reader.store", { shelf: shelf.slug }));
    };

    // Same rule as the on-behalf form: the volunteer typing IS the person
    // the dialog would ask, so the reason box appears as soon as the phone
    // is blank.
    const showPhoneReason = form.data.phone.trim() === "";

    return (
        <ManageLayout>
            <Head title={copy.circulation.lend.newReaderTitle} />
            <h1 className="text-2xl font-semibold">{copy.circulation.lend.newReaderTitle}</h1>
            <p className="mt-1.5 max-w-xl text-muted-foreground">
                {copy.circulation.lend.newReaderLead}
            </p>
            {book ? <p className="mt-3 max-w-xl font-serif text-base">{book.title}</p> : null}
            {ruleError ? (
                <p role="alert" className="mt-4 max-w-xl rounded-md border px-4 py-3 text-[15px]">
                    {ruleError}
                </p>
            ) : null}

            <form onSubmit={submit} className="mt-8 max-w-xl space-y-10" noValidate>
                <RegistrationPersonFields
                    data={form.data}
                    errors={form.errors}
                    showPhoneReason={showPhoneReason}
                    setField={(field, value) => form.setData(field, value)}
                />
                <section className="space-y-6">
                    <h2 className="border-b pb-3 text-xl font-semibold">
                        {copy.register.groupParish}
                    </h2>
                    <ParishUnitFields
                        taxonomy={taxonomy}
                        units={units}
                        l1={form.data.parish_unit_l1_id}
                        l2={form.data.parish_unit_l2_id}
                        onChange={(l1, l2) => {
                            form.setData("parish_unit_l1_id", l1);
                            form.setData("parish_unit_l2_id", l2);
                        }}
                    />
                </section>
                <Button type="submit" size="lg" className="w-full" disabled={form.processing}>
                    {copy.circulation.lend.newReaderSubmit}
                </Button>
            </form>
        </ManageLayout>
    );
}
