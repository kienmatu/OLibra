import { RuleViolated, ValidationFailed } from "../../kernel/errors";
import { requireIdentifiedActor } from "../../kernel/tenant";
import type { Command, Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../../catalogue/policy";
import { slugifyTitle } from "../../catalogue/policy";

/**
 * Shelf news. OPS §4.4, six commands over one table.
 *
 * **Expiry is never written by a job.** `expires_at` is compared against
 * `olibra_now()` in the reader-facing query (`../queries/get-announcements.ts`),
 * so an announcement drops out of view the moment it lapses and comes back if a
 * manager republishes it with a fresh expiry. G5, and the same shape
 * `copies_borrowable` and `loans_current` already follow.
 *
 * **`published_at` null means draft** (`0006_community.sql:37`), which is why
 * `PublishAnnouncement` is a separate command rather than an `UpdateAnnouncement`
 * that happens to set a column: OPS §4.4 gives it its own audit action and its
 * own refusal, and the shipped screen gives it its own buttons ("Đăng ngay",
 * "Đăng lại").
 *
 * **Multiple pins are allowed**, which is OPS §4.4's own reading of an open
 * question: BR §16.1 says pinned announcements come first, "most recent next",
 * implying more than one may be pinned and that they are ordered among
 * themselves. Nothing states a cap, so none is imposed. If the product owner
 * wants exactly one, that is a partial unique index and a refusal, not a change
 * to these commands' shape.
 */

export interface CreateAnnouncementInput {
  title: string;
  /** Rich body as the manager typed it. */
  body: string;
  /** Plain derivation, for excerpts and search (`0006_community.sql:35`). */
  bodyText?: string;
  pinned?: boolean;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
}

/** A slug unique within the shelf — `announcements` has `unique (bookshelf_id, slug)`. */
async function pickSlug(
  tx: Tx,
  bookshelfId: string,
  title: string,
): Promise<string> {
  const base = slugifyTitle(title);
  const taken = await tx<{ slug: string }[]>`
    select slug from announcements
     where bookshelf_id = ${bookshelfId} and slug like ${base + "%"}
  `;
  const used = new Set(taken.map((t) => t.slug));
  if (!used.has(base)) return base;
  // The same shape `pickSlug` in the catalogue uses: a numeric suffix rather
  // than a uuid, because a slug is a URL a person reads and shares.
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export const createAnnouncement: Command<
  CreateAnnouncementInput,
  { announcementId: string; slug: string }
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) {
    throw new ValidationFailed("announcement_fields_required", "title");
  }

  const slug = await pickSlug(tx, ctx.bookshelfId, title);
  // `body_text` is `not null`; when no plain derivation is supplied the rich
  // body is the honest fallback rather than an empty string, which would make a
  // published announcement unfindable by search.
  const bodyText = input.bodyText?.trim() || body;

  const [row] = await tx<{ id: string }[]>`
    insert into announcements
      (bookshelf_id, title, slug, body, body_text, is_pinned, published_at,
       expires_at, author_id)
    values
      (${ctx.bookshelfId}, ${title}, ${slug}, ${body}, ${bodyText},
       ${input.pinned ?? false}, ${input.publishedAt ?? null},
       ${input.expiresAt ?? null}, ${ctx.actor.userId})
    returning id
  `;

  return {
    result: { announcementId: row.id, slug },
    audit: {
      action: "announcement.created",
      entityType: "announcement",
      entityId: row.id,
      before: null,
      after: { title, slug, published: input.publishedAt != null },
    },
  };
};

/** Reads an announcement in this shelf. RLS scopes it; `null` means no such row here. */
async function announcement(
  tx: Tx,
  id: string,
): Promise<{
  id: string;
  title: string;
  is_pinned: boolean;
  published_at: Date | null;
  expires_at: Date | null;
} | null> {
  const [row] = await tx<
    {
      id: string;
      title: string;
      is_pinned: boolean;
      published_at: Date | null;
      expires_at: Date | null;
    }[]
  >`
    select id, title, is_pinned, published_at, expires_at from announcements
     where id = ${id} and deleted_at is null
  `;
  return row ?? null;
}

