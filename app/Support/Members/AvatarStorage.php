<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The avatar's surface half — Phase 3c-i Task 8, spec D6. Port of
 * old_next/src/lib/avatar.ts. The ONLY place in this application that
 * decides whether an uploaded file is acceptable, and the only place that
 * writes or deletes one.
 *
 * THE PORT HAD NO UPLOAD PATH AT ALL before this file: `config/filesystems.php`
 * was stock Laravel, there was no `Storage::` or `UploadedFile` anywhere
 * under app/, and `avatar_object` existed only as a column read and a
 * guest-write guard. So this is a disk, a write and a delete as well as a
 * gate.
 *
 * ── The three refusals, and why each is a separate literal throw ─────────
 *
 * OPS §4.3 lists three failure modes for a proposed photograph and they are
 * all facts about bytes:
 *
 *  - `heic_not_supported` — a real photograph in a codec nothing here can
 *    decode. Its own sentence, because "Tệp này không phải là ảnh hợp lệ."
 *    would be a false statement shown to somebody holding a perfectly good
 *    picture of their child. See AvatarLimits on why HEIC is deliberately
 *    absent from the `accept` list in the first place.
 *  - `file_too_large` — AvatarLimits::MAX_BYTES, 5 MiB.
 *  - `invalid_image` — a DECODE failure raised from AvatarImage's own catch,
 *    not a content-type mismatch. The allow-list below is a cheap first
 *    pass; the encoder is the actual check.
 *
 * THEY ARE WRITTEN AS THREE LITERAL THROWS AND NEVER AS A TERNARY.
 * tests/Unit/Catalogue/RuleViolatedCodesHaveSentencesTest.php:55 matches a
 * refusal whose first argument is a quoted literal and is blind to one that
 * is an EXPRESSION, so raising these through a ternary would register
 * NEITHER code with the census that pins every code to its Vietnamese
 * sentence. (This paragraph is deliberately written without an example of
 * the shape it describes: that census reads raw source, comments included,
 * so an illustration here would mint a code of its own — measured, it
 * did.) The reference spells this as a `refusalFor()` returning one of two
 * strings; that shape does not survive the port.
 *
 * ── The key, and the one name that is not arbitrary ──────────────────────
 *
 * A fresh UUID plus the extension of whatever was actually encoded. NEVER
 * the uploaded filename, which is attacker-controlled and, for a Vietnamese
 * reader, frequently full of diacritics that have no business in a URL; and
 * never ending `.html`, on a disk served as static files.
 *
 * A GUEST — OR A READER — MAY NEVER *NAME* A STORAGE KEY.
 * RegistrationController.php:94 records the rule for registration and
 * ProposeProfileChangeRequest records it for the proposal form; this class
 * is what makes it true on the one path that legitimately sets the column:
 * the key is minted here, from a UUID, and no caller supplies it.
 *
 * ── The ordering, which is the whole of what this gets right or wrong ────
 *
 * A PUT HAPPENS BEFORE THE TRANSACTION OPENS, because OPS §4.3 requires the
 * image to exist while the request is pending — a manager looks at it while
 * deciding. The failure that leaves is a put followed by a command that
 * refuses, which the controller compensates by discarding what it wrote
 * before rethrowing: at that point the transaction has definitely rolled
 * back and the object is definitively unreferenced.
 *
 * A DELETE HAPPENS AFTER THE TRANSACTION COMMITS, NEVER INSIDE IT. Every
 * caller of discard() sits after a `DB::transaction()` has RETURNED, which
 * is the ordering expressed as control flow rather than as a comment.
 * Deleting while the transaction is still open destroys an image that a
 * still-live request points at for as long as the commit that follows might
 * fail — a reader's photograph gone, and a request that can never be
 * approved into anything.
 *
 * THE RESIDUAL FAILURE IS NAMED RATHER THAN HIDDEN: the commit succeeds and
 * the delete fails, orphaning one object. That costs storage rather than
 * correctness, it is retryable, and deleting a key that is not there is not
 * an error — so it is strictly the better half of the trade, and it is the
 * half chosen deliberately. docs/known-gaps.md carries it.
 */
final class AvatarStorage
{
    /** The disk config/filesystems.php declares for exactly this. */
    public const string DISK = 'avatars';

    /**
     * Applies the three refusals and puts the processed bytes.
     *
     * The size is read off the upload's own metadata rather than after
     * `file_get_contents`, so an oversize file is refused without a second
     * copy of it in this process. That is not the same as refusing it
     * before it arrives — by the time a Form Request holds an UploadedFile,
     * PHP has already written the body to a temporary file. What refuses a
     * body nobody should buffer is `upload_max_filesize` in
     * docker/php/Dockerfile, upstream of every line of application code and
     * set ABOVE this cap on purpose, so the sentence a reader sees for
     * anything in between is this one.
     *
     * @return string the storage key — and only the key. A URL is derived
     *                from it wherever one is needed, which is what stops an
     *                absolute address being baked into a database row.
     */
    public function store(UploadedFile $file): string
    {
        $type = strtolower($file->getClientMimeType());

        // Literal, not a ternary — see this class's header.
        if (in_array($type, AvatarLimits::HEIC, true)) {
            throw new RuleViolated('heic_not_supported');
        }

        if (! in_array($type, AvatarLimits::ACCEPT, true)) {
            throw new RuleViolated('invalid_image');
        }

        if ($file->getSize() > AvatarLimits::MAX_BYTES) {
            throw new RuleViolated('file_too_large');
        }

        $path = $file->getRealPath();
        $bytes = $path === false ? false : @file_get_contents($path);

        if ($bytes === false) {
            throw new RuleViolated('invalid_image');
        }

        $processed = AvatarImage::process($bytes);

        $key = Str::uuid()->toString().'.'.$processed['extension'];

        $this->disk()->put($key, $processed['bytes'], [
            'visibility' => 'public',
            'ContentType' => $processed['mime'],
        ]);

        return $key;
    }

    /**
     * Deletes an object the database no longer references. Never called
     * before a commit — see this class's header.
     *
     * NULL IS THE ORDINARY CASE and a no-op rather than a caller's job to
     * check, so that "delete whatever the command handed back" is one line
     * at every call site and cannot be written as an `if` somebody forgets.
     */
    public function discard(?string $key): void
    {
        if ($key === null || trim($key) === '') {
            return;
        }

        $this->disk()->delete($key);
    }

    /**
     * The address a browser fetches, derived from the key at READ time.
     *
     * Null in, null out: "this person has no photograph" is the ordinary
     * case on a shelf that has just opened, and every screen would
     * otherwise write the same guard.
     */
    public function url(?string $key): ?string
    {
        if ($key === null || trim($key) === '') {
            return null;
        }

        return $this->disk()->url($key);
    }

    public function disk(): Filesystem
    {
        return Storage::disk(self::DISK);
    }
}
