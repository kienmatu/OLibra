"use server";

import { redirect } from "next/navigation";
// Relative specifiers, not the `@/` alias, for the reason `src/lib/page-data.ts`,
// `src/app/dang-nhap/actions.ts` and `src/app/tu-sach/[shelf]/quan-ly/actions.ts`
// all already record: Vitest resolves no alias, and `tests/lib/admin-actions
// .test.ts` (added in the Task 5 QA-remediation review round that found the
// `back()` defect below) imports this module directly. This file was the one
// action file in the app still on `@/`, which is exactly why no test had ever
// been able to reach it.
import { RuleViolated, ValidationFailed } from "../../domain/kernel/errors";
import {
  archiveBookshelf,
  createBookshelf,
  updateBookshelfSettings,
} from "../../domain/admin/commands/bookshelves";
import type { ShelfContact } from "../../domain/shelf/queries/get-shelf-settings";
import {
  assignManager,
  promoteSuperAdmin,
  revokeManager,
} from "../../domain/admin/commands/managers";
import {
  updateSiteContact,
  updateSystemDefaults,
} from "../../domain/admin/commands/system-settings";
import { archiveCategory } from "../../domain/catalogue/commands/archive-category";
import { createCategory } from "../../domain/catalogue/commands/create-category";
import { renameCategory } from "../../domain/catalogue/commands/rename-category";
import { submitAdminCommand } from "../../lib/page-data";
import { ACTION_DONE_PARAM, ACTION_ERROR_PARAM } from "../../lib/search-params";

/**
 * OPS §4.5's writes — the administration surface's own commands.
 *
 * Same contract as every action in this codebase (U1 §3.3): a `RuleViolated` or
 * a `ValidationFailed` comes back as an `ErrorCode` the page renders through
 * `messageFor`, and anything else keeps throwing.
 *
 * **`bookshelfId` is passed to `submitAdminCommand` exactly when the audit row
 * belongs to a shelf.** `createBookshelf`, `archiveBookshelf` and
 * `promoteSuperAdmin` declare global entries — a shelf that does not exist yet,
 * one that has just left circulation, and a fact about a person — so they are
 * called with no scope. `updateBookshelfSettings`, `assignManager` and
 * `revokeManager` name a shelf, so their trace lands where that shelf's own
 * manager reads the log. `runAdminCommand` refuses either mismatch by name
 * rather than binding an empty string into a `uuid` column.
 */
async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof RuleViolated || err instanceof ValidationFailed) {
      return err.code;
    }
    throw err;
  }
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function optional(form: FormData, name: string): string | null {
  const value = field(form, name);
  return value === "" ? null : value;
}

/**
 * A whole number from a `type="number"` box, or `undefined` for an empty one.
 *
 * `undefined` is "leave this policy value alone", which is the three-case rule
 * `updateBookshelfSettings` is built around. `Number.isSafeInteger` refuses
 * `1e21` and `"12abc"` here rather than letting either reach the command as a
 * plausible-looking number — the same guard `wholeNumber` applies in the
 * manager's actions.
 */
