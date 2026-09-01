<?php

use App\Exceptions\RuleViolated;
use App\Support\Members\AvatarImage;
use App\Support\Members\AvatarLimits;
use Tests\Support\Images;

/**
 * Phase 3c-i Task 8, spec D6 — the pixel half of an avatar upload, tested
 * without a database, a disk or an HTTP request.
 *
 * Three of the pipeline's jobs are REQUIREMENTS rather than optimisations,
 * and each has a test here for that reason: the centre crop is how OPS
 * §4.3's "square" is satisfied at all, the metadata strip is a child-safety
 * control, and `invalid_image` is a decode rather than a content-type
 * comparison.
 */
function avatarTempFile(string $bytes): string
{
    $path = tempnam(sys_get_temp_dir(), 'avatar').'.jpg';
    file_put_contents($path, $bytes);

    return $path;
}

it('centre-crops and re-encodes a landscape photograph to a 512×512 square', function () {
    // THE CROP IS HOW "SQUARE" IS SATISFIED. A content-type allow-list
    // cannot produce a square photograph, and nothing is refused for not
    // being one — OPS §4.3 asked for square while recording that "square"
    // had no Vietnamese sentence and no source, and "a refusal a reader
    // cannot be told the reason for is worse than no refusal".
    $out = AvatarImage::process(Images::jpeg(1200, 800));

    $size = getimagesizefromstring($out['bytes']);

    expect($size[0])->toBe(AvatarLimits::EDGE)
        ->and($size[1])->toBe(AvatarLimits::EDGE)
        // A portrait one too, so the crop is not accidentally reading only
        // one of the two edges.
        ->and(getimagesizefromstring(AvatarImage::process(Images::jpeg(600, 1500))['bytes']))
        ->toMatchArray([0 => AvatarLimits::EDGE, 1 => AvatarLimits::EDGE]);
});

it('strips the GPS coordinates a telephone photograph carries', function () {
    // THE CHILD-SAFETY CONTROL, and the one test in this file that cannot
    // be written the obvious way.
    //
    // exif_read_data() returns FALSE both when a file carries no metadata
    // and when it cannot parse the format at all — it cannot parse a WebP —
    // so `expect($exif)->toBeFalse()` on the OUTPUT passes on a completely
    // unstripped file and on every WebP regardless. It is a guard that
    // cannot fail. The pin has to be present-then-absent, which is why the
    // input is asserted first and the assertion below it is a pair.
    $input = Images::jpegWithExif(900, 600, gps: true);
    $inputPath = avatarTempFile($input);

    $before = exif_read_data($inputPath);

    // Half one: the coordinates really are in the input. Without this the
    // rest of the test proves nothing.
    expect($before)->toBeArray()
        ->and($before)->toHaveKey('GPSLatitude')
        ->and($before['GPSLatitudeRef'])->toBe('N')
        ->and($before['GPSLongitude'])->toBeArray();

    $out = AvatarImage::process($input);

    // Half two: they are not in the output. Asserted on the RAW BYTES as
    // well, because that assertion holds whatever the encoder chose — a
    // host whose gd cannot encode WebP produces a JPEG here, and a JPEG is
    // a format exif_read_data() can parse, so the two checks together
    // cover both branches.
    expect(str_contains($out['bytes'], 'Exif'))->toBeFalse()
        ->and(str_contains($out['bytes'], 'GPS'))->toBeFalse();

    if ($out['extension'] === 'jpg') {
        expect(exif_read_data(avatarTempFile($out['bytes'])))->toBeFalse();
    }
});

