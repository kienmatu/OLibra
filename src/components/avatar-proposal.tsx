"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, Clock } from "lucide-react";
// Relative specifiers, not the `@/` alias, for the reason
// `./phone-confirm-dialog.tsx` records: `vitest.config.ts` has no
// `resolve.alias` for `@/`, and `tests/components/*.test.tsx` import this
// module directly.
import { messageFor, type ErrorCode } from "../domain/kernel/errors";
// `../lib/avatar-limits`, never `../lib/avatar`: that module reaches
// `next/headers`, `next/navigation` and the Postgres pool through
// `./page-data`, none of which a client component may import.
// `errors.ts` is safe here — it imports nothing at all.
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES } from "../lib/avatar-limits";
import { Pill } from "./ui/pill";
import { SubmitButton } from "./ui/submit-button";

/**
 * The reader's photograph, and the proposal to change it — the eighth client
 * component in this codebase.
 *
 * **Everything here is additive over a form that already works.**
 * `./phone-confirm-dialog.tsx` states the pattern: with JavaScript unavailable
 * this component never mounts, the `<form>` submits exactly as it would have,
 * `storeProposedAvatar` applies the same rules, and the page re-renders
 * carrying the refusal. Nothing below is reachable only through the island —
 * the size and type checks here are the server's rules asked earlier and more
 * pleasantly, never the rules themselves.
 *
 * **The circle swaps, and the pill is what keeps that honest.** Showing the
 * chosen photograph where the current one was reads as *the photograph has been
 * changed*, when the whole domain rule is that it has not — it is a proposal
 * awaiting a manager (BR §2). So while, and only while, a pick is staged, a
 * `Pill` reading "Ảnh mới — chưa gửi" sits beneath it: an icon, a Vietnamese
 * word and a colour together, which is design rule 2 and which `Pill` enforces
 * by making both props required.
 *
 * **The refusal sentence is read from `messageFor`, never retyped.** Two copies
 * of "Ảnh vượt quá 5 MB." is how one of them survives the next change to the
 * limit.
 */
export function AvatarProposal({
  action,
  slug,
  currentAvatarUrl,
  initial,
}: {
  action: (form: FormData) => Promise<void>;
  slug: string;
  currentAvatarUrl: string | null;
  initial: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ErrorCode | null>(null);
  // Held so the object URL can be revoked on the next pick and on unmount —
  // a blob URL kept alive for the life of the page is a leak the browser
  // cannot collect on its own.
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  function choose(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;

    if (file === null) {
      setPreview(null);
      setRefusal(null);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setPreview(null);
      setRefusal("file_too_large");
      return;
    }
    if (file.type === "image/heic" || file.type === "image/heif") {
      setPreview(null);
      setRefusal("heic_not_supported");
      return;
    }
    if (!AVATAR_ACCEPT.includes(file.type)) {
      setPreview(null);
      setRefusal("invalid_image");
      return;
    }

    objectUrl.current = URL.createObjectURL(file);
    setPreview(objectUrl.current);
    setRefusal(null);
  }

  const shown = preview ?? currentAvatarUrl;

  return (
    <div className="mt-8 flex items-start gap-4">
      <div className="shrink-0">
        <div className="flex size-[72px] items-center justify-center overflow-hidden rounded-full bg-paper text-[26px] font-semibold text-leather">
          {shown ? (
            // A plain <img>, deliberately: `next.config.ts` configures no image
            // optimizer for the object store's host, so `next/image` would
            // refuse the URL outright. `AvatarCompareRow` on both approval
            // screens carries the identical note.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden>{initial}</span>
          )}
        </div>
        {preview ? (
          <Pill
            icon={Clock}
            label="Ảnh mới — chưa gửi"
            tone="held"
            className="mt-2"
          />
        ) : null}
      </div>

      <form action={action}>
        <input type="hidden" name="tu-sach" value={slug} />
        <label className="inline-flex cursor-pointer items-center gap-2 text-[15px] font-medium text-leather">
          <Camera aria-hidden className="size-[18px]" strokeWidth={1.75} />
          Đề nghị đổi ảnh
          <input
            type="file"
            name="anh"
            // Never list HEIC here. iOS Safari transcodes a HEIC photograph to
            // JPEG on upload precisely *because* this attribute omits it;
            // adding it tells iOS to send the original, which the prebuilt
            // sharp binaries cannot decode. See `src/lib/avatar.ts`.
            accept={AVATAR_ACCEPT.join(",")}
            className="sr-only"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </label>
        <p className="mt-1.5 text-[13px] text-meta">
          Ảnh JPG, PNG, WEBP hoặc AVIF, tối đa 5 MB. Ảnh sẽ được cắt vuông và thu
          nhỏ.
        </p>
        <p className="mt-1 text-[13px] text-meta">
          Ảnh mới sẽ gửi cho quản lý xem và duyệt trước khi hiển thị.
        </p>
        {refusal ? (
          <p className="mt-2 flex items-start gap-1.5 text-[13px] text-overdue">
            <AlertTriangle
              aria-hidden
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={1.75}
            />
            {messageFor(refusal)}
          </p>
        ) : null}
        <SubmitButton
          variant="quiet"
          size="sm"
          className="mt-2"
          disabled={refusal !== null}
        >
          Gửi ảnh
        </SubmitButton>
      </form>
    </div>
  );
}
