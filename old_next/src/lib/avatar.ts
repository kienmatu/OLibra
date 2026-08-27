import { proposeAvatarChange } from "../domain/members/commands/propose-avatar-change";
import { ValidationFailed } from "../domain/kernel/errors";
import type { Command } from "../domain/kernel/unit-of-work";
import { objectKey } from "../storage/s3";
import { processAvatar } from "./avatar-image";
import { AVATAR_ACCEPT, AVATAR_MAX_BYTES } from "./avatar-limits";
import { objectStore } from "./object-store";
import { submitCommand } from "./page-data";

/**
 * The avatar's surface half: the only place in this application that decides
 * whether an uploaded file is acceptable, and the only place that orders a write
 * or a delete of one against a database transaction.
 *
 * It lives in `src/lib/` for the reason `page-data.ts` does: the surface imports
 * the domain and the store, never the reverse.
 * `tests/architecture/boundaries.test.ts` forbids `src/domain/` from importing
 * `src/storage/` or `@aws-sdk/*` at all, and names the reason — a command that
 * wrote the file inside its own transaction leaves an orphaned object the moment
 * that transaction rolls back.
 *
 * ── The ordering, which is the whole of what this module gets right or wrong ─
 *
 * Two operations have to be sequenced against a commit, and they are sequenced
 * in opposite directions, for the same reason:
 *
 * **A `put` happens before the transaction opens.** OPS §4.3 requires the image
 * to exist while the request is pending — "the proposed image is stored when the
 * change is proposed, so the manager can look at it while deciding" — so there
 * is no version of this where the bytes land after the commit. The failure that
 * leaves is: the put succeeds and the command then refuses (a wrong membership,
 * a caller with no permission), leaving an object nothing references.
 * `proposeAvatar` below closes that one itself, deleting what it wrote before
 * rethrowing, because at that point the transaction has *definitely* rolled back
 * and the object is definitively unreferenced.
 *
 * **A `delete` happens after the transaction commits, never inside it.**
 * `submitCommand` returns only once `runCommand`'s transaction has committed, so
 * calling the store after it returns is the ordering, expressed as control flow
 * rather than as a comment. The inverse — deleting while the transaction is
 * still open — destroys an image that a still-live request points at for as long
 * as the commit that follows might fail, which is a reader's photograph gone and
 * a request that can never be approved into anything.
 *
 * **The residual failure, named rather than hidden:** the commit succeeds and
 * the delete fails. One object is orphaned. It costs storage rather than
 * correctness, it is retryable, and `ObjectStore.delete` of a key that is not
 * there does not throw — so a retry of the whole action is safe. That is
 * strictly the better half of the trade, and it is the half this module chooses
 * deliberately.
 *
 * ── Every photograph is deletable, which took a migration ──────────────────
 *
 * *Approving* a replacement used to orphan the previous photograph as well, and
 * "orphaned storage" was the wrong name for it. `src/storage/s3.ts` argues that
 * the readers here are children and that name-plus-face is the most identifying
 * pair of facts in the system; a family who replaces their child's photograph,
 * or asks the parish to take it down, must not leave every earlier version
 * answering 200 from a public bucket forever. That is retention, not storage.
 *
 * `ApproveProfileChange` returns the superseded object the same way the reject
 * and cancel paths do, and `decideAndDiscardAvatar` below deletes it. It reads
 * the key straight off the `users` row it just rewrote, which it could not do
 * while that row held a URL — the version before
 * `20260813_02_avatar_object_only.sql` had to hunt through earlier approved
 * requests for one whose proposed URL matched, and a photograph set at
 * *registration* was never in such a request at all and so could never be
 * removed by anything. Master plan §7.14, **B6 · Avatar retention**, is closed
 * by that migration: the key is the only stored fact, and every avatar has one.
 */