function count(form: FormData, name: string): number | undefined {
  const raw = field(form, name);
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * The three contact blocks both shelf forms post, as the domain's list.
 *
 * A block with no name is not a contact — an empty block is how a super admin
 * says "there is no third volunteer", and a phone with nobody attached to it
 * is a number nobody can be asked for. The domain refuses a whitespace-only
 * name (`contact_name_required`) for the case where a name *was* typed and is
 * blank; this filter is for the ordinary empty block, which is not an error.
 *
 * Positions are kept, not compacted: a contact left in block 3 stays at
 * position 3, because moving them would change what the reader's accordion
 * shows without anybody asking for it.
 */
export function contactsFromForm(form: FormData): ShelfContact[] {
  return [1, 2, 3].flatMap((position) => {
    const name = (optional(form, `lien-he-${position}-ten`) ?? "").trim();
    if (name === "") return [];
    return [
      {
        position,
        name,
        phone: optional(form, `lien-he-${position}-sdt`),
        roleLabel: optional(form, `lien-he-${position}-vai-tro`),
      },
    ];
  });
}

/**
 * `path`, plus `?loi=<code>` when there is one to report, or `?da-luu=1` when
 * `done` says this caller wants a success confirmed.
 *
 * **`&`, not always `?`, when `path` already carries a query string.**
 * `updateBookshelfSettingsAction` below has redirected to
 * `` `/quan-tri/tu-sach?tu-sach=${slug}` `` since QA remediation T27 (before
 * it, the same shape with `${bookshelfId}` — see that task's own note on
 * `tu-sach/page.tsx` for why `?tu-sach=` there now names a slug), and a
 * refusal from that action — `updateBookshelfSettings` throws
 * `validation_failed` for a negative policy number, among others — used to
 * reach this function with a `path` that already had a `?` in it, producing
 * `/quan-tri/tu-sach?tu-sach=<id>?loi=<code>` (the id, not the slug — this
 * defect predates T27's rename, and it is the shape the bug actually had
 * when it was caught, which is why the id is what stays here). Nothing
 * downstream parses that as two parameters: everything after the *first*
 * `?` is one query string, so `?loi=` there is not a delimiter, it is four
 * literal characters inside the value of `tu-sach` —
 * `param(search, "tu-sach")` returns `"<id>?loi=<code>"`, which matches no
 * real shelf, and `refusalFrom` finds no `loi` key at all. The refusal
 * banner silently never rendered; the page silently fell back to the shelf
 * list. Caught in review of Task 5 (QA remediation, 2026-08-10) while giving
 * `assignManagerAction` below the identical shape (a target carrying
 * `?tu-sach=`) rather than one more caller inheriting the same defect. The
 * fix does not care whether the value is an id or a slug either way —
 * `path.includes("?")` is the same test `URL` would apply; a template
 * literal is used rather than the `URL`/`URLSearchParams` classes because
 * every path here is already a known-good relative string and `redirect()`
 * wants that string back, not a parsed object.
 *
 * **`done` is opt-in, per caller, not a blanket addition to every success
 * here** (QA remediation Task 16). `createBookshelfAction` and
 * `archiveBookshelfAction` both already land on a page that visibly changed —
 * a new row in the list, an "Đã lưu trữ" pill — so a confirmation strip on
 * top would be telling a manager something the page already shows. Only
 * `updateBookshelfSettingsAction` passes it: that is the one redirect in this
 * file whose destination page can render identically whether the save just
 * happened or the administrator merely navigated back to it.
 *
 * **`done` may also be a string, not only `true`** — carried over into Task
 * 17 (2026-08-10 QA remediation) from that same review round, which flagged
 * `updateSiteContactAction` and `updateSystemDefaultsAction` below as the two
 * remaining silent saves Task 16 did not reach. Both redirect to the
 * identical `/quan-tri/cai-dat`, which `updateBookshelfSettingsAction`'s
 * single caller never had to worry about — a bare `?da-luu=1` on that page
 * cannot say *which* of its two forms just saved, the same ambiguity
 * `ACTION_DONE_PARAM`'s own docstring (`src/lib/search-params.ts`) already
 * solved for `lendCopyAction`/`receiveReturnAction` sharing one dashboard.
 * `back(path, code, true)` still writes the bare `1` unchanged, so
 * `updateBookshelfSettingsAction` needed no edit.
 */
function back(path: string, code: string | null, done?: true | string): never {
  if (code !== null) {
    const join = path.includes("?") ? "&" : "?";
    redirect(`${path}${join}${ACTION_ERROR_PARAM}=${code}`);
  }
  if (done) {
    const join = path.includes("?") ? "&" : "?";
    const value = done === true ? "1" : done;
    redirect(`${path}${join}${ACTION_DONE_PARAM}=${value}`);
  }
  redirect(path);
}

// ── Shelves ────────────────────────────────────────────────────────────────

export async function createBookshelfAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(createBookshelf, {
      name: field(form, "ten"),
      slug: optional(form, "dia-chi-web") ?? undefined,
      location: optional(form, "dia-diem"),
      address: optional(form, "dia-chi"),
      contacts: contactsFromForm(form),
    }),
  );
  back("/quan-tri/tu-sach", code);
}

export async function updateBookshelfSettingsAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
  // QA remediation T27: carried alongside the id purely to redirect back to
  // the right editor — `?tu-sach=` on `/quan-tri/tu-sach` names a slug now,
  // not this shelf's id (see that page's own docstring). The slug is
  // immutable (`20260808_02_bookshelf_slug_immutable.sql`) and
  // `updateBookshelfSettings` cannot change it, so it is exactly as safe to
  // trust here as `bookshelfId` itself already was — a refusal below still
  // redirects to the same shelf's editor because nothing about *which* shelf
  // this is could have changed between the form loading and this action
  // running.
  const slug = field(form, "tu-sach-slug");
  const code = await attempt(() =>
    submitAdminCommand(
      updateBookshelfSettings,
      {
        bookshelfId,
        // All six together — see the command for why the profile is
        // all-or-nothing while the policy is field-by-field.
        profile: {
          name: field(form, "ten"),
          location: optional(form, "dia-diem"),
          address: optional(form, "dia-chi"),
          contacts: contactsFromForm(form),
        },
        loanDays: count(form, "so-ngay-muon"),
        maxConcurrentLoans: count(form, "so-sach-cung-luc"),
        maxRenewals: count(form, "so-lan-gia-han"),
        renewalDays: count(form, "so-ngay-gia-han"),
        holdDays: count(form, "so-ngay-giu-cho"),
        // QA remediation Task 23.
        dueSoonDays: count(form, "so-ngay-bao-truoc"),
        commentsEnabled: form.has("cho-binh-luan"),
        commentsRequireApproval: form.has("binh-luan-can-duyet"),
      },
      bookshelfId,
    ),
  );
  // QA remediation Task 16: "Lưu cài đặt" used to redirect here with nothing
  // to say the save took — the form re-rendered identically whether it had
  // just been submitted or the page was freshly opened.
  back(`/quan-tri/tu-sach?tu-sach=${encodeURIComponent(slug)}`, code, true);
}

