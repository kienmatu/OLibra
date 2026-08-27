"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "./ui/button";
import { uuidFromPayload } from "../lib/qr";

/**
 * How long the camera stays open with nothing successfully read.
 *
 * Not a timeout on the feature — the button comes straight back, and typing
 * the copy code was available the whole time. It is a timeout on the *camera*,
 * so a volunteer who tapped "Quét mã bản" and then got talking to somebody is
 * not walking around with the lens live and the battery draining.
 */
const IDLE_MS = 60_000;

type Phase =
  "idle" | "starting" | "scanning" | "denied" | "unsupported" | "timed-out";

/**
 * The camera half of QR lending.
 *
 * **One decoder on every device, and `BarcodeDetector` is deliberately not
 * used even where it exists.** The native API is unimplemented in Safari and
 * in every browser on iOS, with no signal that it is coming, so it could only
 * ever have been half a solution. Running it on Android and a library on iOS
 * would mean two decode paths, two sets of bugs, and the less-exercised path
 * handed to the iPhone — which, in the parishes this serves, is most of the
 * phones. One path is tested once.
 *
 * **The decoder is imported inside `start`, not at module scope.** It is a
 * WebAssembly bundle, and no page that merely *offers* a scan button should
 * pay to download it.
 *
 * **Teardown is one function called from four places** — a successful read,
 * the close button, unmount, and the tab being hidden. A camera left streaming
 * behind a closed overlay keeps the indicator light on and drains a
 * volunteer's battery in their pocket, and four teardown paths would be four
 * chances to leave one out.
 *
 * `getUserMedia` requires a secure context. Over plain HTTP this reports
 * `unsupported` in Vietnamese rather than failing silently — see
 * `docs/OPERATIONS.md` for the deployment note that goes with it.
 */
export function QrScanner({
  label,
  onScan,
}: {
  label: string;
  /** Called once, with a copy's UUID, as soon as a label is read. */
  onScan: (copyId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (idleRef.current !== null) clearTimeout(idleRef.current);
    idleRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Unmount.
  useEffect(() => stop, [stop]);

  // The tab going to the background. A phone locking counts as this.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setPhase("idle");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stop]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported");
      setMessage(
        "Máy này không mở được máy ảnh trong trình duyệt. Bạn nhập mã bản giúp nhé.",
      );
      return;
    }

    setPhase("starting");
    setMessage(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // The back camera: the volunteer is pointing the phone at a book, not
        // at themselves.
        video: { facingMode: "environment" },
      });
    } catch {
      setPhase("denied");
      setMessage("Chưa được phép dùng máy ảnh. Bạn nhập mã bản giúp nhé.");
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      stop();
      return;
    }
    video.srcObject = stream;
    await video.play();
    setPhase("scanning");

    idleRef.current = setTimeout(() => {
      stop();
      setPhase("timed-out");
      setMessage("Chưa quét được mã nào. Bạn thử lại hoặc nhập mã bản nhé.");
    }, IDLE_MS);

    const { readBarcodesFromImageData } = await import("zxing-wasm/reader");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      stop();
      setPhase("unsupported");
      setMessage(
        "Máy này không đọc được hình từ máy ảnh. Bạn nhập mã bản giúp nhé.",
      );
      return;
    }

    const tick = async () => {
      // The stream being gone is how every teardown path stops this loop.
      if (!streamRef.current) return;

      if (video.readyState < 2) {
        frameRef.current = requestAnimationFrame(() => void tick());
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);

      const results = await readBarcodesFromImageData(
        context.getImageData(0, 0, canvas.width, canvas.height),
        { formats: ["QRCode"] },
      );

      // A shelf can have several stickers in frame at once. The first one that
      // is ours wins; a cereal box in the background decodes to something
      // `uuidFromPayload` refuses, and is skipped rather than reported.
      const copyId = results
        .map((result) => uuidFromPayload(result.text))
        .find((id): id is string => id !== null);

      if (copyId) {
        stop();
        setPhase("idle");
        onScan(copyId);
        return;
      }

      frameRef.current = requestAnimationFrame(() => void tick());
    };

    frameRef.current = requestAnimationFrame(() => void tick());
  }, [onScan, stop]);

  const close = () => {
    stop();
    setPhase("idle");
    setMessage(null);
  };

  const live = phase === "starting" || phase === "scanning";

  return (
    <div className="space-y-2">
      {live ? null : (
        <Button
          type="button"
          variant="quiet"
          size="md"
          onClick={() => void start()}
        >
          <Camera aria-hidden className="size-5" strokeWidth={1.75} />
          {label}
        </Button>
      )}

      {message ? <p className="text-[15px] text-meta">{message}</p> : null}

      <div hidden={!live} className="space-y-2">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Khung hình máy ảnh để quét mã"
          className="w-full max-w-sm rounded-card border border-hairline bg-paper"
        />
        <p className="text-[15px] text-meta">
          Đưa máy ảnh vào ô vuông dán trên bìa sách.
        </p>
        <Button type="button" variant="quiet" size="md" onClick={close}>
          <X aria-hidden className="size-5" strokeWidth={1.75} />
          Đóng máy ảnh
        </Button>
      </div>
    </div>
  );
}
