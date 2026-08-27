import Link from "next/link";

/**
 * What all five `/ho-so/*` pages show a viewer `isMemberlessSuperAdmin`
 * (`src/lib/reader-area.ts`) is true for, in place of their ordinary content.
 *
 * **One component, not five inline paragraphs.** 2026-08-10 QA remediation
 * task 10 chose this treatment over `notFound()` specifically because a super
 * admin reaches these pages from "Hồ sơ" in their own nav
 * (`src/components/shell/reader-tabs.tsx`) — silently 404ing a link the app
 * itself rendered is only marginally better than the `22P02` it replaces. A
 * single shared component is what keeps the five pages' wording unable to
 * drift apart from each other the way U2 §3.1 already found `ReaderTabs`
 * itself drifting once (task 8): five copies of this sentence would be five
 * places a future edit only reaches four of.
 *
 * Renders inside each page's own `<main>`, alongside the `ShelfHeader` and
 * `ReaderTabs` chrome those pages already render unconditionally — so the tab
 * bar stays visible and correctly marks whichever of the five tabs is active,
 * and only the content beneath it changes. A super admin browsing this shelf
 * can still reach every other page of it through the tabs; there is simply
 * nothing reader-shaped to show them on any of these five.
 *
 * The `rounded-card border border-hairline bg-surface px-4 py-3 text-[14px]
 * text-ink` classes are not a new pattern: they are the exact classes the
 * `refusal` block already uses on three of these five pages for "a message
 * the reader should read" (`messageFor(refusal)`), copied rather than
 * reinvented so this reads as the same kind of sentence.
 */
export function NotAReaderNotice() {
  return (
    <main className="mx-auto max-w-xl px-6 py-10">
      <p className="rounded-card border border-hairline bg-surface px-4 py-3 text-[14px] text-ink">
        Bạn không phải bạn đọc của tủ sách này.
      </p>
      <Link href="/quan-tri" className="mt-6 inline-block text-[14px] underline">
        Về trang quản trị
      </Link>
    </main>
  );
}
