"use server";

import { redirect } from "next/navigation";
import { RuleViolated, ValidationFailed } from "@/domain/kernel/errors";
import {
  archiveBookshelf,
  createBookshelf,
  updateBookshelfSettings,
} from "@/domain/admin/commands/bookshelves";
import {
  assignManager,
  promoteSuperAdmin,
  revokeManager,
} from "@/domain/admin/commands/managers";
import {
  updateSiteContact,
  updateSystemDefaults,
} from "@/domain/admin/commands/system-settings";
import { archiveCategory } from "@/domain/catalogue/commands/archive-category";
import { createCategory } from "@/domain/catalogue/commands/create-category";
import { renameCategory } from "@/domain/catalogue/commands/rename-category";
import { submitAdminCommand } from "@/lib/page-data";
import { ACTION_ERROR_PARAM } from "@/lib/search-params";

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

function back(path: string, code: string | null): never {
  redirect(code === null ? path : `${path}?${ACTION_ERROR_PARAM}=${code}`);
}

// ── Shelves ────────────────────────────────────────────────────────────────

export async function createBookshelfAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(createBookshelf, {
      name: field(form, "ten"),
      slug: optional(form, "dia-chi-web") ?? undefined,
      location: optional(form, "dia-diem"),
      address: optional(form, "dia-chi"),
      keeperName: optional(form, "nguoi-giu"),
      keeperPhone: optional(form, "dien-thoai"),
      openingHours: optional(form, "gio-mo-cua"),
    }),
  );
  back("/quan-tri/tu-sach", code);
}

export async function updateBookshelfSettingsAction(form: FormData): Promise<void> {
  const bookshelfId = field(form, "tu-sach");
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
          keeperName: optional(form, "nguoi-giu"),
          keeperPhone: optional(form, "dien-thoai"),
          openingHours: optional(form, "gio-mo-cua"),
        },
        loanDays: count(form, "so-ngay-muon"),
        maxConcurrentLoans: count(form, "so-sach-cung-luc"),
        maxRenewals: count(form, "so-lan-gia-han"),
        renewalDays: count(form, "so-ngay-gia-han"),
        holdDays: count(form, "so-ngay-giu-cho"),
        commentsEnabled: form.has("cho-binh-luan"),
        commentsRequireApproval: form.has("binh-luan-can-duyet"),
      },
      bookshelfId,
    ),
  );
  back(`/quan-tri/tu-sach?tu-sach=${bookshelfId}`, code);
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
  back("/quan-tri/quan-ly-vien", code);
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

export async function updateSiteContactAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(updateSiteContact, {
      contactName: optional(form, "ten-lien-he"),
      contactPhone: optional(form, "dien-thoai"),
      contactHours: optional(form, "gio-lien-he"),
    }),
  );
  back("/quan-tri/cai-dat", code);
}

export async function updateSystemDefaultsAction(form: FormData): Promise<void> {
  const code = await attempt(() =>
    submitAdminCommand(updateSystemDefaults, {
      // `?? 0` rather than a default: an empty or malformed box reaches the
      // command's own `< 1` refusal, which is the sentence a person reads.
      // Substituting 14 here would silently accept a form nobody filled in.
      loanDays: count(form, "so-ngay-muon") ?? 0,
      maxConcurrentLoans: count(form, "so-sach-cung-luc") ?? 0,
      holdDays: count(form, "so-ngay-giu-cho") ?? 0,
    }),
  );
  back("/quan-tri/cai-dat", code);
}
