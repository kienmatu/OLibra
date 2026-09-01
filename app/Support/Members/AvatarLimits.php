<?php

declare(strict_types=1);

namespace App\Support\Members;

/**
 * The facts about an avatar upload that both sides of the network need —
 * Phase 3c-i Task 8, spec D6. Port of
 * old_next/src/lib/avatar-limits.ts.
 *
 * SEPARATE FROM AvatarStorage AND AvatarImage for the reason the reference
 * separates the same three: the profile screen states the limit to the
 * reader and the server enforces it, and two hand-kept copies of a number
 * is how a screen ends up promising something the server refuses. These
 * constants are the single source, read by the Form Request, by
 * AvatarStorage's gate and — through Inertia — by the file input's own
 * `accept` attribute.
 *
 * ── HEIC IS NOT IN ACCEPT, AND THAT ABSENCE IS WHAT MAKES iPHONES WORK ───
 *
 * The list below is handed to a browser as the file input's `accept`.
 * iOS Safari transcodes a HEIC photograph to JPEG on upload *because* this
 * list omits `image/heic`; adding it tells iOS to send the original HEVC
 * bytes instead, which nothing in this application can decode. An attribute
 * that looks like a convenience filter is in fact the whole iPhone path.
 * Its refusal, for a hand-rolled request that sends one anyway, is
 * `heic_not_supported` — a separate sentence from `invalid_image`, because
 * the reader is holding a perfectly good picture of their child and telling
 * them it is not an image would be a false statement.
 *
 * `image/avif` IS here and `image/heic` is not, and the difference is the
 * codec rather than the container: AVIF is AV1 and royalty-free, so the
 * host's gd decodes it.
 *
 * `image/jpg` is not here either — it is not a real media type (browsers
 * send `image/jpeg` for a `.jpg`) and accepting a type nothing emits would
 * only widen what a hand-rolled request may claim to be.
 */
final class AvatarLimits
{
    /**
     * OPS §4.3's `file_too_large`, read as the binary megabyte because that
     * is what every file manager a volunteer might check the size in
     * reports.
     *
     * What this bounds is the UPLOAD, not what is kept: AvatarImage
     * re-encodes every accepted photograph to a 512×512 square of a few
     * tens of kilobytes. docker/php/Dockerfile's `upload_max_filesize` and
     * `post_max_size` both sit ABOVE this number on purpose, so that
     * anything between the two is refused by this application with a
     * Vietnamese sentence rather than by PHP with an empty `$_FILES`.
     */
    public const int MAX_BYTES = 5 * 1024 * 1024;

    /**
     * The decoded-pixel ceiling, and it is what stops a decompression bomb
     * now that the byte cap is 5 MiB.
     *
     * A few hundred kilobytes of highly compressible PNG can decode to a
     * gigabyte of bitmap, and gd — unlike sharp, which carries its own
     * `limitInputPixels` — offers no such bound. AvatarImage reads the
     * dimensions with `getimagesizefromstring()`, which parses the header
     * WITHOUT allocating the bitmap, and refuses before `imagecreatefrom*`
     * is ever reached.
     *
     * 50 megapixels is comfortably above any telephone camera and, at four
     * bytes a pixel, comfortably below the container's 512 MB memory limit.
     */
    public const int MAX_PIXELS = 50_000_000;

    /** 4× the 72px an avatar is drawn at, 8× the 64px on the approval screens. */
    public const int EDGE = 512;

    /** Encoder quality. High enough that a face is not visibly degraded at 512px. */
    public const int QUALITY = 82;

    /**
     * The content types accepted, ordered, for the file input's `accept`
     * attribute as well as the server's own gate.
     *
     * @var list<string>
     */
    public const array ACCEPT = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/avif',
    ];

    /**
     * The two types that earn `heic_not_supported` rather than
     * `invalid_image` — see this class's header.
     *
     * @var list<string>
     */
    public const array HEIC = ['image/heic', 'image/heif'];

    /** The `accept` attribute, spelled once, for the file input. */
    public static function acceptAttribute(): string
    {
        return implode(',', self::ACCEPT);
    }
}
