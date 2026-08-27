import { Head, useForm } from "@inertiajs/react";
import type { FormEvent } from "react";
import { route } from "ziggy-js";
import AppLayout from "@/layouts/app-layout";
import { copy } from "@/lib/copy";

export default function Login() {
    const { data, setData, post, processing, errors, reset } = useForm({
        username: "",
        password: "",
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        post(route("login"), {
            onFinish: () => reset("password"),
        });
    };

    return (
        <AppLayout>
            <Head title={copy.auth.title} />
            <h1 className="text-2xl font-semibold">{copy.auth.title}</h1>
            <form onSubmit={submit} className="mt-6 flex max-w-sm flex-col gap-4">
                <label className="flex flex-col gap-1">
                    <span>{copy.auth.username}</span>
                    <input
                        type="text"
                        required
                        value={data.username}
                        onChange={(event) => setData("username", event.target.value)}
                        className="rounded border px-3 py-2"
                        autoComplete="username"
                    />
                    {errors.username ? (
                        <p className="text-sm text-red-700">{errors.username}</p>
                    ) : null}
                </label>
                <label className="flex flex-col gap-1">
                    <span>{copy.auth.password}</span>
                    <input
                        type="password"
                        required
                        value={data.password}
                        onChange={(event) => setData("password", event.target.value)}
                        className="rounded border px-3 py-2"
                        autoComplete="current-password"
                    />
                    {errors.password ? (
                        <p className="text-sm text-red-700">{errors.password}</p>
                    ) : null}
                </label>
                <button type="submit" disabled={processing} className="rounded border px-4 py-2">
                    {copy.auth.submit}
                </button>
            </form>
        </AppLayout>
    );
}
