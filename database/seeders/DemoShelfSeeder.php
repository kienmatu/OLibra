<?php

namespace Database\Seeders;

use App\Models\Announcement;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\BookDonation;
use App\Models\Bookshelf;
use App\Models\BorrowRequest;
use App\Models\Comment;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\ParishUnit;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\Clock;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;

/** The AGENTS.md demo fixtures — local development only, never production. */
class DemoShelfSeeder extends Seeder
{
    public function run(): void
    {
        // TenantContext's own docblock names this the sanctioned way for a
        // seeder to read shelf-scoped models: opt in BY NAME, then name
        // every bookshelf_id explicitly (done throughout below). Without
        // this, any SELECT through Book/Membership/BookCopy — including the
        // idempotency checks this method needs — throws the fail-closed
        // RuntimeException from BookshelfScope, since no request-bound
        // tenant exists in a console context.
        app(TenantContext::class)->actSystemWide();

        $shelf = Bookshelf::query()->firstOrCreate(
            ['slug' => 'dong-thap'],
            ['name' => 'Tủ sách Đồng Tháp', 'location' => 'Nhà xứ Đồng Tháp', 'settings' => []],
        );

        // The shelf above already needed firstOrCreate to survive a plain
        // `db:seed` re-run (outside migrate:fresh); these fixed usernames
        // need the same guard, or a second run throws a duplicate-key error
        // on `quanly` — reproduced before this fix.
        $manager = User::query()->where('username', 'quanly')->first()
            ?? User::factory()->withCredentials('quanly')->create([
                'saint_name' => 'Giuse', 'full_name' => 'Trần Minh',
            ]);
        $managerMembership = Membership::query()->firstOrCreate(
            ['bookshelf_id' => $shelf->id, 'user_id' => $manager->id],
            ['role' => 'manager', 'status' => 'active'],
        );

        User::query()->where('username', 'admin')->first()
            ?? User::factory()->superAdmin()->withCredentials('admin')->create([
                'saint_name' => 'Phêrô', 'full_name' => 'Nguyễn Văn Bình',
            ]);

        // $shelf->books() — the hasMany relation — rather than a
        // hand-written filter on the shelf column: TenancyArchitectureTest
        // confines that kind of filtering to BookshelfScope and
        // ResolveTenant only.
        //
        // Task 19: the four titles and the eight codes are now WRITTEN, not
        // rolled. BookFactory picks randomly among AGENTS.md's four titles
        // WITH replacement and BookCopyFactory draws its code from a faker
        // unique() pool, so a `migrate:fresh --seed` used to produce a
        // different shelf every time — the same title twice and another
        // missing, codes scattered over DT-0001..DT-9999. That was already
        // awkward for design work; it became load-bearing once the request
        // block below started naming two titles by name, and it is why
        // SeederTest can assert exact counts at all.
        if ($shelf->books()->doesntExist()) {
            $catalogue = [
                ['Dế Mèn Phiêu Lưu Ký', 'de-men-phieu-luu-ky', 'Tô Hoài'],
                ['Hoàng Tử Bé', 'hoang-tu-be', 'Antoine de Saint-Exupéry'],
                ['Totto-chan Bên Cửa Sổ', 'totto-chan-ben-cua-so', 'Kuroyanagi Tetsuko'],
                ['Đất Rừng Phương Nam', 'dat-rung-phuong-nam', 'Đoàn Giỏi'],
            ];
            $code = 0;
            foreach ($catalogue as [$title, $slug, $author]) {
                $book = Book::factory()->create([
                    'bookshelf_id' => $shelf->id, 'title' => $title,
                    'slug' => $slug, 'author' => $author,
                ]);
                for ($i = 0; $i < 2; $i++) {
                    BookCopy::factory()->create([
                        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
                        'code' => 'DT-'.str_pad((string) ++$code, 4, '0', STR_PAD_LEFT),
                    ]);
                }
            }
        }

        // Phase 1b: a nested two-level taxonomy so every picker, filter and
        // parish line is exercisable in dev — Giáo họ over Tổ, the two
        // words BR §5.6 names as the only ones a real parish has been seen
        // to use.
        $settings = $shelf->settings;
        if (! isset($settings['parish_taxonomy'])) {
            $settings['parish_taxonomy'] = [
                'levels' => 2, 'nested' => true,
                'level1_label' => 'Giáo họ', 'level2_label' => 'Tổ',
            ];
            $shelf->settings = $settings;
            $shelf->save();
        }

        $units = [];
        foreach (['Giáo họ Thánh Tâm', 'Giáo họ Mân Côi'] as $i => $name) {
            $units[$name] = ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 1, 'name' => $name],
                ['sort_order' => $i],
            );
        }
        foreach ([['Tổ 1', 'Giáo họ Thánh Tâm'], ['Tổ 2', 'Giáo họ Thánh Tâm'], ['Tổ 1', 'Giáo họ Mân Côi']] as $i => [$name, $parent]) {
            ParishUnit::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'level' => 2, 'name' => $name, 'parent_id' => $units[$parent]->id],
                ['sort_order' => $i],
            );
        }

        // Five demo readers (AGENTS.md's fixture people), one pending so the
        // approval queue renders.
        //
        // Têrêsa alone gets a username, and it is not decoration (Task 19,
        // beyond the brief's list, recorded in its report): UserFactory
        // deliberately mints readers with NO credentials — most readers are
        // children who never sign in, and users_credentials_paired makes it
        // both-or-neither — so before this line nobody on the demo shelf
        // except the manager and the super admin could sign in at all, and
        // every reader-side screen this phase shipped (the profile's
        // requests card, the notifications page, the header bell) was
        // unreachable by hand. She is the reader the hold and the
        // notification below belong to, so she is the one who has something
        // to look at. Same password as the manager's.
        $people = [
            ['Maria', 'Nguyễn Thị Lan', 'active', null], ['Giuse', 'Trần Minh', 'active', null],
            ['Têrêsa', 'Lê Ngọc Ánh', 'active', 'bandoc'], ['Anna', 'Phạm Thu Hà', 'active', null],
            ['Phêrô', 'Nguyễn Văn Bình', 'pending', null],
        ];
        foreach ($people as [$saint, $name, $status, $username]) {
            $factory = $username === null ? User::factory() : User::factory()->withCredentials($username);
            $person = User::query()->where('full_name', $name)->first()
                ?? $factory->create(['saint_name' => $saint, 'full_name' => $name, 'phone' => '0912345678', 'phone_missing_reason' => null]);
            Membership::query()->firstOrCreate(
                ['bookshelf_id' => $shelf->id, 'user_id' => $person->id],
                ['role' => 'reader', 'status' => $status, 'parish_unit_l1_id' => $units['Giáo họ Thánh Tâm']->id],
            );
        }

        // Task 14: a living shelf — one active and one overdue loan, so the
        // lend/return/overdue screens demo with real rows instead of empty
        // states. Respect the seeder's own name-reuse trap (known-gaps):
        // the manager above is 'Trần Minh', and the reader loop two blocks
        // up ALSO seeds a reader named 'Trần Minh' — a `where('full_name',
        // 'Trần Minh')->first()` lookup here would silently resolve to
        // whichever of those already exists rather than a demo borrower of
        // its own. Two NEW, distinctly-named readers instead, resolved by
        // their own full_name (unique in this seeder, so the lookup cannot
        // collide), never by reusing a name minted above.
        $activeBorrower = User::query()->where('full_name', 'Vũ Thị Đang Mượn')->first()
            ?? User::factory()->create([
                'saint_name' => 'Anna', 'full_name' => 'Vũ Thị Đang Mượn',
                'phone' => '0912345681', 'phone_missing_reason' => null,
            ]);
        Membership::query()->firstOrCreate(
            ['bookshelf_id' => $shelf->id, 'user_id' => $activeBorrower->id],
            ['role' => 'reader', 'status' => 'active', 'parish_unit_l1_id' => $units['Giáo họ Thánh Tâm']->id],
        );

        $overdueBorrower = User::query()->where('full_name', 'Bùi Văn Trễ Hạn')->first()
            ?? User::factory()->create([
                'saint_name' => 'Phaolô', 'full_name' => 'Bùi Văn Trễ Hạn',
                'phone' => '0912345682', 'phone_missing_reason' => null,
            ]);
        Membership::query()->firstOrCreate(
            ['bookshelf_id' => $shelf->id, 'user_id' => $overdueBorrower->id],
            ['role' => 'reader', 'status' => 'active', 'parish_unit_l1_id' => $units['Giáo họ Thánh Tâm']->id],
        );

        // Idempotency guard matching the books block above: a plain
        // `db:seed` re-run must not mint a second pair of loans (and try to
        // flip two more copies that may not exist as 'available' anymore).
        // `$shelf->loans()`/`$shelf->bookCopies()` — the hasMany relations,
        // not a hand-written shelf-column filter — matching the books
        // block's own `$shelf->books()` above: TenancyArchitectureTest
        // confines that kind of filtering to BookshelfScope/ResolveTenant
        // only.
        if ($shelf->loans()->doesntExist()) {
            $today = app(Clock::class)->today();
            $livingCopies = $shelf->bookCopies()
                ->where('state', 'available')
                ->orderBy('code')
                ->limit(2)
                ->get();

            if ($livingCopies->count() === 2) {
                [$activeCopy, $overdueCopy] = $livingCopies->all();

                $activeCopy->update(['state' => 'on_loan']);
                Loan::query()->create([
                    'bookshelf_id' => $shelf->id, 'copy_id' => $activeCopy->id, 'book_id' => $activeCopy->book_id,
                    'borrower_id' => $activeBorrower->id, 'lent_by' => $manager->id,
                    'due_on' => Carbon::parse($today)->addDays(10)->toDateString(), 'status' => 'active',
                ]);

                $overdueCopy->update(['state' => 'on_loan']);
                Loan::query()->create([
                    'bookshelf_id' => $shelf->id, 'copy_id' => $overdueCopy->id, 'book_id' => $overdueCopy->book_id,
                    'borrower_id' => $overdueBorrower->id, 'lent_by' => $manager->id,
                    'due_on' => Carbon::parse($today)->subDays(10)->toDateString(), 'status' => 'active',
                ]);
            }
        }

        // Task 19: a living queue and a living bell. Without these rows
        // /manage/borrow-requests is an empty state and no reader has a
        // notification to open, so the screens Phase 2a shipped demo as
        // blank pages on a shelf that visibly has books, loans and an
        // audit trail.
        //
        // Rows are INSERTED, not produced by running the commands — the
        // idiom of every block above, and the reason the audit block below
        // exists at all. So the approved row is written in the full
        // approval shape by hand (status, copy_id, hold_expires_at,
        // decided_by, decided_at, and the copy flipped to held), because
        // ApproveBorrowRequest writes them together in one transaction and
        // a demo row missing any of them renders a queue card that cannot
        // be handed over. Shape means the column set, not every value —
        // see the hold_expires_at note at that row.
        //
        // The books are looked up by TITLE, and created if the lookup
        // misses. On a fresh `migrate:fresh --seed` the lookup always hits,
        // because the catalogue block above now writes these titles by
        // name. The create is the fallback for a dev database seeded before
        // that change, whose four books were rolled at random and may hold
        // neither of the titles this block needs — the books guard is
        // `doesntExist()`, so a plain `db:seed` there will not re-seed the
        // catalogue and fix it.
        if ($shelf->borrowRequests()->doesntExist()) {
            $today = app(Clock::class)->today();

            // $shelf->books()/->bookCopies() — the hasMany relations, never a
            // hand-written shelf-column filter, matching every block above:
            // TenancyArchitectureTest confines that filtering to
            // BookshelfScope/ResolveTenant/AuditLogQuery, and actSystemWide()
            // is on, so an unscoped title lookup through the bare Book model
            // would happily find another shelf's copy of the same title.
            //
            // The fallback code is derived from the shelf's own highest
            // rather than written as a literal, for the same
            // seeded-before-this-change database: BookCopyFactory draws from
            // a faker unique() pool over DT-0001..DT-9999, so any literal
            // this seeder picked could collide with an existing copy on
            // book_copies_bookshelf_id_code_key.
            $nextCode = function () use ($shelf): string {
                $max = (int) mb_substr((string) $shelf->bookCopies()->max('code'), 3);

                return 'DT-'.str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
            };

            // The lookup and the create are SEPARATE statements, never one
            // `??` chain, and that is not style. TenancyArchitectureTest's
            // tripwire looks for a where-shaped call followed by the tenant
            // column with no semicolon in between, and its character class
            // matches newlines — so a lookup falling through `??` into a
            // create that names the tenant column reads to it as a
            // hand-written tenant filter and fails the build. Measured: the
            // first version of this block did exactly that. (The same
            // reading-raw-source trap `CirculationArchitectureTest`'s
            // wall-clock grep sets — a comment counts as source, which is
            // why this one is worded around the pattern rather than quoting
            // it.)
            $demoBook = function (string $title, string $slug, string $author) use ($shelf, $nextCode): BookCopy {
                $book = $shelf->books()->where('title', $title)->first();
                if ($book === null) {
                    $book = Book::query()->create([
                        'bookshelf_id' => $shelf->id, 'title' => $title,
                        'slug' => $slug, 'author' => $author,
                        'language' => 'vi', 'is_published' => true,
                    ]);
                }

                $copy = $book->copies()->where('state', 'available')->orderBy('code')->first();
                if ($copy === null) {
                    $copy = BookCopy::query()->create([
                        'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
                        'code' => $nextCode(), 'state' => 'available',
                    ]);
                }

                return $copy;
            };

            // Anna Phạm Thu Hà waits for Totto-chan — a pending row, no
            // copy named. A pending request names a title, never a copy.
            $anna = User::query()->where('full_name', 'Phạm Thu Hà')->firstOrFail();
            $tottoCopy = $demoBook('Totto-chan Bên Cửa Sổ', 'totto-chan-ben-cua-so', 'Kuroyanagi Tetsuko');
            BorrowRequest::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $tottoCopy->book_id,
                'member_id' => $anna->id, 'status' => 'pending',
                'requested_at' => Carbon::parse($today)->subDay(),
            ]);

            // Têrêsa Lê Ngọc Ánh has a book put aside — approved, the copy
            // held, three days to collect it (LendingSettings' own default
            // hold_days; this shelf overrides nothing). "Full approval
            // shape" above is a claim about WHICH COLUMNS are populated,
            // not about the value: LoanTerms::holdExpiry is
            // $now->addDays($holdDays), a timestamp at the hour of the
            // approval, where this is midnight of day+3, because a seeder
            // has no approval instant to inherit. Nothing on the queue or
            // the bell reads the time of day — holdExpired compares against
            // now, and the notification payload is a date string — so the
            // demo is faithful where it is looked at and coarser where it
            // is not.
            $teresa = User::query()->where('full_name', 'Lê Ngọc Ánh')->firstOrFail();
            $namCopy = $demoBook('Đất Rừng Phương Nam', 'dat-rung-phuong-nam', 'Đoàn Giỏi');
            $holdUntil = Carbon::parse($today)->addDays(3);
            BorrowRequest::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $namCopy->book_id,
                'member_id' => $teresa->id, 'status' => 'approved',
                'requested_at' => Carbon::parse($today)->subDays(2),
                'copy_id' => $namCopy->id, 'hold_expires_at' => $holdUntil,
                'decided_by' => $manager->id, 'decided_at' => Carbon::parse($today)->subDay(),
            ]);
            $namCopy->update(['state' => 'held']);

            // The bell. user_id is a users(id), never a membership id —
            // the recurring trap SweepReminders' own comment names. The
            // payload matches what ApproveBorrowRequest stores, so
            // NotificationSentences renders the real sentence with the
            // real date rather than a dateless fallback.
            Notification::query()->create([
                'bookshelf_id' => $shelf->id, 'user_id' => $teresa->id,
                'kind' => 'request_approved',
                'payload' => ['title' => 'Đất Rừng Phương Nam', 'hold_until' => $holdUntil->toDateString()],
            ]);
        }

        // Task 20: a shelf with a voice — one book with comments on it,
        // shelf news, and an offer waiting. Without these rows the four
        // screens this phase shipped (the book page's comment area,
        // /manage/comments, /manage/announcements and /manage/donations)
        // demo as empty states on a shelf that visibly has books, loans,
        // a queue and an audit trail.
        //
        // Rows are INSERTED, not produced by running the commands — the
        // idiom of every block above, and the same reason: a seeder has no
        // authenticated actor, and the audit block below is where this
        // seeder puts its one deliberate exception to that.
        //
        // Each of the three tables gets its OWN doesntExist() guard rather
        // than one shared guard, so a dev database seeded before this
        // change picks up whichever of the three it is missing.
        $commentBook = $shelf->books()->where('slug', 'de-men-phieu-luu-ky')->first()
            ?? $shelf->books()->orderBy('slug')->first();

        if ($commentBook !== null && $shelf->comments()->doesntExist()) {
            // Two readers, not one, and neither is the manager: a comment
            // whose author moderates it is not a shape the moderation
            // screen can ever produce.
            $lan = User::query()->where('full_name', 'Nguyễn Thị Lan')->firstOrFail();
            $anh = User::query()->where('full_name', 'Lê Ngọc Ánh')->firstOrFail();

            // PENDING: what /manage/comments is FOR. Carries no
            // moderated_by and no moderated_at — App\Actions\Community\
            // ApproveComment writes that pair together, and a pending row
            // holding either would be a state no command mints.
            Comment::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $commentBook->id,
                'author_id' => $lan->id, 'status' => 'pending',
                'body' => 'Truyện hay lắm ạ, con đọc một buổi là hết.',
            ]);

            // APPROVED: the one status the reader's book page shows
            // (INV-9), so the comment area on that page is not empty. The
            // moderator pair is written because approval writes it.
            Comment::query()->create([
                'bookshelf_id' => $shelf->id, 'book_id' => $commentBook->id,
                'author_id' => $anh->id, 'status' => 'approved',
                'body' => 'Em thích nhất đoạn Dế Mèn gặp Dế Trũi.',
                'moderated_by' => $manager->id,
                'moderated_at' => Carbon::parse(app(Clock::class)->today())->subDay(),
            ]);
        }

        if ($shelf->announcements()->doesntExist()) {
            $newsDay = Carbon::parse(app(Clock::class)->today());

            // body and body_text hold the SAME plain text, which is this
            // phase's divergence 5: there is no rich editor, so the
            // derivation and its source are one string. The excerpt still
            // comes from body_text, so a later editor changes what is
            // written here and nothing that reads it.
            $notice = 'Tủ sách mở cửa sáng Chủ nhật, sau lễ, tại nhà xứ. Mời các bạn đến mượn sách.';

            // PINNED and PUBLISHED — the row this seeder wants at the
            // top of the reader's list, which orders is_pinned first and
            // shows nothing whose published_at is null or in the future.
            // No expires_at: a null expiry is "shows until somebody hides
            // it", which is what a standing notice is.
            Announcement::query()->create([
                'bookshelf_id' => $shelf->id,
                'title' => 'Giờ mở cửa tủ sách', 'slug' => 'gio-mo-cua-tu-sach',
                'body' => $notice, 'body_text' => $notice,
                'is_pinned' => true, 'published_at' => $newsDay->copy()->subDays(2),
                'author_id' => $manager->id,
            ]);

            // DRAFT — published_at null, which is the whole of what a
            // draft is on this table (App\Actions\Community\
            // HideAnnouncement's own docblock says so of the reverse
            // direction). It must NOT appear on the reader's list, which
            // is the half of the manager's screen this row demos.
            $draft = 'Danh sách sách mới sẽ được cập nhật sau khi kiểm kê xong.';
            Announcement::query()->create([
                'bookshelf_id' => $shelf->id,
                'title' => 'Sách mới sắp về', 'slug' => 'sach-moi-sap-ve',
                'body' => $draft, 'body_text' => $draft,
                'is_pinned' => false, 'published_at' => null,
                'author_id' => $manager->id,
            ]);
        }

        if ($shelf->donations()->doesntExist()) {
            // THE DONOR IS A MEMBERSHIP, NOT A USER — book_donations
            // .donor_membership_id references memberships(id), the reverse
            // of comments.author_id above, which is a users(id). Both hold
            // 36-char uuid strings, so nothing but the lookup says which.
            // Resolved through $shelf->memberships() — the hasMany
            // relation, never a hand-written shelf-column filter, matching
            // every block above.
            $ha = User::query()->where('full_name', 'Phạm Thu Hà')->firstOrFail();
            $haMembership = $shelf->memberships()->where('user_id', $ha->id)->firstOrFail();

            // PENDING, and no decided_by/decided_at/decision_note: the two
            // decisions App\Actions\Community\ReceiveDonation and
            // DeclineDonation make write those, and the queue this row
            // exists to fill is the pending one.
            BookDonation::query()->create([
                'bookshelf_id' => $shelf->id,
                'donor_membership_id' => $haMembership->id,
                'description' => 'Khoảng mười cuốn truyện tranh, còn khá mới.',
                'estimated_count' => 10,
                'status' => 'pending',
            ]);
        }

        // Task 10: a living audit page — DemoShelfSeeder inserts models
        // directly (no commands run), so without this the audit page is an
        // empty state beside a shelf that visibly has books and loans.
        // $shelf->auditLogs() — the hasMany relation added on Bookshelf for
        // this purpose — not a hand-written filter naming the bookshelf
        // column: TenancyArchitectureTest confines that kind of filtering
        // to BookshelfScope/ResolveTenant/AuditLogQuery only, and a literal
        // filter anywhere in this seeder would turn that suite red.
        if ($shelf->auditLogs()->doesntExist()) {
            $seededLoan = $shelf->loans()->first();

            // Fix round (whole-branch review, finding 4): these two rows
            // used to go straight through AuditLog::query()->create(),
            // bypassing AuditRecorder entirely — no AuditSecrets walk, no
            // tenant-bound check, and invisible to
            // AuditActionCensusTest's writer inventory (that census scans
            // for `->record(`, not for a raw AuditLog insert). Both
            // actions here already have a mapped sentence, so today's two
            // rows render correctly either way — but nothing stopped a
            // third demo row from being minted with an unmapped action
            // and rendering the "undescribed system action" fallback on
            // the demo shelf, silently, since this call site was never
            // measured. AuditRecorder needs a bound tenant AND an
            // authenticated actor (it reads both from context, never from
            // a parameter — see its own docblock) neither of which a
            // seeder has by default; bound and logged in for exactly this
            // block, cleared right after.
            app(TenantContext::class)->set($shelf, $managerMembership);
            Auth::login($manager);

            app(AuditRecorder::class)->record('loan.created', 'loan', $seededLoan?->id,
                ['copy_state' => 'available'],
                $seededLoan === null ? null : [
                    'copy_state' => 'on_loan',
                    'borrower_id' => $seededLoan->borrower_id,
                    'due_on' => $seededLoan->due_on->toDateString(),
                    'title' => $seededLoan->copy?->book?->title,
                ]);

            app(AuditRecorder::class)->record('membership.approved', 'membership',
                $shelf->memberships()->where('role', 'reader')->where('status', 'active')->value('id'),
                ['status' => 'pending'], ['status' => 'active']);

            Auth::logout();
        }

        // This is the last seeder in the run today, so leaving the
        // system-wide context set would be harmless in practice — but the
        // tenant scope is designed to fail closed, and a seeder appended
        // after this one would silently inherit actSystemWide() rather than
        // tripping BookshelfScope's guard. Clear it explicitly so that
        // property holds regardless of seeder order.
        app(TenantContext::class)->clear();
    }
}
