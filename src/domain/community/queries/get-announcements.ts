import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager, requireReader } from "../../catalogue/policy";

export interface AnnouncementRow {
  id: string;
  slug: string;
  title: string;
  body: string;
  excerpt: string;
  isPinned: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * What a member sees: published, unexpired, **pinned first, then most recent**.
 *
 * BR §16.1 gives that ordering in as many words. Pinned announcements are
 * ordered among themselves by recency, which is what settles OPS §4.4's open
 * question about a cap in the direction of "no cap" — an ordering among pins
 * only means something if more than one may exist.
 *
 * **Expiry is evaluated here, against `olibra_now()`, and never by a job.** G5.
 * An announcement lapses the instant its `expires_at` passes, with nothing
 * having run — the same rule `copies_borrowable` follows for holds and
 * `loans_current` for overdue status. `tests/domain/community/announcements
 * .test.ts` advances a `fixedClock` and watches one drop out with no write.
 *
 * `id desc` beside each timestamp because neither `published_at` nor
 * `created_at` carries a unique constraint, and this project has now measured
 * twice what an ordering without a unique tiebreak does across pages.
 */
export async function getAnnouncements(
  tx: Tx,
  ctx: TenantContext,
): Promise<AnnouncementRow[]> {
  requireReader(ctx);

  const rows = await tx<
    {
      id: string;
      slug: string;
      title: string;
      body: string;
      body_text: string;
      is_pinned: boolean;
      published_at: Date | null;
      expires_at: Date | null;
    }[]
  >`
    select id, slug, title, body, body_text, is_pinned, published_at, expires_at
      from announcements
     where deleted_at is null
       and published_at is not null
       and published_at <= olibra_now()
       and (expires_at is null or expires_at > olibra_now())
     order by is_pinned desc, published_at desc, id desc
  `;

  return rows.map(toRow);
}

/**
 * What a manager sees: everything, including drafts and lapsed announcements,
 * because managing them is exactly the job the reader-facing filter gets in the
 * way of.
 */
export async function getAllAnnouncements(
  tx: Tx,
  ctx: TenantContext,
): Promise<AnnouncementRow[]> {
  requireManager(ctx);

  const rows = await tx<
    {
      id: string;
      slug: string;
      title: string;
      body: string;
      body_text: string;
      is_pinned: boolean;
      published_at: Date | null;
      expires_at: Date | null;
    }[]
  >`
    select id, slug, title, body, body_text, is_pinned, published_at, expires_at
      from announcements
     where deleted_at is null
     order by is_pinned desc, coalesce(published_at, created_at) desc, id desc
  `;

  return rows.map(toRow);
}

function toRow(r: {
  id: string;
  slug: string;
  title: string;
  body: string;
  body_text: string;
  is_pinned: boolean;
  published_at: Date | null;
  expires_at: Date | null;
}): AnnouncementRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    body: r.body,
    // The plain derivation is what an excerpt is *for* — a rich body truncated
    // mid-tag is how a list ends up rendering half an element.
    excerpt: r.body_text.slice(0, 200),
    isPinned: r.is_pinned,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
  };
}
