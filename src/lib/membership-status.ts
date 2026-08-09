import {
  Clock,
  CircleX,
  Lock,
  LogOut,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { MembershipStatus } from "@/domain/members/policy";
import type { PillTone } from "@/components/ui/pill";

/**
 * BR §7.5's five membership statuses, each with the Vietnamese word, an icon and
 * a tone — together, always, because status is never carried by colour alone
 * (BR §17.2, and the rule `src/lib/status.ts` enforces for the six copy states
 * by the same construction).
 *
 * **A translation of the enum, and none of the five words is new.** This file is
 * where `membership_status` meets copy this project already shipped, rather than
 * a sixth place it gets written — the argument `src/lib/roles.ts` makes for the
 * three role words:
 *
 * - `active`, `pending`, `suspended`, `left` — **Đang hoạt động**, **Chờ
 *   duyệt**, **Tạm khoá**, **Đã rời**, with their icons, are `READER_STATUS` and
 *   `MEMBERSHIP_ICON` from the fixture version of `quan-ly/nguoi-doc`. The words
 *   survive the fixtures; the invented readers do not.
 * - `rejected` — **Đã từ chối**, from `toi/tang-sach`, which labels a declined
 *   donation with exactly that pair of word and icon (`CircleX`). The fixture
 *   reader list had no `rejected` entry at all, because its `Reader` type had no
 *   such state; the domain's enum does, `RejectMembership` writes it, and BR §2
 *   keeps the row precisely so it can be seen.
 *
 * `Record<MembershipStatus, …>` rather than a lookup that may miss, so a sixth
 * status added to the enum is a compile error here instead of a row that renders
 * a blank pill.
 */
export const MEMBERSHIP_STATUS: Record<
  MembershipStatus,
  { label: string; icon: LucideIcon; tone: PillTone }
> = {
  active: { label: "Đang hoạt động", icon: UserCheck, tone: "available" },
  pending: { label: "Chờ duyệt", icon: Clock, tone: "held" },
  suspended: { label: "Tạm khoá", icon: Lock, tone: "onloan" },
  left: { label: "Đã rời", icon: LogOut, tone: "retired" },
  rejected: { label: "Đã từ chối", icon: CircleX, tone: "overdue" },
};

/**
 * The `?trang-thai=` values the readers list accepts, and the status each names.
 *
 * The URL is in Vietnamese because every other filter in this application's URLs
 * is (`?the-loai=`, `?sap-xep=ten`), and the database's enum is in English
 * because that is what the column holds. This map is the one place the two meet,
 * so a hand-typed `?trang-thai=deleted` resolves to `undefined` and the page
 * shows every reader rather than handing an unknown string to a
 * `::membership_status` cast — which is a raw `22P02`, the bare 500 OPS §2
 * forbids.
 */
export const STATUS_PARAM: Record<string, MembershipStatus> = {
  "dang-hoat-dong": "active",
  "cho-duyet": "pending",
  "tam-khoa": "suspended",
  "da-roi": "left",
  "da-tu-choi": "rejected",
};

/**
 * `?trang-thai=` → a status, or `undefined` for anything else.
 *
 * `Object.hasOwn`, never `in` — `src/lib/search-params.ts`'s `refusalFrom`
 * carries the long version, and this map is reachable by the same route: an
 * address bar. `"constructor" in STATUS_PARAM` is `true`, and the lookup then
 * returns a *function*, which would be interpolated into SQL as `[object
 * Object]`-ish nonsense rather than refused.
 */
export function statusFromParam(
  raw: string | undefined,
): MembershipStatus | undefined {
  if (raw === undefined) return undefined;
  return Object.hasOwn(STATUS_PARAM, raw) ? STATUS_PARAM[raw] : undefined;
}
