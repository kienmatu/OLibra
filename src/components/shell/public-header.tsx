import Link from "next/link";
import { Book, LogOut, Menu, Search } from "lucide-react";
// Relative, not the `@/` alias: this file is exercised by
// `tests/components/public-header.test.tsx`, and `vitest.config.ts` has no
// `resolve.alias` for `@/` (deliberately, per the branch's QA-remediation
// constraints — `reader-tabs.tsx` carries the identical note for the
// identical reason). An alias import here would make the component
// unimportable under Vitest, not just untested.
import { ButtonLink } from "../ui/button";
import { Input } from "../ui/field";
import { signOutAction } from "../../app/dang-nhap/actions";

/**
 * The last word of a Vietnamese name is the given name — "Maria Nguyễn Thị
 * Lan" initials as **L**, not M. `SignedInIdentity` and `MobileMenu`'s
 * profile block both need exactly this rule; factored here rather than
 * written a third time.
 */
function initialOf(name: string): string {
  return name.split(" ").at(-1)?.charAt(0) ?? "";
}

/**
 * Below 768px the nav collapses to a hamburger — an avatar once a viewer is
 * known (DESIGN.md §Navigation). Built on <details>/<summary> so it works
 * without client JavaScript — these pages are otherwise entirely static
 * server components.
 *
 * **`viewerName` and `profileHref` are optional, and that is `FrontDoorHeader`'s
 * doing.** It renders this same menu for a signed-in visitor who belongs to no
 * shelf — a super admin, a reader whose registration is still pending — who
 * therefore has no shelf profile page to send them to. When either prop is
 * absent the panel falls back to the plain hamburger and carries no profile
 * block, rather than `FrontDoorHeader` inventing a link to a page that does
 * not exist for that visitor. `ShelfHeader` below always has both, because a
 * signed-in reader on a shelf always has a shelf and a profile page on it.
 */
