import { Link } from "@inertiajs/react";
import { LogOut } from "lucide-react";
import {
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { UserInfo } from "@/components/user-info";
import { useMobileNavigation } from "@/hooks/use-mobile-navigation";
import type { User } from "@/types";

interface UserMenuContentProps {
    user: User;
}

// No "Settings" item here: Task 6 removed routes/settings.php (it wrote the
// starter kit's name/email/password columns, which no longer exist on
// users), and OLibra's real profile flow is a manager-approved proposal
// (BR §2), not a self-service settings screen — the next task that builds
// one puts the link back deliberately.
export function UserMenuContent({ user }: UserMenuContentProps) {
    const cleanup = useMobileNavigation();

    return (
        <>
            <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <UserInfo user={user} showEmail={true} />
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
                <Link
                    className="block w-full"
                    method="post"
                    href={route("logout")}
                    as="button"
                    onClick={cleanup}
                >
                    <LogOut className="mr-2" />
                    Log out
                </Link>
            </DropdownMenuItem>
        </>
    );
}