// Re-exported so existing importers (`tests/lib/avatar-over-http.test.ts` among
// them) keep working, and so this module still reads as the place the policy
// lives even though the two constants are now shared with a client component.
export { AVATAR_MAX_BYTES } from "./avatar-limits";

/**
 * The content types accepted, as a set for the server's own gate.
 *
 * An allow-list keyed on the type rather than on the uploaded filename, which
 * is attacker-controlled and, for a Vietnamese reader, frequently full of
 * diacritics `objectKey` exists to keep out of a URL.
 *
 * **A set rather than the type→extension map this used to be.** Every stored
 * object is now WebP whatever arrived, so `objectKey("avatars", "webp")` is a
 * constant call and the old table's extension half has no reader left. What
 * that table protected — that it "can never ask `objectKey` for an extension it
 * will refuse" — reduces from four extensions agreeing to one and stops being
 * able to drift.
 *
 * Built from `AVATAR_ACCEPT` (`./avatar-limits.ts`) so the control a reader
 * sees and the gate the server applies cannot disagree.
 */
const AVATAR_TYPES: ReadonlySet<string> = new Set(AVATAR_ACCEPT);

/**
 * Which refusal an unacceptable content type earns.
 *
 * HEIC gets its own sentence because it is a photograph and a valid one, just
 * in a codec we cannot decode — "Tệp này không phải là ảnh hợp lệ." would be a
 * false statement shown to somebody holding a perfectly good picture of their
 * child.
 */
function refusalFor(type: string): "heic_not_supported" | "invalid_image" {
  return type === "image/heic" || type === "image/heif"
    ? "heic_not_supported"
    : "invalid_image";
}

/**
 * The parts of a `File` this module needs, spelled out so the policy can be
 * driven by a plain object in a test as well as by a real multipart upload.
 */
