<?php

declare(strict_types=1);

namespace App\Support\Members;

use App\Exceptions\RuleViolated;
use GdImage;
use Throwable;

/**
 * The image half of an avatar upload: decode, EXIF-rotate, centre-crop to a
 * square, resize to 512×512, re-encode, and drop every scrap of metadata.
 * Phase 3c-i Task 8, spec D6. Port of old_next/src/lib/avatar-image.ts.
 *
 * Separate from App\Support\Members\AvatarStorage — which owns the policy,
 * the disk and the ordering against a transaction — so that what happens to
 * the PIXELS can be tested without a database or a filesystem, and so that
 * AvatarStorage keeps one job.
 *
 * ── gd, AND NOT BECAUSE IT WAS THE CONVENIENT CHOICE ─────────────────────
 *
 * docs/HOSTING.md row 3 came back on 2026-09-01: `php -m` on the real
 * cPanel host returns `exif`, `fileinfo`, `gd`, `zip`, and **`imagick` is
 * ABSENT**. So there is no imagick path to prefer and none is written here.
 * `exif` being present is what makes the rotation below possible at all,
 * and this task added it to docker/php/Dockerfile and to both CI workflows,
 * which installed `gd` without it — the shape where the code works in
 * production and fails everywhere it is tested.
 *
 * WHETHER THE HOST'S gd CAN ENCODE WebP IS THE ONE THING THE SURVEY DID NOT
 * ANSWER, so it is asked at RUNTIME — `gd_info()['WebP Support']` — and a
 * gd built without it falls back to JPEG rather than failing. Assuming it
 * would be a failure that appears only in production, which is precisely
 * the shape the survey exists to prevent. The chosen format travels back to
 * the caller with the bytes, because the object key's extension and the
 * stored content type both have to agree with what was actually encoded.
 *
 * ── Why each step is there ───────────────────────────────────────────────
 *
 * **THE DIMENSIONS ARE READ BEFORE THE BITMAP IS ALLOCATED.**
 * `getimagesizefromstring()` parses the header only; `imagecreatefromstring()`
 * allocates width × height × 4 bytes. A few hundred kilobytes of
 * pathological PNG decodes to a gigabyte, so the order of those two calls is
 * the whole of the decompression-bomb defence — a real exposure created by
 * raising the byte cap to 5 MiB. sharp closed it with its own
 * `limitInputPixels`; gd has no equivalent, so AvatarLimits::MAX_PIXELS is
 * checked by hand, first.
 *
 * **THE EXIF ROTATION IS APPLIED AND THEREBY CONSUMED.** A telephone records
 * a portrait photograph as landscape pixels plus an orientation tag; without
 * this the stored crop is sideways, which is the single most common way an
 * avatar upload ships broken. gd writes no EXIF, so applying the tag here
 * also means the stored file needs no tag to be read correctly by anything.
 *
 * **THE CENTRE CROP IS HOW "SQUARE" IS SATISFIED.** OPS §4.3 asks for square
 * photographs, and a content-type allow-list cannot produce one. The shorter
 * edge is taken whole and the overflow on the longer edge is trimmed equally
 * from both sides — for a photograph of a person, the middle is where the
 * person is. Nothing is refused for not being square, which matters because
 * "square" never had a Vietnamese sentence and a refusal a reader cannot be
 * told the reason for is worse than no refusal.
 *
 * **THE METADATA IS STRIPPED, AS A CHILD-SAFETY CONTROL.** This is not an
 * optimisation. The readers of a parish library are largely children, the
 * avatar disk is public-read to anyone holding the URL, and a photograph
 * straight off a telephone carries the GPS coordinates of the house it was
 * taken in. gd rebuilds the image from raw pixels and emits no EXIF, IPTC or
 * XMP of any kind — which is what makes the strip structural rather than a
 * call somebody could forget. The pin is
 * tests/Unit/Members/AvatarImageTest.php, which builds a JPEG carrying real
 * GPS tags, ASSERTS THEY ARE THERE, and only then runs this function: a test
 * that merely asserted their absence in the output would pass on an
 * unstripped file too, because exif_read_data() returns false both when
 * metadata is absent and when it cannot parse the format at all.
 *
 * **THE CATCH IS THE `invalid_image` CHECK.** It is a DECODE, not a
 * content-type comparison — the header a browser attached is not the whole
 * of the claim, and the content-type-only version of this gate was the
 * earlier and weaker design. The catch is deliberately broad rather than
 * narrowed: gd offers no reliable way to tell "not an image" from an
 * internal fault, and "Tệp này không phải là ảnh hợp lệ." is genuinely the
 * right sentence for the common case either way. The original throwable is
 * carried through as `$previous`, so whoever debugs a spike in this refusal
 * still has the real exception to read.
 */
final class AvatarImage
{
    /**
     * @return array{bytes: string, mime: string, extension: string}
     */
    public static function process(string $input): array
    {
        // Read BEFORE the try, and the pixel bound with it: a bomb must be
        // refused by a measurement, not by an out-of-memory fault landing
        // in a catch. See this class's header.
        $size = @getimagesizefromstring($input);

        if ($size === false) {
            throw new RuleViolated('invalid_image');
        }

        if ($size[0] < 1 || $size[1] < 1 || $size[0] * $size[1] > AvatarLimits::MAX_PIXELS) {
            throw new RuleViolated('invalid_image');
        }

        try {
            return self::render($input);
        } catch (RuleViolated $refusal) {
            // Already a named refusal with its own sentence — re-wrapping
            // it as invalid_image would replace an accurate answer with a
            // vaguer one.
            throw $refusal;
        } catch (Throwable $cause) {
            throw new RuleViolated('invalid_image', $cause);
        }
    }

