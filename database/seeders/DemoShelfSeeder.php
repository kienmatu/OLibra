<?php

namespace Database\Seeders;

use App\Models\AuditLog;
use App\Models\Book;
use App\Models\BookCopy;
use App\Models\Bookshelf;
use App\Models\Loan;
use App\Models\Membership;
use App\Models\ParishUnit;
use App\Models\User;
use App\Support\Clock;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

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
        Membership::query()->firstOrCreate(
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
        if ($shelf->books()->doesntExist()) {
            Book::factory()->count(4)->create(['bookshelf_id' => $shelf->id])
                ->each(fn (Book $book) => BookCopy::factory()->count(2)->create([
                    'bookshelf_id' => $shelf->id, 'book_id' => $book->id,
                ]));
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
        $people = [
            ['Maria', 'Nguyễn Thị Lan', 'active'], ['Giuse', 'Trần Minh', 'active'],
            ['Têrêsa', 'Lê Ngọc Ánh', 'active'], ['Anna', 'Phạm Thu Hà', 'active'],
            ['Phêrô', 'Nguyễn Văn Bình', 'pending'],
        ];
        foreach ($people as [$saint, $name, $status]) {
            $person = User::query()->where('full_name', $name)->first()
                ?? User::factory()->create(['saint_name' => $saint, 'full_name' => $name, 'phone' => '0912345678', 'phone_missing_reason' => null]);
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
            AuditLog::query()->create([
                'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
                'action' => 'loan.created', 'entity_type' => 'loan',
                'entity_id' => $seededLoan?->id,
                'before' => ['copy_state' => 'available'],
                'after' => $seededLoan === null ? null : [
                    'copy_state' => 'on_loan',
                    'borrower_id' => $seededLoan->borrower_id,
                    'due_on' => $seededLoan->due_on->toDateString(),
                    'title' => $seededLoan->copy?->book?->title,
                ],
                'context' => [],
            ]);
            AuditLog::query()->create([
                'bookshelf_id' => $shelf->id, 'actor_id' => $manager->id,
                'action' => 'membership.approved', 'entity_type' => 'membership',
                'entity_id' => $shelf->memberships()
                    ->where('role', 'reader')->where('status', 'active')->value('id'),
                'before' => ['status' => 'pending'], 'after' => ['status' => 'active'],
                'context' => [],
            ]);
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