it('applies the EXIF orientation rather than storing the photograph sideways', function () {
    // A telephone records a portrait photograph as landscape pixels plus a
    // tag. Orientation 6 means "rotate 90° clockwise to correct", so the
    // 900×600 canvas below is really a 600×900 picture — and the crop that
    // results differs from the crop of the same pixels untagged.
    //
    // The output is square either way, so DIMENSIONS cannot pin this. The
    // pixels can: the fixture is a two-tone diagonal split, and rotating it
    // moves the blue triangle to a different corner.
    $rotated = AvatarImage::process(Images::jpegWithExif(900, 600, orientation: 6));
    $upright = AvatarImage::process(Images::jpegWithExif(900, 600, orientation: 1));

    expect($rotated['bytes'])->not->toBe($upright['bytes']);

    $corner = function (string $bytes): array {
        $image = imagecreatefromstring($bytes);
        $rgb = imagecolorat($image, 8, 8);
        imagedestroy($image);

        return [($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF];
    };

    // Top-left is the blue half of the untagged image; rotating a quarter
    // turn puts the red half there instead.
    [$ur, , $ub] = $corner($upright['bytes']);
    [$rr, , $rb] = $corner($rotated['bytes']);

    expect($ub)->toBeGreaterThan($ur)
        ->and($rr)->toBeGreaterThan($rb);
});

it('refuses a file that is not an image at all — a DECODE, not a header check', function () {
    // `invalid_image` is raised because the bytes cannot be decoded, so a
    // document cannot pass by wearing the right content type. The
    // content-type-only version of this gate was the earlier and weaker
    // design, and App\Support\Members\AvatarStorage's own allow-list is
    // only a cheap first pass in front of this.
    expect(fn () => AvatarImage::process('Đây rõ ràng không phải là một tấm ảnh.'))
        ->toThrow(RuleViolated::class, 'invalid_image');

    // Truncated JPEG: a real header, no usable image behind it.
    expect(fn () => AvatarImage::process(substr(Images::jpeg(40, 40), 0, 20)))
        ->toThrow(RuleViolated::class, 'invalid_image');
});

it('refuses a decompression bomb on its PIXEL count, before any bitmap is allocated', function () {
    // The exposure the 5 MiB byte cap creates: a small file whose DECODED
    // dimensions are absurd. gd has no limitInputPixels of its own, so
    // AvatarLimits::MAX_PIXELS is checked by hand — against the header,
    // read by getimagesizefromstring(), rather than against a bitmap that
    // allocating would already have cost the memory this refuses to spend.
    //
    // A hand-written PNG header claiming 40000×40000 (1.6 gigapixels) in
    // sixty-odd bytes. Decoding it is what must not happen; if the bound
    // were removed this test would not merely fail, it would exhaust the
    // container.
    $ihdr = pack('NN', 40000, 40000)."\x08\x02\x00\x00\x00";
    $chunk = pack('N', 13).'IHDR'.$ihdr.pack('N', crc32('IHDR'.$ihdr));
    $png = "\x89PNG\r\n\x1a\n".$chunk;

    expect(getimagesizefromstring($png))->toMatchArray([0 => 40000, 1 => 40000])
        ->and(fn () => AvatarImage::process($png))
        ->toThrow(RuleViolated::class, 'invalid_image');
});

it('keeps an accepted upload far below what was uploaded', function () {
    // Output size is governed by the ENCODE and not by the input, which is
    // what makes the 5 MiB cap affordable: it bounds the upload, not what
    // is kept. Measured against genuinely random pixels rather than a
    // gradient — a drawn fixture compresses to almost nothing and would
    // flatter the number into meaninglessness.
    $out = AvatarImage::process(Images::noisyJpeg(2000, 1500));

    expect(strlen($out['bytes']))->toBeLessThan(800 * 1024)
        ->and($out['mime'])->toBeIn(['image/webp', 'image/jpeg']);
});

it('falls back to JPEG when the host gd cannot encode WebP', function () {
    // docs/HOSTING.md row 3 answered `gd` present and `imagick` absent, but
    // left ONE capability unconfirmed: whether that gd was compiled with
    // WebP encode support. It is asked at runtime rather than assumed,
    // because a gd built without it would otherwise fail only in
    // production — precisely the shape the survey exists to prevent.
    //
    // This test cannot force the other branch (gd's capabilities are
    // compiled in), so what it pins is that the two halves AGREE: whatever
    // the encoder chose, the mime, the extension and the actual bytes all
    // say the same thing. A fallback that returned WebP bytes under a .jpg
    // key would be worse than no fallback.
    $out = AvatarImage::process(Images::jpeg(300, 300));

    $webp = (gd_info()['WebP Support'] ?? false) === true;

    expect($out['mime'])->toBe($webp ? 'image/webp' : 'image/jpeg')
        ->and($out['extension'])->toBe($webp ? 'webp' : 'jpg')
        ->and(getimagesizefromstring($out['bytes'])[2])
        ->toBe($webp ? IMAGETYPE_WEBP : IMAGETYPE_JPEG);
});
