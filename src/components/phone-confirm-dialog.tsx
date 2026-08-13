"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/field";

/** Every form this dialog mounts beside spells the phone field this way. */
const PHONE_FIELD = "dien-thoai";
/** The Produces interface's own name for the reason field. */
const REASON_FIELD = "ly-do-thieu-sdt";

/**
 * The danger confirmation raised when a phone field is left empty — PO
 * feedback round 1, Task 8. The fifth client component in this codebase, and
 * it follows `src/components/ui/submit-button.tsx` for how a client
 * component cooperates with a server-action form here: an island beside a
 * server-rendered `<form>`, never a client-rendered page.
 *
 * **The requirement lives on the server, not here.** `thieu-so-dien-thoai`
 * (`src/domain/kernel/errors.ts`) is the rule — raised by `register()` for
 * the two registration write paths and by `assertPhoneOrReason`
 * (`src/domain/members/profile-fields.ts`) for the two correction paths —
 * and this dialog is the same question asked earlier and more pleasantly.
 * With JavaScript unavailable this component never mounts at all (it is
 * `"use client"`, and the `<form>` it would have intercepted has no listener
 * without it), so the form submits as it always would, the action refuses,
 * and the page re-renders carrying the same warning and the same reason
 * field an ordinary page shows. Nothing here is reachable only through this
 * dialog.
 *
 * **What it does, precisely.** It listens for `submit` on the form named by
 * `formId` — never its own form; a `<dialog>`'s contents are not lexically
 * inside the target form, and could not submit it directly even if they
 * were, since a `<form>` may not nest inside another. When that form is
 * submitted with `dien-thoai` empty and `ly-do-thieu-sdt` also empty (nothing
 * on the form, and nothing already on file — the caller renders the reason
 * field with whatever is on file as its starting value, so an untouched
 * field that already answers the question never trips this), it cancels the
 * submit and opens the dialog instead. The confirm button is disabled until
 * the dialog's own textarea holds non-whitespace text; confirming copies
 * that text into the form's `ly-do-thieu-sdt` control (`<input type="hidden">`
 * on a fresh form, a plain visible field on one already showing it) and
 * resubmits the form — a second `submit` event this component recognises and
 * lets straight through, rather than looping back into itself.
 */
export function PhoneConfirmDialog({ formId }: { formId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Set the moment `confirm()` resubmits the target form, and read (then
  // cleared) by the very next `submit` event on it — which is that same
  // resubmission, since nothing else in this component calls
  // `requestSubmit()`. Without it, copying the reason in and resubmitting
  // would re-enter this component's own listener and reopen the dialog on a
  // form that now, in fact, carries a reason.
  const resubmitting = useRef(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();

  useEffect(() => {
    const form = document.getElementById(formId);
    const dialog = dialogRef.current;
    if (!(form instanceof HTMLFormElement) || !dialog) return;

    function onSubmit(event: SubmitEvent) {
      if (resubmitting.current) {
        resubmitting.current = false;
        return;
      }
      if (fieldValue(form as HTMLFormElement, PHONE_FIELD) !== "") return;
      if (fieldValue(form as HTMLFormElement, REASON_FIELD) !== "") return;
      event.preventDefault();
      setReason("");
      dialog!.showModal();
    }

    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [formId]);

  function confirm() {
    const trimmed = reason.trim();
    if (trimmed === "") return;
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    setFieldValue(form, REASON_FIELD, trimmed);
    dialogRef.current?.close();
    resubmitting.current = true;
    form.requestSubmit();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={reasonId + "-tieu-de"}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-lost bg-surface p-0 text-ink backdrop:bg-ink/45"
    >
      {/* The dialog's own cancel — `method="dialog"` closes it and submits
          nothing, the conventional shape for a `<dialog>`'s own dismissal,
          and honest about it: this form has genuinely nowhere else to go. */}
      <form method="dialog" className="space-y-4 p-6">
        <h2
          id={reasonId + "-tieu-de"}
          className="flex items-center gap-2 text-[19px] font-semibold text-lost"
        >
          <AlertTriangle
            aria-hidden
            className="size-5 shrink-0"
            strokeWidth={1.75}
          />
          Chưa có số điện thoại
        </h2>
        <p className="text-[15px] text-ink/90">
          Tủ sách sẽ không có cách nào liên lạc với người này. Hãy cho biết vì sao
          chưa có số điện thoại.
        </p>
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="text-[16px] font-medium">
            Lý do
          </label>
          {/* Fix round 1: not HTML `required`. This textarea and the cancel
              button below share one `<form method="dialog">`, and a browser
              runs interactive constraint validation *before* branching on
              `method="dialog"` — so clicking "Quay lại nhập số" while this
              box is empty (the state the dialog opens in, every time) fired
              the native validation bubble instead of closing. The confirm
              button's own `disabled={reason.trim() === ""}` below is already
              the real gate; a second, native one on the same field only
              breaks the other button. */}
          <Textarea
            id={reasonId}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="submit" variant="quiet" size="md">
            Quay lại nhập số
          </Button>
          <Button
            type="button"
            variant="danger"
            size="lg"
            disabled={reason.trim() === ""}
            onClick={confirm}
          >
            Vẫn tiếp tục không có số điện thoại
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return "";
}

function setFieldValue(form: HTMLFormElement, name: string, value: string): void {
  const el = form.elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value;
  }
}
