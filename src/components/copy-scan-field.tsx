"use client";

import { useRouter } from "next/navigation";
import { QrScanner } from "./qr-scanner";

/**
 * The scanner, wired to a screen that already knows what to do with an answer.
 *
 * **A scan does not open a new flow — it answers the question the screen was
 * already asking.** `cho-muon` and `nhan-tra` both begin with "which book?", so
 * a successful read simply navigates to that same screen with `?ban=<uuid>`
 * set, and every step after it is the flow the volunteer already knows. This is
 * the argument `sach/[id]/page.tsx` records for its own two shortcuts: the same
 * flows with a shorter runway, not new ones.
 *
 * **Navigation rather than form submission.** The copy's identifier is a UUID,
 * and the search box beside this takes a human-typed *code* — putting a UUID
 * into a box labelled "Tên sách hoặc mã bản" would show a volunteer a string
 * they never typed and could not have. The page reads `ban` separately and
 * resolves it, so typing keeps working exactly as before and neither path
 * knows about the other.
 *
 * `router.replace`, not `push`: a mis-scan corrected by a second scan should
 * not leave the first one in the back button's history, in between the
 * volunteer and the screen they started on.
 */
export function CopyScanField({
  basePath,
  label = "Quét mã bản",
}: {
  /** The screen to come back to, with `?ban=` appended. */
  basePath: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <QrScanner
      label={label}
      onScan={(copyId) => {
        router.replace(`${basePath}?ban=${encodeURIComponent(copyId)}`);
      }}
    />
  );
}
