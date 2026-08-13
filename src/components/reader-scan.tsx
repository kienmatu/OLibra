"use client";

import { useRouter } from "next/navigation";
import { QrScanner } from "./qr-scanner";

/**
 * The reader's scanner: read a sticker, land on the confirmation for that copy.
 *
 * **The scan time is not sent from here, and that is the point.** An earlier
 * version put `Date.now()` from this browser into the URL and had the server
 * compare it against its own clock five minutes later. A phone's clock is
 * frequently wrong by more than that, and the failure was silent in both
 * directions: a slow clock made every scan arrive already expired — with
 * "quét lại" as the advice, which could never help — and a fast one made the
 * window never expire at all. The confirmation page stamps the time from the
 * server's clock instead, so one clock decides.
 *
 * `push`, not `replace`: a reader who scans, looks at the confirmation and
 * decides against it should get back to the scanner with the back button,
 * which is where they were.
 */
export function ReaderScan({ basePath }: { basePath: string }) {
  const router = useRouter();

  return (
    <QrScanner
      label="Quét mã trên sách"
      onScan={(copyId) => {
        router.push(`${basePath}?ban=${encodeURIComponent(copyId)}`);
      }}
    />
  );
}