    /**
     * @return array{bytes: string, mime: string, extension: string}
     */
    private static function render(string $input): array
    {
        $source = @imagecreatefromstring($input);

        if ($source === false) {
            throw new RuleViolated('invalid_image');
        }

        try {
            $source = self::applyOrientation($source, self::orientationOf($input));
            $square = self::centreCropped($source);
        } finally {
            imagedestroy($source);
        }

        try {
            return self::encode($square);
        } finally {
            imagedestroy($square);
        }
    }

    /**
     * The EXIF orientation tag, or 1 when there is none to read.
     *
     * `exif_read_data()` wants a stream, and the `data://` wrapper is the
     * one that needs no temporary file on disk — a photograph that never
     * touches a writable path cannot be left behind by a failure between
     * two statements. It returns false both for an image with no metadata
     * and for a format it cannot parse (every WebP and AVIF), and both of
     * those mean the same thing here: nothing to rotate by.
     *
     * The `@` is for the second case rather than the first: a malformed
     * APP1 segment raises a warning, and a warning is not a reason to
     * refuse a photograph that gd is about to decode perfectly well.
     */
    private static function orientationOf(string $input): int
    {
        if (! function_exists('exif_read_data')) {
            return 1;
        }

        $exif = @exif_read_data('data://image/jpeg;base64,'.base64_encode($input));

        if (! is_array($exif) || ! isset($exif['Orientation']) || ! is_numeric($exif['Orientation'])) {
            return 1;
        }

        return (int) $exif['Orientation'];
    }

    /**
     * The eight EXIF orientations, spelled out.
     *
     * `imagerotate()` turns COUNTER-clockwise, and the tag describes the
     * rotation needed to correct the image — so orientation 6, "the camera
     * was held rotated 90° clockwise", is corrected by 270 here rather than
     * by 90. Getting that sign wrong is a photograph upside down rather
     * than a crash, which is why it is written out one arm per value.
     *
     * The four mirrored orientations (2, 4, 5, 7) are genuinely rare, and
     * are handled rather than folded into "no rotation" because a mirrored
     * face is a visibly wrong photograph and the two lines cost nothing.
     */
    private static function applyOrientation(GdImage $image, int $orientation): GdImage
    {
        // imagerotate() is typed as GdImage|false, and the false arm is
        // unreachable for a live handle and a numeric angle — but a refusal
        // is the honest answer if the engine ever returns one, and it is
        // the same sentence a decode failure earns.
        $rotate = static function (GdImage $img, int $degrees): GdImage {
            $rotated = imagerotate($img, $degrees, 0);
            imagedestroy($img);

            if ($rotated === false) {
                throw new RuleViolated('invalid_image');
            }

            return $rotated;
        };

        return match ($orientation) {
            2 => self::flipped($image, IMG_FLIP_HORIZONTAL),
            3 => $rotate($image, 180),
            4 => self::flipped($image, IMG_FLIP_VERTICAL),
            5 => self::flipped($rotate($image, 270), IMG_FLIP_HORIZONTAL),
            6 => $rotate($image, 270),
            7 => self::flipped($rotate($image, 90), IMG_FLIP_HORIZONTAL),
            8 => $rotate($image, 90),
            default => $image,
        };
    }

    private static function flipped(GdImage $image, int $mode): GdImage
    {
        imageflip($image, $mode);

        return $image;
    }

    /**
     * The centre square, scaled to AvatarLimits::EDGE.
     *
     * FLATTENED ONTO WHITE rather than kept transparent: the JPEG fallback
     * below cannot carry an alpha channel at all, and a PNG avatar whose
     * transparent background became black on a host without WebP would be a
     * defect visible only in production. One background for both encoders
     * is one behaviour to reason about.
     */
    private static function centreCropped(GdImage $source): GdImage
    {
        $width = imagesx($source);
        $height = imagesy($source);
        $side = min($width, $height);

        $square = imagecreatetruecolor(AvatarLimits::EDGE, AvatarLimits::EDGE);
        $white = imagecolorallocate($square, 255, 255, 255);

        if ($white === false) {
            throw new RuleViolated('invalid_image');
        }

        imagefilledrectangle($square, 0, 0, AvatarLimits::EDGE, AvatarLimits::EDGE, $white);

        imagecopyresampled(
            $square, $source,
            0, 0,
            intdiv($width - $side, 2), intdiv($height - $side, 2),
            AvatarLimits::EDGE, AvatarLimits::EDGE,
            $side, $side,
        );

        return $square;
    }

    /**
     * WebP when the host's gd can encode it, JPEG when it cannot — asked at
     * runtime, never assumed. See this class's header.
     *
     * @return array{bytes: string, mime: string, extension: string}
     */
    private static function encode(GdImage $image): array
    {
        $webp = (gd_info()['WebP Support'] ?? false) === true;

        ob_start();
        $encoded = $webp
            ? imagewebp($image, null, AvatarLimits::QUALITY)
            : imagejpeg($image, null, AvatarLimits::QUALITY);
        $bytes = (string) ob_get_clean();

        if ($encoded === false || $bytes === '') {
            throw new RuleViolated('invalid_image');
        }

        return $webp
            ? ['bytes' => $bytes, 'mime' => 'image/webp', 'extension' => 'webp']
            : ['bytes' => $bytes, 'mime' => 'image/jpeg', 'extension' => 'jpg'];
    }
}
