import { Head, Link, useForm, usePage } from "@inertiajs/react";
import { type FormEvent, useState } from "react";
import { route } from "ziggy-js";
import InputError from "@/components/input-error";
import ParishUnitFields, {
    type ParishTaxonomyProp,
    type ParishUnitProp,
} from "@/components/parish-unit-fields";
import RegistrationPersonFields, {
    type PersonFieldValues,
} from "@/components/registration-person-fields";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/lib/copy";
import type { SharedData, SharedShelf } from "@/types";

// Reuses SharedData's own SharedShelf shape (id/slug/name) rather than a
// narrower { slug, name } — SharedData already declares `shelf:
// SharedShelf | null` (HandleInertiaRequests::share()'s own key, mirrored
// from TenantContext), and a page-declared `shelf` of a different shape
// would be a TS2430 interface-extension error, not a stylistic choice.
// The two never collide at runtime: HandleInertiaRequests shares BEFORE
// this controller ever binds TenantContext (this route carries no
// `tenant` middleware), so the shared `shelf` is null and this page's own
// explicit prop is what Inertia::render() actually sends.
interface PageProps extends SharedData {
    shelf: SharedShelf | null;
    taxonomy: ParishTaxonomyProp | null;
    units: ParishUnitProp[];
    sent: boolean;
}

type RegisterFormValues = PersonFieldValues & {
    shelf: string;
    username: string;
    password: string;
    password_confirmation: string;
    parish_unit_l1_id: string;
    parish_unit_l2_id: string;
};

export default function Register() {
    const { shelf, taxonomy, units, sent, errors } = usePage<PageProps>().props;
    const [confirming, setConfirming] = useState(false);

    const form = useForm<RegisterFormValues>({
        shelf: shelf?.slug ?? "",
        username: "",
        password: "",
        password_confirmation: "",
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
    });

    if (!shelf || !taxonomy) {
        return (
            <main className="mx-auto max-w-xl px-6 py-16">
                <Head title={copy.register.title} />
                <h1 className="text-[28px] font-semibold">{copy.register.title}</h1>
                <p className="mt-1.5 text-muted-foreground">{copy.register.chooseFirst}</p>
                <Link
                    href={route("shelves.index")}
                    className="mt-6 inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
                >
                    {copy.register.chooseShelf}
                </Link>
            </main>
        );
    }

    const post = () => form.post(route("register.store"), { preserveScroll: true });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        // BR §16.1's danger confirmation: an empty phone needs a typed
        // reason before the form will go. With JS unavailable this handler
        // never runs, the server refuses thieu-so-dien-thoai, and the
        // reason field renders inline — nothing lives only in the dialog.
        if (form.data.phone.trim() === "" && form.data.phone_missing_reason.trim() === "") {
            setConfirming(true);
            return;
        }
        post();
    };

    const ruleError = (errors as Record<string, string>).rule;
    const showPhoneReason =
        form.data.phone.trim() === "" &&
        (form.data.phone_missing_reason !== "" || Boolean(ruleError));

    return (
        <main className="mx-auto max-w-xl px-6 py-16">
            <Head title={copy.register.title} />
            <h1 className="text-[28px] font-semibold">{copy.register.title}</h1>
            <p className="mt-1.5 text-muted-foreground">{copy.register.lead}</p>

            {sent ? (
                <p className="mt-6 rounded-md border bg-muted px-4 py-3 text-[15px]">
                    {copy.register.sent}
                </p>
            ) : null}
            {ruleError ? (
                <p className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-[15px]">
                    {ruleError}
                </p>
            ) : null}

            <form onSubmit={submit} className="mt-10 space-y-10" noValidate>
                <section className="space-y-3">
                    <div className="space-y-2">
                        <Label>{copy.register.forShelf}</Label>
                        <p className="rounded-md border bg-muted px-3 py-2 text-[15px]">
                            {shelf.name}
                        </p>
                        {/*
                          Fix round, Task 13, Minor #3: `shelf` travels as a
                          hidden form value derived from the URL, not a
                          user-editable field, so it had no render site at
                          all — a tampered POST that fails the `shelf`
                          rule (required/string/max:255) returned the
                          guest to this exact page with `errors.shelf` set
                          and nothing on screen to show it. The normal
                          path (an untouched form) never has this error,
                          since form.data.shelf always mirrors a slug this
                          page itself resolved on GET.
                        */}
                        <InputError message={form.errors.shelf} />
                    </div>
                    <Link
                        href={route("shelves.index")}
                        className="inline-flex min-h-11 items-center text-[14px] underline-offset-4 hover:underline"
                    >
                        {copy.register.changeShelf}
                    </Link>
                </section>

                <section className="space-y-6">
                    <h2 className="border-b pb-3 text-xl font-semibold">
                        {copy.register.groupCredentials}
                    </h2>
                    <p className="text-[14px] text-muted-foreground">
                        {copy.register.credentialsNote}
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="username">{copy.register.username}</Label>
                        <Input
                            id="username"
                            autoComplete="username"
                            value={form.data.username}
                            onChange={(e) => form.setData("username", e.target.value)}
                        />
                        <p className="text-[13px] text-muted-foreground">
                            {copy.register.usernameHint}
                        </p>
                        <InputError message={form.errors.username} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">{copy.register.password}</Label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete="new-password"
                            value={form.data.password}
                            onChange={(e) => form.setData("password", e.target.value)}
                        />
                        <p className="text-[13px] text-muted-foreground">
                            {copy.register.passwordHint}
                        </p>
                        <InputError message={form.errors.password} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password_confirmation">
                            {copy.register.passwordConfirm}
                        </Label>
                        <Input
                            id="password_confirmation"
                            type="password"
                            autoComplete="new-password"
                            value={form.data.password_confirmation}
                            onChange={(e) => form.setData("password_confirmation", e.target.value)}
                        />
                    </div>
                </section>

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
                    <p className="text-[14px] text-muted-foreground">{copy.register.parishNote}</p>
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

                <div className="rounded-md border bg-muted p-5">
                    <p className="font-semibold">{copy.register.afterTitle}</p>
                    <p className="mt-1.5 text-[15px] text-muted-foreground">
                        {copy.register.afterBody}
                    </p>
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={form.processing}>
                    {copy.register.submit}
                </Button>

                <p className="text-center text-[15px]">
                    <Link
                        href={route("login")}
                        className="font-medium underline-offset-4 hover:underline"
                    >
                        {copy.register.haveAccount}
                    </Link>
                </p>
            </form>

            <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{copy.register.phoneDialogTitle}</DialogTitle>
                        <DialogDescription>{copy.register.phoneDialogBody}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="dialog-reason">{copy.register.phoneMissingReason}</Label>
                        <textarea
                            id="dialog-reason"
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]"
                            value={form.data.phone_missing_reason}
                            onChange={(e) => form.setData("phone_missing_reason", e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirming(false)}>
                            {copy.register.phoneDialogCancel}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={form.data.phone_missing_reason.trim() === ""}
                            onClick={() => {
                                setConfirming(false);
                                post();
                            }}
                        >
                            {copy.register.phoneDialogConfirm}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </main>
    );
}
