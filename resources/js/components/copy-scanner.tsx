import { useCallback, useEffect, useRef, useState } from "react";
import { route } from "ziggy-js";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copy } from "@/lib/copy";

// Fix round 1 (Important, overruling this task's own original "out of
// scope" call): zxing-wasm's DEFAULT locateFile fetches its ~1.07 MB
// .wasm binary from fastly.jsdelivr.net at scan time — this override
// makes Vite bundle it as a hashed asset under this app's own origin
// instead (public/build/assets/zxing_reader-*.wasm), so BR §1.3's
// dominant case — a volunteer's phone, next to a shelf, mid-scan — never
// depends on outbound access to a third-party CDN. The cPanel host's
// outbound access and CSP are unverified (docs/HOSTING.md), and this was
// the one runtime CDN fetch anywhere in resources/js. Called once at
// module scope, not per scan. DO NOT remove this override to "simplify"
// back to the default — that silently reintroduces the CDN dependency.
prepareZXingModule({
    overrides: {
        locateFile: (path: string, prefix: string) =>
            path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
});

/**
 * The camera half of Task 12's label round trip — Task 4's `LabelPayload`
 * docblock names the printed format, `ScanController` (Task 12) the
 * server half. This component owns everything the server never sees: the
 * camera stream, decoding a frame into a payload string with zxing-wasm,
 * and turning the server's answer into a Vietnamese sentence. It never
 * decides what a resolved copy MEANS — that is entirely the caller's,
 * via `onResolved`.
 *
 * **Decoding happens in the browser; resolution happens on the server.**
 * `LabelPayload::PREFIX` ("OLB1:") is checked here, client-side, before
 * any request — a QR that isn't an OLibra label at all is refused by name
 * without a round trip for a copy that cannot exist. A payload that DOES
 * carry the prefix but resolves to nothing on the server (unknown id,
 * soft-deleted, or another parish's shelf) is a second, later refusal —
 * `notFoundHere` rather than `notOlibraLabel`, so the two ordinary
 * failures never collapse into one sentence.
 *
 * **An ADDITIONAL control, never a replacement.** The lend and return
 * screens keep their existing copy-code Input; this renders as a button
 * beside it that opens a dialog. A denied camera permission, a missing
 * camera, or a decode failure that never recovers all leave that Input
 * exactly as usable as if this component were never on the page.
 *
 * **UNTESTED, and untestable in this repo.** `package.json`'s `test`
 * script runs `cd old_next && vitest run` — the read-only Next.js
 * reference app, not this one. There is no frontend test runner wired to
 * `resources/js` at all, so nothing here can be pinned by a test the way
 * `tests/Feature/Labels/ScanResolveTest.php` pins the server half. That
 * asymmetry is exactly why this component must never be the only path to
 * anything (see the previous paragraph).
 */

const OLB1_PREFIX = "OLB1:";

type ScanStatus = "idle" | "opening" | "scanning" | "resolving" | "error";

interface ResolvedCopy {
    copyId: string;
    code: string;
    state: string;
    bookId: string;
    slug: string;
    title: string;
    author: string;
}

interface Props {
    /** The bound shelf's slug — `ScanController::resolve` is scoped under
     * `/shelves/{shelf}/scan`. */
    shelfSlug: string;
    onResolved: (result: ResolvedCopy) => void;
}

export default function CopyScanner({ shelfSlug, onResolved }: Props) {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<ScanStatus>("idle");
    const [message, setMessage] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const decodingRef = useRef(false);
    // A ref, not a dependency: onResolved is a fresh closure on every
    // parent render (lend/index.tsx and returns/index.tsx pass an inline
    // arrow), and the camera-start effect below must NOT restart the
    // stream just because the parent re-rendered — only `open` changing
    // should do that.
    const onResolvedRef = useRef(onResolved);
    useEffect(() => {
        onResolvedRef.current = onResolved;
    }, [onResolved]);

    const stopCamera = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        for (const track of streamRef.current?.getTracks() ?? []) {
            track.stop();
        }
        streamRef.current = null;
    }, []);

    const resolvePayload = useCallback(
        async (text: string) => {
            if (!text.startsWith(OLB1_PREFIX)) {
                setStatus("error");
                setMessage(copy.scanner.notOlibraLabel);
                return;
            }

            setStatus("resolving");
            try {
                const response = await fetch(
                    route("shelves.scan", { shelf: shelfSlug, payload: text }),
                    { headers: { Accept: "application/json" } },
                );
                const body = (await response.json()) as { copy: ResolvedCopy | null };
                if (body.copy === null) {
                    setStatus("error");
                    setMessage(copy.scanner.notFoundHere);
                    return;
                }
                stopCamera();
                setOpen(false);
                setStatus("idle");
                setMessage(null);
                onResolvedRef.current(body.copy);
            } catch {
                setStatus("error");
                setMessage(copy.scanner.decodeError);
            }
        },
        [shelfSlug, stopCamera],
    );

    const decodeLoop = useCallback(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < video.HAVE_CURRENT_DATA || decodingRef.current) {
            rafRef.current = requestAnimationFrame(decodeLoop);
            return;
        }

        decodingRef.current = true;
        try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx && canvas.width > 0 && canvas.height > 0) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const results = await readBarcodes(imageData, {
                    formats: ["QRCode"],
                    maxNumberOfSymbols: 1,
                });
                const text = results[0]?.text;
                if (text) {
                    decodingRef.current = false;
                    stopCamera();
                    await resolvePayload(text);
                    return;
                }
            }
        } catch {
            decodingRef.current = false;
            setStatus("error");
            setMessage(copy.scanner.decodeError);
            stopCamera();
            return;
        }
        decodingRef.current = false;
        rafRef.current = requestAnimationFrame(decodeLoop);
    }, [resolvePayload, stopCamera]);

    const startCamera = useCallback(async () => {
        setStatus("opening");
        setMessage(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            setStatus("scanning");
            rafRef.current = requestAnimationFrame(decodeLoop);
        } catch (error) {
            const name = error instanceof DOMException ? error.name : "";
            setStatus("error");
            setMessage(
                name === "NotAllowedError" || name === "PermissionDeniedError"
                    ? copy.scanner.permissionDenied
                    : name === "NotFoundError" || name === "DevicesNotFoundError"
                      ? copy.scanner.noCamera
                      : copy.scanner.cameraError,
            );
        }
    }, [decodeLoop]);

    useEffect(() => {
        if (open) {
            void startCamera();
        } else {
            stopCamera();
        }
        return stopCamera;
        // startCamera/stopCamera are themselves useCallback-memoised on
        // [shelfSlug] (via decodeLoop -> resolvePayload) and [] — stable
        // across an ordinary re-render, so including them here only
        // retriggers this effect on an actual shelf change, never on the
        // parent re-rendering with a new onResolved closure (handled by
        // the ref above instead).
    }, [open, startCamera, stopCamera]);

    return (
        <>
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>
                {copy.scanner.openButton}
            </Button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setStatus("idle");
                        setMessage(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{copy.scanner.dialogTitle}</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">{copy.scanner.lead}</p>
                    <div className="overflow-hidden rounded-md bg-black">
                        <video
                            ref={videoRef}
                            muted
                            playsInline
                            className="aspect-square w-full object-cover"
                        />
                    </div>
                    {status === "resolving" ? (
                        <p role="status" className="text-sm text-muted-foreground">
                            {copy.scanner.resolving}
                        </p>
                    ) : null}
                    {status === "error" && message ? (
                        <p
                            role="alert"
                            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                        >
                            {message}
                        </p>
                    ) : null}
                </DialogContent>
            </Dialog>
        </>
    );
}