function MobileMenu({
  links,
  trailing,
  viewerName,
  profileHref,
}: {
  links: readonly { href: string; label: string; key: string }[];
  trailing?: { action: (formData: FormData) => Promise<void>; label: string };
  viewerName?: string;
  profileHref?: string;
}) {
  const hasProfile = viewerName !== undefined && profileHref !== undefined;
  return (
    <details className="relative md:hidden [&_svg]:open:rotate-90">
      <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-control hover:bg-surface [&::-webkit-details-marker]:hidden">
        <span className="sr-only">Mở menu</span>
        {hasProfile ? (
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-full bg-surface text-[14px] font-semibold text-leather"
          >
            {initialOf(viewerName)}
          </span>
        ) : (
          <Menu
            aria-hidden
            className="size-6 transition-transform duration-150"
            strokeWidth={1.75}
          />
        )}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-56 rounded-card border border-hairline bg-surface p-2">
        {hasProfile ? (
          <>
            <Link
              href={profileHref}
              className="flex min-h-11 items-center gap-3 rounded-control px-3 py-2 hover:bg-paper"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper text-[15px] font-semibold text-leather"
              >
                {initialOf(viewerName)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">
                  {viewerName}
                </span>
                <span className="block text-[14px] text-meta">Trang của tôi</span>
              </span>
            </Link>
            <span aria-hidden className="my-2 block h-px bg-hairline" />
          </>
        ) : null}
        {links.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            className="flex min-h-11 items-center rounded-control px-3 text-[15px] hover:bg-paper"
          >
            {link.label}
          </Link>
        ))}
        {trailing ? (
          <form action={trailing.action}>
            <button
              type="submit"
              className="mt-1 flex min-h-11 w-full items-center rounded-control border border-hairline px-3 text-left text-[15px] font-semibold hover:bg-paper"
            >
              {trailing.label}
            </button>
          </form>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The signed-in cluster this file's two headers both end with: an avatar
 * initial, the visitor's name, and the way out.
 *
 * `ShelfHeader` had all three first (U2 §3.1); `FrontDoorHeader` needs the
 * identical three for the identical reason (Task 6, 2026-08-10 QA
 * remediation) rather than a second header that merely looks the same — a
 * reworded "Đăng xuất" `aria-label` or a changed avatar rule would otherwise
 * have two call sites to find, and a diff that updated only one would compile
 * and look inconsistent nowhere in the type system.
 *
 * Posts through `signOutAction`, the same form `ManagerShell` posts through
 * on the manager and admin shells: one mechanism ends a session everywhere it
 * can be ended, rather than three headers each trusting their own copy to
 * agree with the other two.
 */
function SignedInIdentity({ name }: { name: string }) {
  return (
    <>
      <span className="flex items-center gap-2 text-[15px]">
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-surface text-[14px] font-semibold text-leather"
        >
          {initialOf(name)}
        </span>
        <span className="max-w-40 truncate">{name}</span>
      </span>
      <form action={signOutAction} className="ml-1 flex">
        <button
          type="submit"
          aria-label="Đăng xuất"
          className="inline-flex size-11 items-center justify-center rounded-control text-meta hover:text-ink"
        >
          <LogOut aria-hidden className="size-5" strokeWidth={1.75} />
        </button>
      </form>
    </>
  );
}

/**
 * The header for a shelf.
 *
 * A bookshelf is no longer public (§1.2) — everything behind this header
 * requires a membership of *this* shelf — so on a shelf page it carries the
 * signed-in reader rather than a "Đăng nhập" button. There is no shelf
 * switcher: a reader belongs to one shelf, and seeing another parish's name
 * here would only raise a question the product does not answer.
 *
 * **`viewerName` is required and nullable, and both halves are deliberate.**
 *
 * This shipped with `reader = "Giuse Trần Minh"` — a default, imported
 * alongside a fixture `Shelf` — so every shelf page in the app rendered real
 * books under a stranger's name, which reads as working and is not. A *default*
 * is what made that survive: a page that never thought about identity got a
 * plausible one for free. With no default, wiring a page is a compile error
 * until somebody answers the question, which is the property worth having while
 * forty-one pages are still to be wired. `src/lib/page-data.ts`'s `Viewer`
 * carries the answer — see `viewerFor` there for why the name is resolved in
 * the seam and not here.
 *
 * The type is a plain `string | null` rather than that module's `Viewer`
 * *on purpose*: `tests/architecture/pages-reading-the-database-are-dynamic.ts`
 * walks import specifiers as text, so `import type { Viewer } from
 * "@/lib/page-data"` in this file would make every page that renders any header
 * in it — the landing page and the two auth forms included — count as reaching
 * Postgres, and the guard would then demand `force-dynamic` on pages that issue
 * no SQL at all.
 *
 * **Null is a real case, not a fallback.** This same header renders on
 * `/dang-nhap` and `/dang-ky`, where there is no member by definition. Those
 * get the front door's "Đăng nhập" button and *no member navigation*: Danh mục,
 * Thông báo, Tìm kiếm and Trang của tôi all require a membership (§1.2), so
 * offering them to somebody who is looking at a sign-in form is chrome that
 * cannot do what it says. The shelf's name stays, because a shelf's existence
 * is public — that is what `bookshelves_public_read` is for, and it is how a
 * visitor arriving from the portal knows which parish they are signing in to.
 */
export function ShelfHeader({
  shelfName,
  shelfSlug,
  active,
  viewerName,
  unreadNotifications = 0,
  canManage,
  isSuperAdmin,
}: {
  shelfName: string;
  shelfSlug: string;
  // `"danh-muc"` stays in the union though no link below carries that key any
  // more (PO feedback round 1, Task 5 — Task 4 gave the shelf home a single
  // catalogue link, so this nav no longer needs a second one). `/danh-muc`
  // still passes `active="danh-muc"`, and removing the value would be a
  // compile error on that page for no gain; it now simply lights up nothing,
  // same as any other page whose `active` matches no remaining link.
  active?: "danh-muc" | "thong-bao" | "thong-bao-cua-toi" | "tim-kiem" | "toi";
  viewerName: string | null;
  /**
   * BR §15's bell count, from the `Viewer` the seam resolves. Defaulting to 0
   * rather than making it required is deliberate: every unwired page still
   * renders this header, and a required prop would force each of them to pass
   * a number it has no way to know — which is how a fixture number gets
   * invented. Absent means no badge, which is the honest rendering for a page
   * that has not asked.
   */
  unreadNotifications?: number;
  /**
   * **Required, no default** — the same argument this file's own docstrings
   * already make twice over (`ShelfHeader`'s own `viewerName` above,
   * `FrontDoorHeader`'s `viewerName`/`isSuperAdmin`): a default lets a page
   * that never thought about who is asking render a plausible header anyway,
   * which is exactly the defect that put "Đăng nhập" in front of a signed-in
   * super admin before Task 6. `canManage` and `isSuperAdmin` decide whether a
   * link into `/quan-ly` or `/quan-tri` appears at all, so a caller that
   * cannot answer must be made to answer, not quietly get "no".
   *
   * Resolved by each page from the `Viewer` its own `loadPage` call already
   * returns — `atLeast(viewer.role, "manager")` for this one — never compared
   * here, which is why this file takes a plain `boolean` rather than a `Role`
   * it would have to rank itself.
   */
  canManage: boolean;
  /** See `canManage` just above; `atLeast(viewer.role, "super_admin")`. */
  isSuperAdmin: boolean;
}) {
  const base = `/tu-sach/${shelfSlug}`;
  // Every link below points at a wired page that reads the database — U2
  // shipped "Thông báo" and "Trang của tôi" pointing at `src/lib/fixtures.ts`
  // instead, so a real member saw another parish's notices and a stranger's
  // borrowing history under their own real name (fix-report,
  // 2026-08-09-u2-shelf-and-portal, "IMPORTANT 4"); both were pulled until
  // their pages were wired and are back now, and
  // `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` is what
  // would catch that regressing again.
  //
  // No "Danh mục" entry (PO feedback round 1, Task 5): the shelf home
  // (`(doc-gia)/page.tsx`) now carries the one link into the catalogue, and a
  // second one here was a second door to the same room.
  const links = [
    {
      href: `${base}/thong-bao`,
      label: "Bản tin",
      key: "thong-bao",
      icon: false,
    },
    {
      href: `${base}/ho-so/tong-quan`,
      label: "Trang của tôi",
      key: "toi",
      icon: false,
    },
    {
      href: `${base}/ho-so/thong-bao`,
      // BR §15: "surfaced as a bell with an unread count". The count is in the
      // label rather than in a superscript badge because this nav is text at
      // every width, and a number a child can read beats a dot they cannot.
      label:
        unreadNotifications > 0
          ? `Thông báo (${unreadNotifications})`
          : "Thông báo",
      // `"thong-bao-cua-toi"`, not `"thong-bao"` — the latter is "Bản tin"'s
      // key above. Both were `"thong-bao"` until task 9 (2026-08-10 QA
      // remediation): React logged "Encountered two children with the same
      // key" on every reader page, and because `active === link.key` matches
      // by key rather than by array position, a page passing
      // `active="thong-bao"` (Bản tin's own page) lit up *both* links, while
      // `/ho-so/thong-bao` — which already passed the `active` union's other
      // declared value, `"thong-bao-cua-toi"` — matched neither and left the
      // whole top nav dark. `tests/components/public-header.test.tsx` pins
      // both failure modes.
      key: "thong-bao-cua-toi",
      icon: false,
    },
    { href: `${base}/tim-kiem`, label: "Tìm kiếm", key: "tim-kiem", icon: true },
  ] as const;

  // The two links this shelf's managers and the system's super admins get,
  // built the way `FrontDoorHeader`'s own conditional `/quan-tri` entry is
  // built above it. Plain links, not `ButtonLink`s — this nav already keeps
  // one primary action per screen free of a second terracotta accent, the
  // same restraint `FrontDoorHeader`'s docstring argues for its own admin
  // link.
  const managementLinks = [
    ...(canManage
      ? [{ href: `${base}/quan-ly`, label: "Quản lý tủ sách", key: "quan-ly" }]
      : []),
    ...(isSuperAdmin
      ? [{ href: "/quan-tri", label: "Quản trị hệ thống", key: "quan-tri" }]
      : []),
  ];

  // The shelf's own name links to the shelf home, which a signed-out visitor
  // cannot reach — `loadPage` would send them straight back to sign in. So for
  // them it is text, not a dead link that quietly bounces.
  const title = viewerName ? (
    <Link href={base} className="min-w-0 truncate text-lg font-semibold">
      {shelfName}
    </Link>
  ) : (
    <span className="min-w-0 truncate text-lg font-semibold">{shelfName}</span>
  );

  /**
   * The way back to the site (U6 §5).
   *
   * This header had no link to `/` at all, which made OLibra itself
   * unreachable from every reader page — the shelf name is a link to the
   * *shelf*, and there was nothing above it. `ManagerShell`'s sidebar has read
   * "OLibra" over the shelf's name since it was written; this is the same
   * arrangement, so the two chromes agree about which of the two is the site
   * and which is the parish.
   *
   * Rendered for a signed-out visitor too, unlike the shelf link beside it:
   * `/dang-nhap` and `/dang-ky` render this header with `viewerName={null}`,
   * and somebody looking at a sign-in form is precisely who may want to go
   * back to where they came from. `/` needs no session.
   *
   * **A mark, not the word.** This shipped as the text "OLibra" stacked above
   * the shelf name, then as "OLibra › Tủ sách Đồng Tháp" — and in a header
   * whose entire job is to say *which parish's shelf you are looking at*, the
   * product's own name competing for that line is noise. The icon says "home"
   * and gets out of the way of the name that matters.
   *
   * `Book` plain, and the choice is narrower than it looks: `BookOpen` and
   * `BookMarked` are two of `src/lib/status.ts`'s six copy states, so either
   * would put a status icon in the chrome meaning something else entirely, and
   * `Library` already means *a shelf* in this application (the portal's
   * "Tủ sách của bạn" pill, `ManagerShell`'s own shelf link) — directly beside
   * a shelf's name it would read as decoration of that name rather than as a
   * way out of it.
   *
   * **`size-11` is the tap target** (44px, AGENTS.md rule 4), with `gap-3`
   * clearing the 8px minimum from the shelf link beside it. The stacked version
   * this replaces failed both: two destinations flush together, neither taller
   * than ~16px, in a 64px header that cannot hold two 44px targets stacked.
   *
   * The name is carried by `sr-only` text rather than an `aria-label`, so an
   * icon-only link still announces itself and still reads as text to anything
   * that walks the markup — `MobileMenu`'s own "Mở menu" does the same.
   */
  const heading = (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        href="/"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-leather hover:bg-surface hover:text-ink"
      >
        <span className="sr-only">OLibra — trang chủ</span>
        <Book aria-hidden className="size-6" strokeWidth={1.75} />
      </Link>
      {title}
    </div>
  );

  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6">
        {heading}

        {viewerName === null ? (
          <nav className="flex items-center gap-1">
            <ButtonLink href="/dang-nhap" size="sm">
              Đăng nhập
            </ButtonLink>
          </nav>
        ) : (
          <>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className={
                    "inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-[15px] " +
                    (active === link.key
                      ? "font-semibold text-terracotta-ink"
                      : "text-ink hover:text-terracotta-ink")
                  }
                >
                  {link.icon ? (
                    <Search
                      aria-hidden
                      className="size-[18px]"
                      strokeWidth={1.75}
                    />
                  ) : null}
                  {link.label}
                </Link>
              ))}

              {managementLinks.length > 0 ? (
                <>
                  <span aria-hidden className="mx-2 h-6 w-px bg-hairline" />
                  {managementLinks.map((link) => (
                    <Link
                      key={link.key}
                      href={link.href}
                      className="inline-flex min-h-11 items-center rounded-control px-3 text-[15px] text-ink hover:text-terracotta-ink"
                    >
                      {link.label}
                    </Link>
                  ))}
                </>
              ) : null}

              <span aria-hidden className="mx-2 h-6 w-px bg-hairline" />

              <SignedInIdentity name={viewerName} />
            </nav>

            <MobileMenu
              links={links}
              trailing={{ action: signOutAction, label: "Đăng xuất" }}
              viewerName={viewerName}
              profileHref={`${base}/ho-so/tong-quan`}
            />
          </>
        )}
      </div>

      {/* Mobile search — below `md` only, and only for a signed-in reader:
          `tim-kiem` is member navigation exactly as "Bản tin" and "Trang của
          tôi" are (this header's own docstring on why a signed-out visitor
          gets none of them). The desktop nav above already carries "Tìm
          kiếm" as a link; below `md` that link is inside the collapsed
          `MobileMenu`, a tap further away than BR:519's own search deserves,
          so this row puts the box itself where a thumb already is.
          `text-[16px]` on the input is deliberate: iOS Safari zooms the
          viewport on focus for anything smaller — confirmed the same way
          `Field`'s own `CONTROL` constant already sets it. */}
      {viewerName !== null ? (
        <form
          method="get"
          action={`${base}/tim-kiem`}
          className="mx-auto flex max-w-6xl items-center gap-2 px-6 pb-3 md:hidden"
        >
          <label htmlFor="tim-kiem-tren-thanh" className="sr-only">
            Tìm sách trong tủ
          </label>
          <Input
            id="tim-kiem-tren-thanh"
            name="q"
            type="search"
            placeholder="Tìm sách trong tủ"
            className="flex-1"
          />
          <button
            type="submit"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-leather hover:bg-surface"
          >
            <span className="sr-only">Tìm</span>
            <Search aria-hidden className="size-5" strokeWidth={1.75} />
          </button>
        </form>
      ) : null}
    </header>
  );
}

