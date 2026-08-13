"use client";

import { useRouter } from "next/navigation";
import { QrScanner } from "./qr-scanner";

/**
 * The reader's scanner: read a sticker, land on the confirmation for that copy.
 *
 * `luc` is the moment the scan happened, carried in the URL and then in the
 * confirmation form's hidden field. The action refuses it after five minutes —
 * see `quet-ma/actions.ts` for why that window exists and why the value is
 * deliberately unsigned.
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
        router.push(
          `${basePath}?ban=${encodeURIComponent(copyId)}&luc=${Date.now()}`,
        );
      }}
    />
  );
}
