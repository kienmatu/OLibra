<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Image fixtures, built in the test rather than committed as files.
 *
 * THERE ARE NO IMAGE FIXTURES IN THIS REPOSITORY and this class is why
 * there still are none: a photograph checked into git is a binary nobody
 * can review, whose provenance nobody can state, and — for the GPS case
 * below — a real person's coordinates in a public repository. Everything
 * here is synthesised from gd plus a few bytes of hand-written TIFF.
 *
 * ── The EXIF builder, and why it exists at all ───────────────────────────
 *
 * gd can WRITE no metadata whatsoever, which is exactly the property
 * App\Support\Members\AvatarImage relies on for its metadata strip — and
 * which means gd cannot produce the INPUT that proves the strip works
 * either. `withExif()` below splices a real APP1 segment into a real JPEG,
 * so `exif_read_data()` reads genuine tags out of it.
 *
 * That is not a convenience. `exif_read_data()` returns `false` both when a
 * file carries no metadata AND when it cannot parse the format at all — it
 * cannot parse a WebP, for instance — so a test that only asserted the
 * absence of GPS in the OUTPUT would pass on a completely unstripped file
 * and on every WebP regardless. The pin has to be present-then-absent: read
 * the coordinates out of the input first, assert they are there, and only
 * then run the pipeline. Without that first half it is a guard that cannot
 * fail.
 */
final class Images
{
    /**
     * A JPEG of the given size, drawn rather than random so its bytes
     * compress predictably.
     */
    public static function jpeg(int $width, int $height): string
    {
        return self::encode(self::canvas($width, $height), 'jpeg');
    }

    /** A PNG of the given size. */
    public static function png(int $width, int $height): string
    {
        return self::encode(self::canvas($width, $height), 'png');
    }

    /**
     * A JPEG of genuinely random bytes, for measuring what an accepted
     * upload actually costs — a drawn gradient compresses to almost
     * nothing and would flatter the number.
     */
    public static function noisyJpeg(int $width, int $height, int $seed = 1): string
    {
        $image = imagecreatetruecolor($width, $height);

        // mt_srand for a REPRODUCIBLE fixture: a size assertion against a
        // different random image every run is a flake waiting to happen.
        mt_srand($seed);
        for ($y = 0; $y < $height; $y++) {
            for ($x = 0; $x < $width; $x++) {
                imagesetpixel($image, $x, $y, mt_rand(0, 0xFFFFFF));
            }
        }
        mt_srand();

        return self::encode($image, 'jpeg');
    }

    /**
     * The same JPEG with a hand-built APP1 segment carrying an EXIF
     * orientation tag and, optionally, a GPS position.
     *
     * The segment is inserted immediately after the SOI marker, which is
     * where a camera puts it and where `exif_read_data()` looks.
     *
     * @param  int  $orientation  one of the eight EXIF orientation values
     * @param  bool  $gps  whether to attach a GPS IFD — 21°01'40"N,
     *                     105°51'00"E, which is a public square in Hà Nội and
     *                     nobody's house
     */
    public static function jpegWithExif(int $width, int $height, int $orientation = 1, bool $gps = false): string
    {
        $jpeg = self::jpeg($width, $height);
        $app1 = self::app1($orientation, $gps);

        return substr($jpeg, 0, 2).$app1.substr($jpeg, 2);
    }

    /**
     * The APP1 segment: marker, length, the "Exif\0\0" identifier, and a
     * complete little-endian TIFF holding IFD0 and (optionally) a GPS IFD.
     *
     * EVERY OFFSET IS RELATIVE TO THE START OF THE TIFF HEADER, which is
     * what makes the layout below arithmetic rather than guesswork:
     *
     *   0   TIFF header            8 bytes
     *   8   IFD0                   2 + 12n + 4
     *   ..  GPS IFD                2 + 48 + 4    (four entries)
     *   ..  GPS latitude           24 bytes      (three RATIONALs)
     *   ..  GPS longitude          24 bytes
     */
    private static function app1(int $orientation, bool $gps): string
    {
        // "II" little-endian, magic 42, offset of the first IFD.
        $tiff = 'II'.pack('v', 42).pack('V', 8);

        $entries = [
            // Orientation (0x0112), SHORT, one value, stored inline and
            // padded to the four bytes an entry's value field always has.
            self::entry(0x0112, 3, 1, pack('v', $orientation).pack('v', 0)),
        ];

        $gpsBlock = '';

        if ($gps) {
            $ifd0Size = 2 + (12 * (count($entries) + 1)) + 4;
            $gpsOffset = 8 + $ifd0Size;
            $latOffset = $gpsOffset + 2 + (12 * 4) + 4;
            $lonOffset = $latOffset + 24;

            // GPSInfoIFDPointer (0x8825), LONG, one value.
            $entries[] = self::entry(0x8825, 4, 1, pack('V', $gpsOffset));

            $gpsEntries =
                // GPSLatitudeRef — two ASCII bytes, inline.
                self::entry(0x0001, 2, 2, "N\0\0\0").
                // GPSLatitude — three RATIONALs, out of line.
                self::entry(0x0002, 5, 3, pack('V', $latOffset)).
                self::entry(0x0003, 2, 2, "E\0\0\0").
                self::entry(0x0004, 5, 3, pack('V', $lonOffset));

            $gpsBlock =
                pack('v', 4).$gpsEntries.pack('V', 0).
                // 21° 01' 40" N
                pack('VVVVVV', 21, 1, 1, 1, 40, 1).
                // 105° 51' 00" E
                pack('VVVVVV', 105, 1, 51, 1, 0, 1);
        }

        $ifd0 = pack('v', count($entries)).implode('', $entries).pack('V', 0);
        $tiff .= $ifd0.$gpsBlock;

        $payload = "Exif\0\0".$tiff;

        // The length field counts itself but not the two marker bytes.
        return "\xFF\xE1".pack('n', strlen($payload) + 2).$payload;
    }

    /** One 12-byte IFD entry: tag, type, count, and four bytes of value. */
    private static function entry(int $tag, int $type, int $count, string $value): string
    {
        return pack('v', $tag).pack('v', $type).pack('V', $count).$value;
    }

    /**
     * A drawn canvas — a diagonal two-tone split, so a rotation or a crop
     * is visible in the pixels rather than only in the dimensions.
     */
    private static function canvas(int $width, int $height): \GdImage
    {
        $image = imagecreatetruecolor($width, $height);
        $red = (int) imagecolorallocate($image, 200, 40, 40);
        $blue = (int) imagecolorallocate($image, 40, 40, 200);

        imagefilledrectangle($image, 0, 0, $width, $height, $red);
        imagefilledpolygon($image, [0, 0, $width, 0, 0, $height], $blue);

        return $image;
    }

    private static function encode(\GdImage $image, string $format): string
    {
        ob_start();
        if ($format === 'png') {
            imagepng($image);
        } else {
            imagejpeg($image, null, 92);
        }
        $bytes = (string) ob_get_clean();
        imagedestroy($image);

        return $bytes;
    }
}
