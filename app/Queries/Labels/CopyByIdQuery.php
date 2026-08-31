<?php

namespace App\Queries\Labels;

use App\Models\BookCopy;

/**
 * Turns a scanned copy id back into a copy — OPS §3.3's other half of the
 * label round trip. Decoding the printed payload into an id happens
 * outside the domain, in App\Support\Qr\LabelPayload::uuidFrom() (Task
 * 4); this query never sees the payload, only the id the caller already
 * decoded, so the label format can change without this query changing.
 *
 * DELIBERATELY NOT MANAGER-ONLY. OPS §3.3, opened: "a reader scans a
 * book on the shelf to ask for it (§16.1), and RLS is what keeps another
 * parish's sticker unresolvable." In this port BookshelfScope stands in
 * for RLS — tenancy, not role, is what makes a foreign sticker resolve
 * to nothing. No role check belongs in this query.
 *
 * RETURNS null RATHER THAN THROWING. A scan that finds nothing —
 * unknown id, malformed id, another shelf's copy, a soft-deleted copy —
 * is an ordinary outcome for a reader pointing a camera at a shelf, not
 * an exceptional one. The scanner (Task 12) hands this whatever came off
 * the camera.
 *
 * THE BOOK IS EAGER-LOADED, NOT JOINED — staying out of the blind spot
 * tests/Feature/Architecture/TenancyArchitectureTest's filter grep
 * documents at lines 145-146 and 182 for a join naming the tenant column
 * directly. A guard that excludes a copy orphaned by a soft-deleted book
 * (the same one TitlesForLabelsQuery and CopiesForLabelsQuery use) and
 * an eager load of the relation cover it below, in code.
 *
 * A malformed id (not a UUID at all) is not special-cased: book_copies.id
 * is VARCHAR(36) ascii_bin in this schema, so a non-uuid string is a
 * legal string comparison that simply matches nothing. No validation is
 * needed to make that answer null here — the schema already does it.
 */
final class CopyByIdQuery
{
    /**
     * @return array{copyId: string, code: string, state: string, bookId: string, slug: string, title: string, author: string}|null
     */
    public function run(string $copyId): ?array
    {
        $copy = BookCopy::query()
            ->whereHas('book')
            ->with('book')
            ->find($copyId);

        if (! $copy) {
            return null;
        }

        return [
            'copyId' => $copy->id,
            'code' => $copy->code,
            'state' => $copy->state->value,
            'bookId' => (string) $copy->book?->id,
            'slug' => (string) $copy->book?->slug,
            'title' => (string) $copy->book?->title,
            'author' => (string) $copy->book?->author,
        ];
    }
}
