import {
  actionsInGroup,
  type AuditFacts,
  type AuditGroup,
} from "../../kernel/audit-actions";
import type { TenantContext } from "../../kernel/tenant";
import type { Tx } from "../../kernel/unit-of-work";
import { requireManager } from "../../members/policy";

/**
 * One entry, as the browser renders it.
 *
 * `facts` is exactly what `auditSentence` needs and nothing more, so the page
 * cannot accidentally build a sentence out of something this query happened to
 * select. `action`, `entityType`, `entityId`, `before` and `after` are here for
 * the expansion — BR §14's "raw before/after values available on expansion" —
 * and are the **stored** values, never a re-derivation (P1 §3.2).
 */
export interface AuditEntryRow {
  /** `audit_log.id`, as text: it is a `bigint` and `Number` is not wide enough. */
  id: string;
  /** The stored action name. Rendered only inside the expansion, never as a sentence. */
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  facts: AuditFacts;
}

export interface AuditLogInput {
  /** `audit_log.actor_id`. Shape-checked by the caller; RLS decides what it may name. */
  actorId?: string;
  group?: AuditGroup;
  /** `YYYY-MM-DD`, inclusive, read in the application timezone. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditLogPage {
  rows: AuditEntryRow[];
  page: number;
  pageCount: number;
  total: number;
}

/** Who has written an entry on this shelf — the "manager A" of BR §14's headline. */
export interface AuditActorOption {
  userId: string;
  name: string;
  entries: number;
}

/** §4 of the requirements. The same constant `kernel/clock.ts` fixes. */
const TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * OPS §3.3's `GetAuditLog` (shelf-scoped) — "this shelf's audit trail",
 * `manager`, filterable by actor, action type and date range.
 *
 * **Scoping is RLS's, and there is no `where bookshelf_id` here.** `audit_log`
 * carries a tenant policy (`0010_rls.sql:64` names it in the loop), so a row
 * belonging to another shelf is not visible inside the transaction `runQuery`
 * opened — and a null-`bookshelf_id` global row is invisible too, in both
 * directions, because `null = x` is never true (BR §13.2 makes cross-shelf
 * audit visibility a `super_admin` permission, and that browser is B4's).
 * `requireManager` is the other half: BR §13.3, the interface hiding a page is
 * never the security control.
 *
 * **The join is what scopes `users`, never a caller-supplied id.** `users`
 * carries no RLS at all — `0010_rls.sql` deliberately leaves it, `categories`
 * and `schema_migrations` out of the policy loop — so a query that took a user
 * id from a URL and selected against it would read any account in the
 * deployment. Every id joined below comes off an `audit_log` row RLS has
 * already admitted, or off a `memberships` row that carries its own policy.
 * `input.actorId` is only ever a `where actor_id = …` **filter** on rows that
 * were already visible; it never widens what is selected, which is why a
 * manager of Đồng Tháp passing Vĩnh Long's manager's id gets an empty page
 * rather than Vĩnh Long's history.
 *
 * **`deleted_at` is deliberately *not* filtered on `users` here**, unlike
 * `page-data.ts`'s `viewerFor` and every list query in this codebase. A soft
 * deleted person's name disappearing from the audit trail would be the log
 * quietly rewriting itself — INV-12 makes these rows immutable precisely so
 * that "who did this" keeps its answer, and a name that renders as "Hệ thống"
 * because somebody left the parish is that guarantee failing silently.
 *
 * **The order is `occurred_at desc, id desc`, and the second key is load
 * bearing.** `occurred_at` is not unique and the ties are not incidental:
 * `toRow` stamps `ctx.clock.now()` per entry (`kernel/audit.ts`) and `runAs`
 * inserts a command's entries in one loop, so `addCopies` writes one row per
 * copy at one instant — thirty rows sharing a timestamp is the ordinary case,
 * not the corner. `limit`/`offset` over a non-total order repeats some rows
 * across pages and skips others: U2 measured 304 titles collapsing to 229
 * distinct on the catalogue, and U3 found 5-7 readers lost per walk at
 * pageSize 7. `audit_log.id` is a `bigint generated always as identity`
 * (`0007:23`), so it cannot tie, and it descends with the timestamp so the two
 * keys never disagree about which entry is newer.
 *
 * **What makes "what has manager A been doing" fast** (BR §14's headline
 * requirement, and OPS §3.3's row for this operation). `audit_log_actor on
 * (actor_id, occurred_at desc)` shipped with the table in 0007, and it is
 * exactly this filter's index: `where actor_id = …` plus `order by occurred_at
 * desc` is one range scan in index order with no sort. The unfiltered browser
 * rides `audit_log_shelf on (bookshelf_id, occurred_at desc)` the same way. The
 * two filters with *no* index — the group and the date range — narrow rows the
 * chosen index already produced, and they are stated here rather than
 * discovered later: neither is the headline requirement, and adding an index
 * per filter to a table that only ever grows is a cost paid on every write.
 *
 * **Unpaged is not an option here and paged is not a hedge.** `audit_log` is
 * append-only and never pruned (INV-12), so it is the one table in this system
 * whose size has no ceiling at all — a shelf's catalogue stops growing, its
 * history does not.
 *
 * **A page past the end answers `{ rows: [], total: 0, pageCount: 1 }`, and
 * that strands the reader.** `total` is read off `rows[0]`, so an empty page
 * carries no count, the screen renders its empty state and hides the pager
 * behind `pageCount > 1` — no control left to get back with. It is not this
 * query's defect to fix: `get-readers-list.ts`, `get-catalogue.ts` and
 * `get-books-list.ts` are identical, and fixing one would leave four paged
 * screens disagreeing about the same URL. The whole finding, and the two
 * possible fixes, are written down at `pageNumber` in `src/lib/search-params.ts`
 * — where every one of those page numbers is parsed.
 */
export async function getAuditLog(
  tx: Tx,
  ctx: TenantContext,
  input: AuditLogInput,
): Promise<AuditLogPage> {
  requireManager(ctx);

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));

  // The group becomes the list of action names it holds, discovered from the
  // one map that owns them (`kernel/audit-actions.ts`) rather than from a
  // `like 'loan.%'` pattern here. A pattern would be a second, weaker copy of
  // the partition — and `loan.*` and `request.*` are one family to a
  // volunteer, which no prefix can express.
  const actions = input.group ? actionsInGroup(input.group) : null;

  const rows = await tx<
    {
      id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      occurred_at: string;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      actor_name: string | null;
      subject_name: string | null;
      total_count: number;
    }[]
  >`
    select
      a.id::text as id,
      a.action, a.entity_type, a.entity_id,
      a.occurred_at::text as occurred_at,
      a.before, a.after,
      actor.full_name as actor_name,
      -- The subject, resolved from an id the row itself holds and in this
      -- order of preference. entity_id first, because it is the thing the
      -- entry is *about*; the payload's borrower second, because a loan's
      -- entity is the loan and the person is inside it. Nothing else is
      -- consulted -- no title, no category, no unit name is ever looked up
      -- from today's rows (P1 §3.2a).
      coalesce(subject_user.full_name, subject_member.full_name,
               payload_user.full_name) as subject_name,
      -- Computed over the full filtered set: a window function runs before
      -- LIMIT, which is what makes one statement answer both questions.
      count(*) over ()::int as total_count
    from audit_log a
    -- No deleted_at is null on any of these four, deliberately -- see this
    -- function's docstring. An audit row keeps its answer.
    left join users actor on actor.id = a.actor_id
    left join users subject_user
           on a.entity_type = 'user' and subject_user.id = a.entity_id
    -- memberships carries its own tenant policy, so this reaches only this
    -- shelf's rows even though users above reaches any row it is handed.
    left join memberships m
           on a.entity_type = 'membership' and m.id = a.entity_id
    left join users subject_member on subject_member.id = m.user_id
    -- A uuid stored inside a jsonb payload. The regex is not decoration: the
    -- value is whatever a command serialised, and a bare ::uuid on a
    -- non-uuid string is a raw 22P02 from inside the transaction, which is the
    -- unstructured exception OPS §2 forbids.
    left join users payload_user
           on payload_user.id = (
             case when a.after->>'borrower_id' ~
                    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then (a.after->>'borrower_id')::uuid
                  when a.after->>'userId' ~
                    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                  then (a.after->>'userId')::uuid
             end
           )
    where (${input.actorId ?? null}::uuid is null or a.actor_id = ${input.actorId ?? null})
      and (${actions === null}::boolean or a.action = any(${actions ?? []}))
      -- Compared against a timestamptz bound rather than by casting every row
      -- to a date, so the comparison can still use audit_log_shelf /
      -- audit_log_actor. + 1 on the upper bound with a strict < is what makes
      -- the range inclusive of the whole of the last day.
      --
      -- **::timestamp is load bearing and was measured.** Written as
      -- date at time zone 'Asia/Ho_Chi_Minh', Postgres resolves the *other*
      -- overload: a date casts implicitly to timestamptz using the session
      -- TimeZone (UTC here -- compose.yaml pins it), and
      -- timestamptz AT TIME ZONE returns a bare timestamp, so the bound came
      -- back as 2026-08-03 07:00 rather than the instant 2026-08-02 17:00Z
      -- that day begins at. Seven hours out, in the direction that drops the
      -- first seven hours of every range -- verified with pg_typeof on both
      -- spellings. The explicit ::timestamp selects
      -- timestamp AT TIME ZONE zone -> timestamptz, which is the intended one.
      and (${input.from ?? null}::date is null
           or a.occurred_at >= (${input.from ?? null}::date::timestamp at time zone ${TIMEZONE}))
      and (${input.to ?? null}::date is null
           or a.occurred_at < ((${input.to ?? null}::date + 1)::timestamp at time zone ${TIMEZONE}))
    order by a.occurred_at desc, a.id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}
  `;

  const total = rows[0]?.total_count ?? 0;

  return {
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      occurredAt: r.occurred_at,
      facts: {
        actor: r.actor_name,
        subject: r.subject_name,
        before: r.before,
        after: r.after,
      },
    })),
    page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    total,
  };
}

/**
 * Everybody who has written an entry on this shelf, most active first.
 *
 * This is what makes BR §14's headline — "answering 'what has manager A been
 * doing' is a headline requirement" — a *control* rather than a uuid a
 * volunteer would have to know. A list of the shelf's managers would be the
 * obvious alternative and it is the wrong one twice: readers write entries too
 * (`profile_change.proposed`, `user.password_changed`), and a manager who has
 * done nothing would be offered as a filter that returns an empty page.
 *
 * Ordered by count and then by folded name, with `u.id` last. `olibra_fold`
 * rather than the raw name because this cluster's collation is `C` and byte
 * order is the order: `Đ` encodes above every ASCII letter, so every Đặng and
 * Đỗ would sort after every Vũ. `u.id` is the unique tiebreak — this list is
 * not paged today, but two people with the same name and the same count is
 * exactly the case BR §5.3 says is ordinary, and an unstable order in a
 * `<select>` is a control whose options move between renders.
 *
 * Same `users` argument as `getAuditLog`: the ids come off `audit_log` rows RLS
 * has already admitted, never from the caller.
 */
export async function getAuditActors(
  tx: Tx,
  ctx: TenantContext,
): Promise<AuditActorOption[]> {
  requireManager(ctx);

  const rows = await tx<{ user_id: string; name: string; entries: number }[]>`
    select u.id as user_id, u.full_name as name, count(*)::int as entries
    from audit_log a
    join users u on u.id = a.actor_id
    group by u.id, u.full_name
    order by count(*) desc, olibra_fold(u.full_name), u.id
  `;

  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    entries: Number(r.entries),
  }));
}
