import { ButtonLink } from "@/components/ui/button";
import { FrontDoorHeader } from "@/components/shell/public-header";
import { SiteFooter } from "@/components/shell/site-footer";
import { ERROR_STATES } from "@/lib/error-states";

export const metadata = { title: "Các trang lỗi khác — OLibra" };

/**
 * The reference sheet. The panels themselves moved to `src/lib/error-states.ts`
 * when `src/app/error.tsx` started rendering the server-failure one for real —
 * this page shows all four, the boundary uses that one, and both read the same
 * objects so a reworded sentence cannot end up meaning two things.
 */
const PANELS = ERROR_STATES;

export default function ErrorStatesSheetPage() {
  return (
    <>
      {/* No viewer: this page renders nothing from a session (Task 6,
          2026-08-10 QA remediation) — it is a reference sheet of error
          states, not a page anybody is signed in to look at. */}
      <FrontDoorHeader viewerName={null} isSuperAdmin={false} shelves={[]} />

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* This is a reference sheet of error states, so the caption below is
            the visible label. The heading exists for structure and screen
            readers. */}
        <h1 className="sr-only">Các trang lỗi</h1>
        <p className="text-[14px] text-meta">Các trang lỗi khác</p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {PANELS.map((panel) => (
            <div key={panel.key} className="flex flex-col">
              <p className="text-[13px] text-meta">{panel.caption}</p>
              <div className="mt-3 flex flex-1 flex-col items-start rounded-card border border-hairline bg-surface p-6">
                <panel.icon
                  aria-hidden
                  className={`size-8 ${panel.ink}`}
                  strokeWidth={1.5}
                />
                <h2 className="mt-4 text-[20px] font-semibold">{panel.heading}</h2>
                <p className="mt-2 flex-1 text-[15px] text-meta">{panel.body}</p>
                <ButtonLink
                  href="#"
                  variant="outline"
                  size="sm"
                  className="mt-5 h-11"
                >
                  {panel.action}
                </ButtonLink>
              </div>
            </div>
          ))}
        </div>
      </main>

      <SiteFooter contact={null} />
    </>
  );
}
