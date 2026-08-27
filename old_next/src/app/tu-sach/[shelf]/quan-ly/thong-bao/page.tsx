import { Archive, Eye, FileEdit, Pin, Plus, type LucideIcon } from "lucide-react";
import { Card, PageHeading } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FilterChips } from "@/components/ui/filter-chips";
import { Pill, type PillTone } from "@/components/ui/pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { ManagerShell } from "@/components/shell/manager-shell";
import { messageFor } from "@/domain/kernel/errors";
import {
  type AnnouncementState,
  getAllAnnouncements,
} from "@/domain/community/queries/get-announcements";
import { getManagerBadgeCounts } from "@/domain/shelf/queries/get-manager-dashboard";
import { formatInstant } from "@/lib/dates";
import { loadPage } from "@/lib/page-data";
import { param, refusalFrom, type SearchParams } from "@/lib/search-params";
import { readShelf } from "@/lib/shelf";
import {
  createAnnouncementAction,
  hideAnnouncementAction,
  pinAnnouncementAction,
  publishAnnouncementAction,
  unpinAnnouncementAction,
  updateAnnouncementAction,
} from "../actions";

/**
 * BR §16.1's announcements screen, for the person who writes them.
 *
 * **The state label comes from the query, not from this file.** `state` is
 * decided in SQL against `olibra_now()` (`getAllAnnouncements`), which is the
 * same comparison the reader's list makes. Working it out here from
 * `publishedAt`/`expiresAt` and `new Date()` would be a third clock: the reader
 * would stop seeing a lapsed notice while this screen still called it *Đang
 * hiện*, and no test could move either.
 *
 * **Everything happens on this page — there is no editor route.** BR §16.1's
 * screen is a list with per-card actions, and the four commands behind them
 * (`publish`, `hide`, `pin`, `unpin`) each take one id. *Viết thông báo* and
 * *Sửa* are `<details>` forms in place, the same shape the registration queue
 * uses for its required rejection reason: a second route for a title and a body
 * would put a page between a manager and a two-line notice.
 *
 * **Đăng lại carries an expiry box and Đăng ngay does not**, which is
 * `publishAnnouncement`'s own rule surfacing. It refuses a second publication
 * *only* when no new expiry is supplied — precisely so republishing a lapsed
 * notice goes through the same command rather than a second one.
 *
 * **The four chips filter now** (Task 14, 2026-08-10 QA remediation) — they
 * used to be `<span>`s, visually identical to `nguoi-doc`'s real ones and
 * inert. No new query: `getAllAnnouncements` already reads every announcement
 * on this shelf in one statement, so `?trang-thai=` narrows the array this
 * page already has rather than asking the database again — the same reason
 * `byState` below was already computing four counts from it before this task.
 * `announcementStatusFromParam` is `statusFromParam`'s shape
 * (`src/lib/membership-status.ts`) applied to `AnnouncementState`: an
 * unrecognised or absent `?trang-thai=` resolves to `undefined`, which reads
 * as "Tất cả" (every announcement, unfiltered) rather than reaching a
 * `::text` comparison that could never match a real state.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Thông báo — Quản lý tủ sách OLibra" };

const NUMBER = new Intl.NumberFormat("vi-VN");

const STATE_STYLE: Record<
  AnnouncementState,
  { label: string; icon: LucideIcon; tone: PillTone; slug: string }
> = {
  showing: { label: "Đang hiện", icon: Eye, tone: "available", slug: "dang-hien" },
  draft: { label: "Nháp", icon: FileEdit, tone: "retired", slug: "nhap" },
  expired: { label: "Hết hạn", icon: Archive, tone: "retired", slug: "het-han" },
};

/**
 * `?trang-thai=` → `AnnouncementState`, derived from `STATE_STYLE.slug` rather
 * than written a second time — two copies of this map is how the URL slug and
 * the state it names drift apart, the same failure `src/lib/search-params.ts`'s
 * `refusalFrom` warns against for a different map.
 */
const ANNOUNCEMENT_STATUS_PARAM: Record<string, AnnouncementState> =
  Object.fromEntries(
    (
      Object.entries(STATE_STYLE) as [
        AnnouncementState,
        (typeof STATE_STYLE)[AnnouncementState],
      ][]
    ).map(([state, cfg]) => [cfg.slug, state]),
  );

