<?php

use App\Actions\Members\ApproveMembership;
use App\Actions\Members\RejectMembership;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\User;
use App\Support\Notifications\NotificationKind;
use App\Support\Notifications\Notifier;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Shelf + acting manager + one pending reader membership. Names outside
 * UserFactory's pool. @return array{Bookshelf, User, Membership}
 */
function nwpFix(string $slug = 'dong-thap-nwp'): array
{
    app(TenantContext::class)->actSystemWide();
    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);
    $manager = User::factory()->create(['full_name' => 'Maria Quản Lý Kho']);
    $managerMembership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);
    $readerUser = User::factory()->create(['full_name' => 'Têrêsa Bạn Đọc Nhỏ']);
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $readerUser->id, 'role' => 'reader', 'status' => 'pending',
    ]);
    app(TenantContext::class)->set($shelf, $managerMembership);
    test()->actingAs($manager);

    return [$shelf, $manager, $membership];
}

it('approving a registration tells the reader, and nobody else', function () {
    [$shelf, $manager, $membership] = nwpFix();

    app(ApproveMembership::class)->execute($manager, $membership);

    // Row COUNT as well as recipient — notifying the actor is the
    // ordinary way this rule gets broken (the reference's test note).
    $rows = Notification::query()->get();
    expect($rows)->toHaveCount(1)
        ->and($rows[0]->user_id)->toBe($membership->user_id)   // users.id, never membership id
        ->and($rows[0]->kind)->toBe('membership_approved')
        ->and($rows[0]->bookshelf_id)->toBe($shelf->id);
});

it('a rejection carries its reason to the reader', function () {
    [, $manager, $membership] = nwpFix('dong-thap-nwp-rej');

    app(RejectMembership::class)->execute($manager, $membership, 'chưa đủ thông tin liên hệ');

    $row = Notification::query()->firstOrFail();
    expect($row->kind)->toBe('membership_rejected')
        ->and($row->payload)->toMatchArray(['reason' => 'chưa đủ thông tin liên hệ']);
});

it('a notification cannot survive the transaction that wrote it failing', function () {
    [, , $membership] = nwpFix('dong-thap-nwp-tx');

    // Notifier writes inside the CALLER's transaction — fail the caller
    // mid-flight and nothing survives (OPS §7: written by the command
    // named, in the same transaction as the state change it announces).
    try {
        DB::transaction(function () use ($membership): void {
            app(Notifier::class)->notify($membership->user_id, NotificationKind::MembershipApproved);
            throw new RuntimeException('mid-flight failure');
        });
    } catch (RuntimeException) {
    }

    expect(Notification::query()->count())->toBe(0);
});