export async function archiveBookshelfAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(archiveBookshelf, {
      bookshelfId: field(form, "tu-sach"),
    }),
  );
  back("/quan-tri/tu-sach", code);
}

// ── Categories ─────────────────────────────────────────────────────────────
//
// Task 2 (QA remediation). All three are global — `categories` has no
// `bookshelf_id` — so `submitAdminCommand` is called with no `bookshelfId`,
// exactly as `createBookshelfAction` and `promoteSuperAdminAction` are above.

export async function createCategoryAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(createCategory, { name: field(form, "ten") }),
  );
  back("/quan-tri/the-loai", code);
}

export async function renameCategoryAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(renameCategory, {
      id: field(form, "the-loai"),
      name: field(form, "ten"),
    }),
  );
  back("/quan-tri/the-loai", code);
}

export async function archiveCategoryAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(archiveCategory, { id: field(form, "the-loai") }),
  );
  back("/quan-tri/the-loai", code);
}

// ── Managers ───────────────────────────────────────────────────────────────

export async function assignManagerAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
  const role = field(form, "quyen") === "admin" ? "admin" : "manager";
  const code = await attempt(() =>
    submitAdminCommand(
      assignManager,
      { userId: field(form, "nguoi-dung"), bookshelfId, role },
      bookshelfId,
    ),
  );
  // Carries `?tu-sach=` back either way — success or refusal — so appointing
  // several readers of the same parish in a row (the realistic fresh-install
  // case `getManagerCandidates`' own docstring is about) does not make the
  // administrator re-pick the shelf after every single one. The same shape
  // `updateBookshelfSettingsAction` above already uses for its own target;
  // `back`'s docstring is where the `?`-collision this could have repeated is
  // recorded and fixed.
  back(`/quan-tri/quan-ly-vien?tu-sach=${bookshelfId}`, code);
}

export async function revokeManagerAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
  const code = await attempt(() =>
    submitAdminCommand(
      revokeManager,
      { membershipId: field(form, "thanh-vien") },
      bookshelfId,
    ),
  );
  back("/quan-tri/quan-ly-vien", code);
}

export async function promoteSuperAdminAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(promoteSuperAdmin, {
      userId: field(form, "nguoi-dung"),
    }),
  );
  back("/quan-tri/quan-ly-vien", code);
}

// ── System settings ────────────────────────────────────────────────────────
//
// Both actions below redirect to the same `/quan-tri/cai-dat`, so `back`'s
// third argument is a string rather than `true` — see `back`'s own docstring
// for why a bare `?da-luu=1` cannot say which of the page's two forms just
// saved. Carried into Task 17 (2026-08-10 QA remediation) from the review
// round that closed this gap everywhere else on this branch (`1b72545`) but
// left these two — "the two forms on `/quan-tri/cai-dat`... still redirect
// with no `done` marker" — because that task was already in this file's
// neighbourhood wiring the site-wide góp ý form.

export async function updateSiteContactAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(updateSiteContact, {
      contactName: optional(form, "ten-lien-he"),
      contactPhone: optional(form, "dien-thoai"),
      contactHours: optional(form, "gio-lien-he"),
    }),
  );
  back("/quan-tri/cai-dat", code, "lien-he");
}

export async function updateSystemDefaultsAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(updateSystemDefaults, {
      // `?? 0` rather than a default: an empty or malformed box reaches the
      // command's own `< 1` refusal, which is the sentence a person reads.
      // Substituting 14 here would silently accept a form nobody filled in.
      loanDays: count(form, "so-ngay-muon") ?? 0,
      maxConcurrentLoans: count(form, "so-sach-cung-luc") ?? 0,
      // QA remediation Task 23: the three fields below joined the three
      // above — `/quan-tri/cai-dat` used to offer only three of the six
      // per-shelf policy numbers a new shelf inherits. Same `?? 0` reasoning:
      // `max_renewals`'s own floor is 0 (`checkPolicyBound`), so an empty box
      // there reaches the command as a legitimate "no renewals", but every
      // other field's floor is 1 or higher, so an empty box for any of them
      // is refused by name rather than silently accepted.
      maxRenewals: count(form, "so-lan-gia-han") ?? 0,
      renewalDays: count(form, "so-ngay-gia-han") ?? 0,
      holdDays: count(form, "so-ngay-giu-cho") ?? 0,
      dueSoonDays: count(form, "so-ngay-bao-truoc") ?? 0,
    }),
  );
  back("/quan-tri/cai-dat", code, "mac-dinh");
}
