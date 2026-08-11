import Link from "next/link";
import { ArrowRight, BookUp, History, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FrontDoorFooter, FrontDoorHeader } from "@/components/shell/public-header";
import { loadFrontDoorViewer } from "@/lib/page-data";

/**
 * U1 §2. Newly dynamic (Task 6, 2026-08-10 QA remediation) — this page read
 * nothing at all until now, and `tests/architecture/pages-reading-the-
 * database-are-dynamic.test.ts` used to name it individually as the guard's
 * own negative control, proof the check does not simply flag everything.
 * `tests/architecture/a-wired-page-renders-no-fixtures.test.ts` pinned it the
 * same way, in `PAGES_NOT_YET_WIRED`. Both are updated alongside this file:
 * the landing page is no longer a page with nothing to read, so it can no
 * longer stand in as the proof that one exists — `/loi` still does, alone.
 *
 * What changed is not the marketing copy, it is the header above it:
 * `loadFrontDoorViewer()` below is what lets a signed-in visitor see that
 * they are signed in here too, exactly as `/tu-sach` and `/lien-he` do — see
 * that function's docstring for why a page that only reads a session cookie
 * is still a page a cached render would serve to the wrong person, the
 * moment two different visitors reach it in different states.
 */
export const dynamic = "force-dynamic";

// Same text as `src/app/layout.tsx`'s own fallback title, stated explicitly
// rather than left to inheritance: `tests/architecture/every-page-has-a-
// title.test.ts` requires every `page.tsx` to export one, precisely so that
// no future page can go untitled by relying on the layout the way this one
// used to — silently, and for forty-six other pages besides this one.
export const metadata = { title: "OLibra — Tủ sách cộng đồng" };

const WHAT_IT_DOES = [
  {
    icon: BookUp,
    title: "Cho mượn trong ba bước",
    body: "Tìm sách, chọn bạn đọc, xác nhận. Tình nguyện viên đứng ngay tại kệ cũng làm được, và các em không cần đăng nhập gì cả.",
  },
  {
    icon: Users,
    title: "Quản lý bạn đọc",
    body: "Duyệt đăng ký, xem ai đang giữ sách, gọi nhắc những cuốn quá hạn.",
  },
  {
    icon: History,
    title: "Ghi lại mọi việc",
    body: "Mỗi thao tác đều vào nhật ký, đọc được như một câu tiếng Việt bình thường.",
  },
];

export default async function LandingPage() {
  const viewer = await loadFrontDoorViewer();

  return (
    <>
      <FrontDoorHeader
        viewerName={viewer?.name ?? null}
        isSuperAdmin={viewer?.isSuperAdmin ?? false}
      />

      <main className="mx-auto max-w-5xl px-6">
        {/* Logo, a sentence or two, and the two ways in. Nothing else — there
            is no blog and no separate about page (§16.1). */}
        <section className="py-20">
          <h1 className="max-w-3xl text-[40px] leading-[1.15] font-semibold">
            Phần mềm quản lý cho những tủ sách nhỏ trong giáo xứ.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-meta">
            OLibra giúp các bạn tình nguyện viên cho mượn, nhận trả và giữ tủ sách
            ngăn nắp — chỉ với một chiếc điện thoại.
          </p>

          {/* Task 6: "Đăng nhập" is the wrong primary action for somebody who
              already is — the same defect this whole task is about, one level
              down from the header. A signed-in super admin gets the one thing
              a fresh install actually needs from this screen: the way into
              `/quan-tri`, worded exactly as the header's own link so the two
              read as one destination rather than two. An ordinary signed-in
              reader gets no primary at all — `Button`'s "one primary per
              screen" is satisfied by zero as much as by one, and there is
              nothing on this page a reader needs more than what the header
              already gives them. */}
          <div className="mt-9 flex flex-wrap items-center gap-4">
            {viewer ? (
              viewer.isSuperAdmin ? (
                <ButtonLink href="/quan-tri" variant="primary" size="lg">
                  Quản trị hệ thống
                  <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
                </ButtonLink>
              ) : null
            ) : (
              <ButtonLink href="/dang-nhap" variant="primary" size="lg">
                Đăng nhập
                <ArrowRight aria-hidden className="size-5" strokeWidth={1.75} />
              </ButtonLink>
            )}
            <ButtonLink href="/tu-sach" variant="outline" size="lg">
              {viewer ? "Tìm tủ sách" : "Tìm tủ sách để đăng ký"}
            </ButtonLink>
          </div>

          {viewer ? null : (
            <p className="mt-5 text-[15px] text-meta">
              Chưa có tài khoản? Tìm tủ sách của giáo xứ mình rồi đăng ký — quản lý
              sẽ duyệt sau lễ Chúa nhật.
            </p>
          )}
        </section>

        <section className="border-t border-hairline py-16">
          <h2 className="text-[20px] font-semibold">OLibra làm được gì</h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-3">
            {WHAT_IT_DOES.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon
                  aria-hidden
                  className="size-6 text-leather"
                  strokeWidth={1.75}
                />
                <h3 className="mt-3 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] text-meta">{body}</p>
              </div>
            ))}
          </div>

          <p className="mt-10 text-[15px] text-meta">
            Muốn mở một tủ sách cho giáo xứ của bạn?{" "}
            <Link href="/lien-he" className="font-medium text-sage hover:underline">
              Liên hệ với ban quản trị
            </Link>
          </p>
        </section>
      </main>

      <FrontDoorFooter />
    </>
  );
}