export const updateAnnouncement: Command<
  { announcementId: string } & Partial<CreateAnnouncementInput>,
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const existing = await announcement(tx, input.announcementId);
  if (!existing) throw new RuleViolated("write_target_not_found");

  const title = input.title?.trim() ?? existing.title;
  const body = input.body?.trim();
  // A field that is present must be valid; a field that is absent is untouched.
  // Blanking a title is what OPS §4.4's sentence is about.
  if (!title || (input.body !== undefined && !body)) {
    throw new ValidationFailed("announcement_fields_required", "title");
  }

  // `expires_at` is decided here rather than in the statement, because it has
  // three cases and SQL can only express two: absent means leave it alone,
  // `null` means clear the expiry, and a date means set one. A `coalesce` would
  // conflate the first two and make "this announcement no longer expires"
  // unexpressible.
  const expiresAt =
    input.expiresAt !== undefined ? input.expiresAt : existing.expires_at;

  await tx`
    update announcements
       set title = ${title},
           body = coalesce(${body ?? null}, body),
           body_text = coalesce(${input.bodyText?.trim() ?? body ?? null}, body_text),
           expires_at = ${expiresAt}
     where id = ${existing.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "announcement.updated",
      entityType: "announcement",
      entityId: existing.id,
      before: { title: existing.title },
      after: { title },
    },
  };
};

export const publishAnnouncement: Command<
  { announcementId: string; publishedAt?: Date; expiresAt?: Date | null },
  void
> = async (tx, ctx, input) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);

  const existing = await announcement(tx, input.announcementId);
  if (!existing) throw new RuleViolated("write_target_not_found");
  // OPS §4.4's `already_published`. "Đăng lại" — republishing something that
  // has expired — goes through this same command, so the refusal is about a
  // *live* publication rather than about the column being non-null: an expired
  // announcement is published and lapsed, and re-publishing it is the whole
  // point of the second button.
  if (existing.published_at !== null && input.expiresAt === undefined) {
    throw new RuleViolated("already_published");
  }

  const publishedAt = input.publishedAt ?? ctx.clock.now();

  await tx`
    update announcements
       set published_at = ${publishedAt},
           expires_at = ${input.expiresAt ?? null}
     where id = ${existing.id}
  `;

  return {
    result: undefined,
    audit: {
      action: "announcement.published",
      entityType: "announcement",
      entityId: existing.id,
      before: { published_at: existing.published_at?.toISOString() ?? null },
      after: { title: existing.title, published_at: publishedAt.toISOString() },
    },
  };
};

/**
 * Pin, unpin and hide — three one-column writes over the same read.
 *
 * Written out rather than generated from a factory, and the reason is a guard
 * rather than taste: `tests/domain/kernel/audit-actions.test.ts` discovers every
 * action from `action: "…"` literals in source, and a factory that assembled the
 * name from a parameter reported three sentences with no writer. That guard is
 * right — an action name built rather than written is exactly the evasion P1's
 * review probed for — so each command names its own.
 */
export const pinAnnouncement: Command<{ announcementId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);
  const existing = await announcement(tx, input.announcementId);
  if (!existing) throw new RuleViolated("write_target_not_found");

  await tx`update announcements set is_pinned = true where id = ${existing.id}`;

  return {
    result: undefined,
    audit: {
      action: "announcement.pinned",
      entityType: "announcement",
      entityId: existing.id,
      before: { is_pinned: existing.is_pinned },
      after: { title: existing.title, is_pinned: true },
    },
  };
};

export const unpinAnnouncement: Command<{ announcementId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);
  const existing = await announcement(tx, input.announcementId);
  if (!existing) throw new RuleViolated("write_target_not_found");

  await tx`update announcements set is_pinned = false where id = ${existing.id}`;

  return {
    result: undefined,
    audit: {
      action: "announcement.unpinned",
      entityType: "announcement",
      entityId: existing.id,
      before: { is_pinned: existing.is_pinned },
      after: { title: existing.title, is_pinned: false },
    },
  };
};

/**
 * Pulls a showing announcement from public view.
 *
 * It clears `published_at`, which is what "not public" *means* in this schema —
 * there is no separate hidden flag on announcements the way there is a status on
 * comments. Returning it to draft is also what makes "Đăng lại" work afterwards.
 */
export const hideAnnouncement: Command<{ announcementId: string }, void> = async (
  tx,
  ctx,
  input,
) => {
  requireManager(ctx);
  requireIdentifiedActor(ctx);
  const existing = await announcement(tx, input.announcementId);
  if (!existing) throw new RuleViolated("write_target_not_found");

  await tx`update announcements set published_at = null where id = ${existing.id}`;

  return {
    result: undefined,
    audit: {
      action: "announcement.hidden",
      entityType: "announcement",
      entityId: existing.id,
      before: { published_at: existing.published_at?.toISOString() ?? null },
      after: { title: existing.title },
    },
  };
};