export interface UploadedFile {
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Applies OPS §4.3's three failure modes and puts the bytes.
 *
 * **`invalid_image` is a decode.** `./avatar-image.ts` re-encodes every upload,
 * so a file that is not an image fails there and earns the refusal — the
 * header a browser attached is no longer the whole of the claim. What the
 * bucket is protected by *in addition* is unchanged and still load-bearing:
 * the key never carries the uploaded name, never ends `.html`, and is served
 * from a bucket whose only public grant is `s3:GetObject`
 * (`tests/architecture/compose-grants-only-get-object.test.ts`). The `nosniff`
 * a browser also receives is **MinIO's**, not this application's, and AWS S3
 * does not send it — recorded on `ObjectStore` in `src/storage/s3.ts`, because
 * a defence that moves with the provider must not be counted as one of ours.
 *
 * **The size is checked before `arrayBuffer()`, which is not the same as before
 * the bytes arrive.** This function refuses an oversize file without
 * materialising a second copy of it in this process, and that is the whole of
 * what the ordering buys. It does **not** stop a hostile upload being received:
 * by the time a server action holds a `FormData`, the framework has already read
 * the request body — an earlier version of this paragraph claimed "a hostile 4
 * GB upload is refused without being pulled into memory first", which was true
 * of `arrayBuffer()` and false of the request. What actually refuses a body
 * nobody should buffer is `serverActions.bodySizeLimit` in `next.config.ts`,
 * upstream of this file and of every line of application code, and it is set
 * *above* `AVATAR_MAX_BYTES` so that the sentence below is the one a reader
 * sees for anything in between.
 *
 * **Every photograph is square, and none is refused for not being.** OPS §4.3
 * asked for "≤2 MB, square" and B2b recorded that "square" had no sentence, no
 * code and no source. `./avatar-image.ts` centre-crops instead, which answers
 * the requirement without inventing a refusal nobody wrote — see that module.
 */
export async function storeProposedAvatar(file: UploadedFile): Promise<string> {
  if (!AVATAR_TYPES.has(file.type)) {
    throw new ValidationFailed(refusalFor(file.type), "avatar");
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new ValidationFailed("file_too_large", "avatar");
  }

  const processed = await processAvatar(new Uint8Array(await file.arrayBuffer()));

  const key = objectKey("avatars", "webp");
  await objectStore().put(key, processed, "image/webp");
  // The key, and only the key. An address is derived from it wherever one is
  // needed (`./avatar-url.ts`); returning a URL here as well is what used to
  // bake `S3_PUBLIC_URL` into every row that stored one.
  return key;
}

/**
 * The whole of proposing a photograph: store the bytes, record the proposal,
 * and leave nothing behind on either outcome.
 *
 * The three deletions this function is responsible for are all here rather than
 * split across a server action, because each of them is easy to leave out and
 * none of them fails loudly when it is:
 *
 * 1. **The superseded object.** A second proposal replaces the first, and the
 *    first one's image is then referenced by nothing. `proposeAvatarChange`
 *    returns its key; this deletes it, after the commit.
 * 2. **This proposal's own object, when the command refuses.** The put has
 *    already happened by then and the transaction has definitely rolled back, so
 *    the object is definitively unreferenced. Deleting it here is the one
 *    compensation that is unambiguously safe, because there is no committed row
 *    that could point at it.
 * 3. **Nothing at all on success.** The image has to outlive this call — a
 *    manager looks at it while deciding.
 *
 * **The compensating delete cannot mask the refusal that caused it.** If the
 * delete in (2) fails as well, the original error is what is rethrown: it is the
 * one the caller can act on and the one that carries a sentence a reader reads.
 * The cost is one orphaned object, which is the same residual this module
 * accepts everywhere else, and it is preferred over a storage fault replacing a
 * `not_permitted` in a form's error banner.
 */
export async function proposeAvatar(
  shelfSlug: string,
  /** Omitted is "the signed-in reader's own" — see the command's own note. */
  membershipId: string | undefined,
  file: UploadedFile,
): Promise<void> {
  const avatarObject = await storeProposedAvatar(file);

  let superseded: string | null;
  try {
    ({ supersededAvatarObject: superseded } = await submitCommand(
      shelfSlug,
      proposeAvatarChange,
      { membershipId, avatarObject },
    ));
  } catch (err) {
    try {
      await discardAvatarObject(avatarObject);
    } catch {
      // See above: the refusal is the answer, one orphan is the price.
    }
    throw err;
  }

  await discardAvatarObject(superseded);
}

/**
 * Deletes an object the database no longer references. Never called before a
 * commit — see this module's header.
 *
 * `null` is the ordinary case (a request that proposed no photograph) and is a
 * no-op rather than a caller's job to check, so that "delete whatever the
 * command handed back" is one line at every call site and cannot be written as
 * an `if` somebody forgets.
 */
export async function discardAvatarObject(key: string | null): Promise<void> {
  if (key === null) return;
  await objectStore().delete(key);
}

/**
 * Runs a command that decides a profile-change request, then deletes the
 * photograph it orphaned.
 *
 * **All three decisions**, and the third is the one that matters most.
 * `RejectProfileChange` and `CancelProfileChange` return the *proposed* image,
 * which nothing points at once the request is refused; `ApproveProfileChange`
 * returns the image it *replaced*, which nothing points at once the new one is
 * in force. Three different objects, one field name, one call site — because
 * the question a surface has to answer is the same in all three cases and
 * getting it wrong is silent in all three.
 *
 * Composing the two steps here rather than in each of the screens a later slice
 * builds is what makes the ordering structural: a caller cannot delete before
 * the commit, because `submitCommand` has already returned by the time the
 * delete is reachable, and cannot forget the delete, because there is no other
 * shipped way to call these commands from a surface.
 */
export async function decideAndDiscardAvatar<I>(
  shelfSlug: string,
  command: Command<I, { avatarObject: string | null }>,
  input: I,
): Promise<void> {
  const { avatarObject } = await submitCommand(shelfSlug, command, input);
  await discardAvatarObject(avatarObject);
}