/**
 * The front door. Landing, portal, contact and the two auth screens — the
 * only pages a person with no account can reach (§1.2).
 *
 * **`viewerName` and `isSuperAdmin`, required rather than optional** (Task 6,
 * 2026-08-10 QA remediation) — `ShelfHeader`'s own docstring above already
 * made this argument once and it applies here unchanged: a default lets a
 * caller that never thought about identity render a plausible one anyway,
 * which is exactly what let "Đăng nhập" sit on `/tu-sach` and `/lien-he`
 * under a signed-in super admin's own session and read as correct. A QA
 * sweep walking a fresh install as that admin found no name, no sign-out, and
 * no route into `/quan-tri` short of typing the URL by hand. `null`/`false`
 * is what a page that genuinely does not know writes about itself —
 * `/dang-nhap` and `/loi` pass it explicitly, by definition and by design
 * respectively — never a value nobody chose.
 *
 * **The admin link is the reason this changed.** A super admin belongs to no
 * shelf (`landingShelfFor`'s own docstring, `src/auth/guards.ts`), so
 * `/quan-tri` — where every one of a fresh install's first tasks lives — had
 * no link anywhere in the application. It renders as a plain nav link beside
 * "Tìm tủ sách", not a `ButtonLink`: this header's signed-in state stays free
 * of a second terracotta accent competing with whatever primary action the
 * page itself carries (`Button`'s own docstring — "one primary action per
 * screen"), the same restraint `ShelfHeader`'s member nav already keeps.
 */
