import { Head, useForm } from "@inertiajs/react";
import { LoaderCircle } from "lucide-react";
import type { FormEventHandler } from "react";

import InputError from "@/components/input-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "@/layouts/auth-layout";

interface LoginForm {
    username: string;
    password: string;
}

export default function Login() {
    const { data, setData, post, processing, errors, reset } = useForm<LoginForm>({
        username: "",
        password: "",
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();
        post(route("login"), {
            onFinish: () => reset("password"),
        });
    };

    return (
        <AuthLayout title="Đăng nhập" description="Nhập tên đăng nhập và mật khẩu để tiếp tục">
            <Head title="Đăng nhập" />

            <form className="flex flex-col gap-6" onSubmit={submit}>
                <div className="grid gap-6">
                    <div className="grid gap-2">
                        <Label htmlFor="username">Tên đăng nhập</Label>
                        <Input
                            id="username"
                            type="text"
                            required
                            autoFocus
                            autoComplete="username"
                            value={data.username}
                            onChange={(e) => setData("username", e.target.value)}
                        />
                        <InputError message={errors.username} />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="password">Mật khẩu</Label>
                        <Input
                            id="password"
                            type="password"
                            required
                            autoComplete="current-password"
                            value={data.password}
                            onChange={(e) => setData("password", e.target.value)}
                        />
                        <InputError message={errors.password} />
                    </div>

                    <Button type="submit" className="mt-4 w-full" disabled={processing}>
                        {processing && <LoaderCircle className="h-4 w-4 animate-spin" />}
                        Đăng nhập
                    </Button>
                </div>
            </form>
        </AuthLayout>
    );
}