/**
 * `Object.hasOwn`, not `in` — `src/lib/search-params.ts`'s `refusalFrom` and
 * `src/lib/membership-status.ts`'s `statusFromParam` both carry the same
 * warning: `in` walks the prototype chain, so `?trang-thai=constructor`
 * would resolve to a *function* rather than to `undefined`.
 */
function announcementStatusFromParam(
  raw: string | undefined,
): AnnouncementState | undefined {
  if (raw === undefined) return undefined;
  return Object.hasOwn(ANNOUNCEMENT_STATUS_PARAM, raw)
    ? ANNOUNCEMENT_STATUS_PARAM[raw]
    : undefined;
}

const STATUS = "trang-thai";

/** `2026-08-14` for a `type="date"` box, or `""` — never a locale format. */
function dateInputValue(at: Date | null): string {
  if (!at) return "";
  // The expiry stored is the *end* of the chosen day (see `expiryDate` in
  // `../actions.ts`), so a day is taken back off to show what was typed.
  return new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function AnnouncementsManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ shelf: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { shelf: slug } = await params;
  const search = await searchParams;
  const refusal = refusalFrom(search);
  const statusParam = param(search, STATUS);
  const selected = announcementStatusFromParam(statusParam);

  const { shelf, viewer, counts, announcements } = await loadPage(
    slug,
    async (tx, ctx, v) => ({
      shelf: await readShelf(tx, ctx),
      viewer: v,
      counts: await getManagerBadgeCounts(tx, ctx),
      announcements: await getAllAnnouncements(tx, ctx),
    }),
  );

  const listHref = `/tu-sach/${slug}/quan-ly/thong-bao`;
  const pinnedCount = announcements.filter((a) => a.isPinned).length;
  const byState = (state: AnnouncementState) =>
    announcements.filter((a) => a.state === state).length;
  // Narrows the array `getAllAnnouncements` already read — see this page's
  // own docstring for why that is one query rather than a per-chip one.
  const visible = selected
    ? announcements.filter((a) => a.state === selected)
    : announcements;

  return (
    <ManagerShell
      shelfName={shelf.name}
      shelfSlug={slug}
      active="thong-bao"
      viewer={viewer}
      counts={counts}
    >
      <div className="space-y-8">
        <PageHeading
          title="Thông báo"
          subtitle={`${NUMBER.format(visible.length)} thông báo · ${NUMBER.format(pinnedCount)} đang ghim`}
        />

        {refusal ? (
          <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
            {messageFor(refusal)}
          </p>
        ) : null}

        <details>
          <summary className="inline-flex h-12 cursor-pointer list-none items-center justify-center gap-2 rounded-control bg-terracotta px-5 text-[16px] font-semibold text-white [&::-webkit-details-marker]:hidden">
            <Plus aria-hidden className="size-5" strokeWidth={1.75} />
            Viết thông báo
          </summary>
          <form
            action={createAnnouncementAction}
            className="mt-4 max-w-2xl space-y-4 rounded-card border border-hairline bg-surface p-5"
          >
            <input type="hidden" name="tu-sach" value={slug} />
            <Field label="Tiêu đề" required htmlFor="tieu-de-moi">
              <Input id="tieu-de-moi" name="tieu-de" required />
            </Field>
            <Field label="Nội dung" required htmlFor="noi-dung-moi">
              <Textarea id="noi-dung-moi" name="noi-dung" rows={6} required />
            </Field>
            {/* Created as a draft, deliberately: `createAnnouncement` writes no
                `published_at`, and *Đăng ngay* on the card is the separate,
                visible decision to show it to the parish. */}
            <SubmitButton variant="primary" size="lg">
              Lưu nháp
            </SubmitButton>
          </form>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            chips={[
              {
                label: "Tất cả",
                href: listHref,
                active: !selected,
                count: announcements.length,
              },
              ...(["showing", "draft", "expired"] as const).map((state) => ({
                label: STATE_STYLE[state].label,
                href: `${listHref}?${STATUS}=${STATE_STYLE[state].slug}`,
                active: selected === state,
                count: byState(state),
              })),
            ]}
          />
        </div>

        {visible.length === 0 ? (
          <p className="text-[15px] text-meta">Chưa có thông báo nào.</p>
        ) : (
          <div className="space-y-4">
            {visible.map((a) => {
              const style = STATE_STYLE[a.state];
              return (
                <Card
                  key={a.id}
                  className={
                    a.state === "expired" ? "space-y-3 opacity-60" : "space-y-3"
                  }
                >
                  {a.isPinned ? (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Pin
                        aria-hidden
                        className="size-[18px] text-terracotta-ink"
                        strokeWidth={1.75}
                      />
                      <span className="inline-flex items-center rounded-control bg-terracotta/10 px-2.5 py-1 text-[14px] font-medium text-terracotta-ink">
                        Đang ghim
                      </span>
                    </div>
                  ) : null}

                  <h3 className="text-[19px] leading-snug font-semibold">
                    {a.title}
                  </h3>
                  <p className="line-clamp-2 text-[15px] text-meta">{a.excerpt}</p>
                  <p className="text-[14px] text-meta">
                    {a.publishedAt
                      ? `Đăng ${formatInstant(a.publishedAt)}`
                      : "Chưa đăng"}
                    {a.expiresAt ? ` · hết hạn ${formatInstant(a.expiresAt)}` : ""}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-4">
                    <Pill icon={style.icon} label={style.label} tone={style.tone} />

                    <div className="flex flex-wrap items-center gap-2">
                      {a.state === "showing" ? (
                        <form action={hideAnnouncementAction}>
                          <input type="hidden" name="tu-sach" value={slug} />
                          <input type="hidden" name="thong-bao" value={a.id} />
                          <SubmitButton variant="ghost" size="sm">
                            Ẩn
                          </SubmitButton>
                        </form>
                      ) : null}

                      {a.state === "draft" ? (
                        <form action={publishAnnouncementAction}>
                          <input type="hidden" name="tu-sach" value={slug} />
                          <input type="hidden" name="thong-bao" value={a.id} />
                          <SubmitButton variant="ghost" size="sm">
                            Đăng ngay
                          </SubmitButton>
                        </form>
                      ) : null}

                      {a.state === "showing" ? (
                        <form
                          action={
                            a.isPinned
                              ? unpinAnnouncementAction
                              : pinAnnouncementAction
                          }
                        >
                          <input type="hidden" name="tu-sach" value={slug} />
                          <input type="hidden" name="thong-bao" value={a.id} />
                          <SubmitButton variant="ghost" size="sm">
                            {a.isPinned ? "Bỏ ghim" : "Ghim lên đầu"}
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </div>

                  {a.state === "expired" ? (
                    <details>
                      <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
                        Đăng lại
                      </summary>
                      <form
                        action={publishAnnouncementAction}
                        className="mt-3 max-w-md space-y-3"
                      >
                        <input type="hidden" name="tu-sach" value={slug} />
                        <input type="hidden" name="thong-bao" value={a.id} />
                        <Field
                          label="Hết hạn"
                          htmlFor={`het-han-lai-${a.id}`}
                          hint="Để trống nếu thông báo không hết hạn."
                        >
                          <Input
                            id={`het-han-lai-${a.id}`}
                            name="het-han"
                            type="date"
                          />
                        </Field>
                        <SubmitButton variant="primary" size="md">
                          Đăng lại
                        </SubmitButton>
                      </form>
                    </details>
                  ) : null}

                  <details>
                    <summary className="cursor-pointer list-none text-[14px] underline [&::-webkit-details-marker]:hidden">
                      Sửa
                    </summary>
                    <form
                      action={updateAnnouncementAction}
                      className="mt-3 max-w-2xl space-y-4"
                    >
                      <input type="hidden" name="tu-sach" value={slug} />
                      <input type="hidden" name="thong-bao" value={a.id} />
                      <Field label="Tiêu đề" required htmlFor={`tieu-de-${a.id}`}>
                        <Input
                          id={`tieu-de-${a.id}`}
                          name="tieu-de"
                          defaultValue={a.title}
                          required
                        />
                      </Field>
                      <Field label="Nội dung" required htmlFor={`noi-dung-${a.id}`}>
                        <Textarea
                          id={`noi-dung-${a.id}`}
                          name="noi-dung"
                          rows={6}
                          defaultValue={a.body}
                          required
                        />
                      </Field>
                      <Field
                        label="Hết hạn"
                        htmlFor={`het-han-${a.id}`}
                        hint="Để trống để bỏ hạn."
                      >
                        <Input
                          id={`het-han-${a.id}`}
                          name="het-han"
                          type="date"
                          defaultValue={dateInputValue(a.expiresAt)}
                        />
                      </Field>
                      <SubmitButton variant="primary" size="md">
                        Lưu thay đổi
                      </SubmitButton>
                    </form>
                  </details>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-[14px] text-meta">
          Thông báo được ghim sẽ hiện đầu trang thông báo của tủ sách.
        </p>
      </div>
    </ManagerShell>
  );
}