export function FrontDoorHeader({
  viewerName,
  isSuperAdmin,
  shelves,
}: {
  viewerName: string | null;
  isSuperAdmin: boolean;
  /**
   * Every shelf this viewer is an active member of, from
   * `loadFrontDoorViewer` (U6 §7). **Required, and empty is a real value** —
   * the same argument the two props above make for being required and
   * nullable, and it lands the same way: an optional `shelves` lets a page
   * that never thought about membership render a header with no route to the
   * reader's own shelf, which is the exact defect this prop exists to close.
   *
   * Empty is the honest answer for a super admin (who belongs to none by
   * design), for a reader whose registration is still awaiting approval, and
   * for `/dang-nhap` and `/loi`, which know nothing about anybody.
   */
  shelves: readonly { slug: string; name: string }[];
}) {
  // Shared by the desktop `<nav>` below and by `MobileMenu` — the same
  // doubling `ShelfHeader`'s own `links` relies on. `/quan-tri` is in it only
  // for a super admin; an ordinary signed-in reader sees exactly what this
  // header showed a stranger before Task 6, plus their own name and a way to
  // sign out.
  const links = [
    /**
     * U6 §5, and it is first because it is the one link most people came for.
     *
     * A reader signed in and standing on `/lien-he` had "Tìm tủ sách" — a
     * *directory* — and no way to their own shelf. The one-shelf case links
     * straight there rather than to the portal, because a member of one shelf
     * is not making a choice; that is the same rule `landingShelfFor` applies
     * at sign-in (`src/auth/guards.ts`), applied to a link instead of a
     * redirect, and §7 is why the two read it from one function.
     *
     * A member of several goes to `/tu-sach`, which marks the shelves they
     * belong to. Nobody with no membership gets the link at all — an entry
     * pointing at a shelf that does not exist is chrome that cannot do what it
     * says, the argument `ShelfHeader` above already makes for hiding member
     * navigation from a visitor with no membership.
     */
    ...(shelves.length > 0
      ? [
          {
            href: shelves.length === 1 ? `/tu-sach/${shelves[0].slug}` : "/tu-sach",
            label: "Tủ sách của tôi",
            key: "cua-toi",
          },
        ]
      : []),
    { href: "/tu-sach", label: "Tìm tủ sách", key: "tu-sach" },
    ...(isSuperAdmin
      ? [{ href: "/quan-tri", label: "Quản trị hệ thống", key: "quan-tri" }]
      : []),
  ];

  return (
    <header className="border-b border-hairline bg-paper">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-6">
        <Link href="/" className="text-xl font-semibold">
          OLibra
        </Link>

        {viewerName === null ? (
          <nav className="flex items-center gap-1">
            <Link
              href="/tu-sach"
              className="inline-flex min-h-11 items-center rounded-control px-3 text-[15px] hover:text-terracotta-ink"
            >
              Tìm tủ sách
            </Link>
            <ButtonLink href="/dang-nhap" size="sm" className="ml-1">
              Đăng nhập
            </ButtonLink>
          </nav>
        ) : (
          <>
            <nav className="hidden items-center gap-1 md:flex">
              {links.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className="inline-flex min-h-11 items-center rounded-control px-3 text-[15px] hover:text-terracotta-ink"
                >
                  {link.label}
                </Link>
              ))}

              <span aria-hidden className="mx-2 h-6 w-px bg-hairline" />

              <SignedInIdentity name={viewerName} />
            </nav>

            <MobileMenu
              links={links}
              trailing={{ action: signOutAction, label: "Đăng xuất" }}
            />
          </>
        )}
      </div>
    </header>
  );
}

/* `FrontDoorFooter` was here, and it is `SiteFooter`
   (`src/components/shell/site-footer.tsx`) now — U6 §6. It rendered on four
   pages and carried a wordmark, two links and a copyright; its replacement
   renders on every page in the application and carries the contact details a
   super admin actually fills in. It moved to a file of its own because it
   takes a prop this one must not know how to resolve: a footer that read the
   database would put `lib/page-data` in the import closure of every page that
   renders it, `/loi` included. */
