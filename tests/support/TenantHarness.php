<?php

namespace Tests\Support;

use App\Models\Announcement;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\BorrowRequest;
use App\Models\Comment;
use App\Models\ConditionAssessment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\ParishUnit;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\TenantContext;

/**
 * Two shelves whose data collides on every axis uniqueness allows: same book
 * slug, same copy code, same member names, same announcement slug, same
 * parish unit name. If scoping ever leaks, these collisions make the leak
 * visible as a wrong count rather than a plausible row — spec §5.4's
 * "deliberately colliding data". Every one of Task 14's thirteen
 * trait-carrying models gets exactly one colliding row per shelf here, so
 * the isolation suite can be a census rather than a sample.
 */
final class TenantHarness
{
    /** @return array{a: Bookshelf, b: Bookshelf} */
    public static function twoCollidingShelves(): array
    {
        $shelves = [];

        foreach (['a' => 'dong-thap', 'b' => 'can-tho'] as $key => $slug) {
            $shelf = Bookshelf::query()->create([
                'slug' => $slug, 'name' => 'Tủ sách '.$slug, 'settings' => [],
            ]);

            $user = new User([
                'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
                'father_name' => 'Cha', 'mother_name' => 'Mẹ',
            ]);
            $user->save();

            $membership = Membership::query()->create([
                'bookshelf_id' => $shelf->id, 'user_id' => $user->id,
                'role' => 'reader', 'status' => 'active',
            ]);

            $book = Book::query()->create([
                'bookshelf_id' => $shelf->id,
                'title' => 'Dế Mèn Phiêu Lưu Ký', 'slug' => 'de-men-phieu-luu-ky',
            ]);

            $copy = BookCopy::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'code' => 'DT-0142',
            ]);

            ParishUnit::query()->create([
                'bookshelf_id' => $shelf->id, 'level' => 1, 'name' => 'Giáo họ Trung Tâm',
            ]);

            Loan::query()->create([
                'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id, 'book_id' => $book->id,
                'borrower_id' => $user->id, 'lent_by' => $user->id,
                'due_on' => now()->addDays(14)->toDateString(), 'status' => 'active',
            ]);

            BorrowRequest::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
                'member_id' => $user->id, 'status' => 'pending',
            ]);

            ConditionAssessment::query()->create([
                'bookshelf_id' => $shelf->id, 'copy_id' => $copy->id,
                'assessed_by' => $user->id, 'condition' => 'perfect',
            ]);

            Comment::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $book->id, 'author_id' => $user->id,
                'body' => 'Hay quá', 'status' => 'pending',
            ]);

            BookDonation::query()->create([
                'bookshelf_id' => $shelf->id, 'donor_membership_id' => $membership->id,
                'description' => 'Sách cũ tặng lại', 'status' => 'pending',
            ]);

            Notification::query()->create([
                'bookshelf_id' => $shelf->id, 'user_id' => $user->id,
                'kind' => 'welcome', 'payload' => [],
            ]);

            ProfileChangeRequest::query()->create([
                'bookshelf_id' => $shelf->id, 'user_id' => $user->id,
                'proposed_values' => ['phone' => '0900000000'], 'previous_values' => [],
                'status' => 'pending',
            ]);

            BookshelfContact::query()->create([
                'bookshelf_id' => $shelf->id, 'position' => 1, 'name' => 'Anh Ba',
            ]);

            Announcement::query()->create([
                'bookshelf_id' => $shelf->id,
                'title' => 'Thông báo', 'slug' => 'thong-bao',
                'body' => '<p>Nội dung</p>', 'body_text' => 'Nội dung',
            ]);

            $shelves[$key] = $shelf;
        }

        return $shelves;
    }

    public static function actAs(Bookshelf $shelf): void
    {
        app(TenantContext::class)->set($shelf, null);
    }
}
