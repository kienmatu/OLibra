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
import { contactsFromForm } from "./contacts-from-form";

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
 * `path`, plus `?loi=<code>` when there is one to report, or `?da-luu=1` when
 * `done` says this caller wants a success confirmed.
 *
 * **`&`, not always `?`, when `path` already carries a query string.**
 * `updateBookshelfProfileAction` and `updateBookshelfPolicyAction` below both
 * redirect to `` `/quan-tri/tu-sach?tu-sach=${slug}` `` since QA remediation
 * T27 (before it, the same shape with `${bookshelfId}` — see that task's own
 * note on `tu-sach/page.tsx` for why `?tu-sach=` there now names a slug), and
 * a refusal from either — `updateBookshelfSettings` throws
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
 * top would be telling a manager something the page already shows.
 * `updateBookshelfProfileAction` and `updateBookshelfPolicyAction` both pass
 * it: each is a redirect back to a destination page that can render
 * identically whether its own save just happened or the administrator merely
 * navigated back to it.
 *
 * **`done` may also be a string, not only `true`** — carried over into Task
 * 17 (2026-08-10 QA remediation) from that same review round, which flagged
 * `updateSiteContactAction` and `updateSystemDefaultsAction` below as the two
 * remaining silent saves Task 16 did not reach. Both redirect to the
 * identical `/quan-tri/cai-dat`, and a bare `?da-luu=1` there cannot say
 * *which* of its two forms just saved — the same ambiguity
 * `ACTION_DONE_PARAM`'s own docstring (`src/lib/search-params.ts`) already
 * solved for `lendCopyAction`/`receiveReturnAction` sharing one dashboard, and
 * the shape `updateBookshelfProfileAction`/`updateBookshelfPolicyAction` reuse
 * below (Fix round 2) once `/quan-tri/tu-sach` grew the identical problem: one
 * page, two forms sharing one URL.
 *
 * **`scope`, added alongside `done` in the same round, is the identical idea
 * for the *refusal* branch — `?loi=` carries no such marker on its own.** A
 * page with two independently-submittable forms needs to know not only that
 * something failed but which form's fields the failure is about, so its
 * refusal renders beside that form rather than in one banner a person has to
 * guess the meaning of. `?tu-sach=<slug>&loi=contact_position_1_required
 * &pham-vi=ho-so` is unambiguous in a way `?loi=contact_position_1_required`
 * alone on a page with a policy form right below it is not — that field does
 * not exist on the policy form, and the refusal would otherwise sit above
 * both with no way to tell a reader which one to look at.
 */
function back(
  path: string,
  code: string | null,
  done?: true | string,
  scope?: string,
): never {
  if (code !== null) {
    const join = path.includes("?") ? "&" : "?";
    const scoped = scope ? `&pham-vi=${scope}` : "";
    redirect(`${path}${join}${ACTION_ERROR_PARAM}=${code}${scoped}`);
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

/**
 * QA remediation T27: carried alongside a form's `bookshelfId` purely to
 * redirect back to the right editor — `?tu-sach=` on `/quan-tri/tu-sach`
 * names a slug now, not the shelf's id (see that page's own docstring). The
 * slug is immutable (`20260808_02_bookshelf_slug_immutable.sql`) and
 * `updateBookshelfSettings` cannot change it, so it is exactly as safe to
 * trust here as `bookshelfId` itself already was — a refusal still redirects
 * to the same shelf's editor because nothing about *which* shelf this is
 * could have changed between the form loading and the action running. Shared
 * by both actions below, which is why it is pulled out rather than repeated.
 */
function slugTarget(form: FormData): string {
  return `/quan-tri/tu-sach?tu-sach=${encodeURIComponent(field(form, "tu-sach-slug"))}`;
}

/**
 * Fix round 2: the shelf's identity and its three contact blocks, split out
 * of the single all-fields form `/quan-tri/tu-sach` used to post
 * (`updateBookshelfSettingsAction`, before this split). `UpdateBookshelf
 * SettingsInput.profile` was already optional — the domain command never
 * required a policy change to carry a profile, and never required a profile
 * change to carry a policy — so this and `updateBookshelfPolicyAction` below
 * are two independent submits over the one command, not two new commands.
 *
 * **Why the split exists at all.** Contact 1 is mandatory
 * (`contact_position_1_required`, the command's own rule). Before this split,
 * a shelf the migration deliberately left with zero contacts — "inventing a
 * volunteer is worse than an incomplete record", the migration's own
 * argument — could not change so much as its loan period without a super
 * admin first naming somebody, because the one `<form>` covering both
 * sections meant every save carried a `profile`, contacts included. This form
 * carries the contacts and the rule that binds them; `updateBookshelfPolicy
 * Action` carries none of it, ever.
 */
export async function updateBookshelfProfileAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
  const code = await attempt(() =>
    submitAdminCommand(
      updateBookshelfSettings,
      {
        bookshelfId,
        profile: {
          name: field(form, "ten"),
          location: optional(form, "dia-diem"),
          address: optional(form, "dia-chi"),
          contacts: contactsFromForm(form),
        },
      },
      bookshelfId,
    ),
  );
  // "ho-so" both as the done-value (QA remediation Task 16's pattern) and as
  // the refusal scope (this round's `back()` addition) — the same string
  // either way, so the page reads one query param to know which form a
  // result belongs to regardless of whether it succeeded or was refused.
  back(slugTarget(form), code, "ho-so", "ho-so");
}

/**
 * Fix round 2: the six lending-policy numbers and the two comment toggles,
 * split out of the same form `updateBookshelfProfileAction`'s own docstring
 * describes. **Never sends `profile`** — that is the whole point of the
 * split, not an incidental omission: a shelf with no contacts at all can
 * still change how long a book may be borrowed, because this submit carries
 * nothing `contact_position_1_required` has any opinion about.
 */
export async function updateBookshelfPolicyAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
  const code = await attempt(() =>
    submitAdminCommand(
      updateBookshelfSettings,
      {
        bookshelfId,
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
  back(slugTarget(form), code, "chinh-sach", "chinh-sach");
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
  // `updateBookshelfProfileAction`/`updateBookshelfPolicyAction` above already
  // use for their own targets; `back`'s docstring is where the `?`-collision
  // this could have repeated is recorded and fixed.
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
