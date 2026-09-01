<?php

use App\Actions\Admin\ApproveProfileChange;
use App\Actions\Admin\CancelProfileChange;
use App\Actions\Admin\ProposeAvatarChange;
use App\Actions\Admin\ProposeProfileChange;
use App\Actions\Admin\RejectProfileChange;
use App\Exceptions\RuleViolated;
use App\Models\AuditLog;
use App\Models\Bookshelf;
use App\Models\Membership;
use App\Models\Notification;
use App\Models\ProfileChangeRequest;
use App\Models\User;
use App\Support\Members\AvatarStorage;
use App\Support\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\Support\Images;

/**
 * Phase 3c-i Task 8, spec D6 — the photograph, and the first upload path
 * this port has ever had.
 *
 * The three things this file exists to hold:
 *
 *  - the avatar SHARES the lifecycle: the same pending row, the same
 *    field-wise merge, the same `profile_change.proposed` audit action, so
 *    this task adds no new one;
 *  - WHICH image is discarded depends on the decision — approve discards
 *    the SUPERSEDED one, reject and cancel the PROPOSED one;
 *  - the discard is ordered AFTER the commit, which only a FORCED ROLLBACK
 *    can pin: a successful reject deletes the same object under either
 *    ordering, so it cannot be the test that holds this.
 */

/** @return array{Bookshelf, User, Membership} */
function avShelf(string $slug = 'dong-thap', string $role = 'reader'): array
{
    app(TenantContext::class)->clear();

    $shelf = Bookshelf::factory()->create(['slug' => $slug, 'settings' => []]);

    $person = User::factory()->create([
        'saint_name' => 'Maria', 'full_name' => 'Nguyễn Thị Lan',
        'father_name' => 'Nguyễn Văn Hoà', 'mother_name' => 'Trần Thị Mai',
        'date_of_birth' => '2015-04-02', 'phone' => '0911111111',
        'phone_missing_reason' => null, 'email' => null, 'avatar_object' => null,
    ]);

    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $person->id, 'role' => $role, 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($person);

    return [$shelf, $person, $membership];
}

/** A real photograph, through the real pipeline, onto a faked disk. */
function avStore(string $bytes = ''): string
{
    return app(AvatarStorage::class)->store(avUpload($bytes));
}

function avUpload(string $bytes = '', string $name = 'anh.jpg', string $mime = 'image/jpeg'): UploadedFile
{
    $bytes = $bytes === '' ? Images::jpeg(800, 600) : $bytes;

    $path = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($path, $bytes);

    // test: true — an UploadedFile built by hand is otherwise refused as
    // "not an uploaded file" by is_uploaded_file().
    return new UploadedFile($path, $name, $mime, null, true);
}

function avRow(string $id): ProfileChangeRequest
{
    return ProfileChangeRequest::query()->withoutGlobalScopes()->findOrFail($id);
}

/**
 * A manager of this shelf, signed in, with the tenant bound to their OWN
 * membership — which is how a request arrives at the shelf-level decision
 * queue, and what MembershipPolicy::decide's act-as-manager gate reads.
 */
function avManager(Bookshelf $shelf): User
{
    $manager = User::factory()->create();
    $membership = Membership::factory()->for($shelf)->create([
        'user_id' => $manager->id, 'role' => 'manager', 'status' => 'active',
    ]);

    app(TenantContext::class)->set($shelf, $membership);
    test()->actingAs($manager);

    return $manager;
}

beforeEach(function () {
    Storage::fake('avatars');
});

it('stores the image and records a proposal that moves nothing on the person', function () {
    [$shelf, $person, $membership] = avShelf();

    $key = avStore();

    // The bytes are on the disk BEFORE the command runs, because OPS §4.3
    // requires the proposed image to exist while the request is pending —
    // a manager looks at it while deciding.
    Storage::disk('avatars')->assertExists($key);

    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $key);

    // Nothing on the person moved. That is the whole of BR:83 applied to
    // the photograph, which the product owner confirmed needs approval like
    // every other field.
    expect($person->fresh()->avatar_object)->toBeNull();

    $request = avRow($id);

    expect($request->status->value)->toBe('pending')
        ->and($request->proposed_values)->toBe(['avatar_object' => $key])
        // previous_values at PROPOSAL time — the column is NOT NULL.
        ->and($request->previous_values)->toBe(['avatar_object' => null]);

    // NO NEW AUDIT ACTION: it shares ProposeProfileChange's, because this
    // is one lifecycle with a file-carrying case.
    $audit = AuditLog::query()->withoutGlobalScopes()
        ->where('entity_id', $id)->firstOrFail();

    expect($audit->action)->toBe('profile_change.proposed')
        ->and($audit->entity_type)->toBe('profile_change_request')
        ->and($audit->after)->toBe(['avatar_object' => $key]);
});

it('merges into a pending text proposal instead of replacing it — and the graft holds both ways', function () {
    // Spec D1's merge, and the coupling ProfileProposals' own header warns
    // about: `avatar_object` is an ordinary field of the stored bag, so a
    // phone-only proposal under a literal "replace" reading would DROP a
    // pending photograph's key and orphan the image forever.
    [, $person, $membership] = avShelf();

    $first = app(ProposeProfileChange::class)
        ->execute($person, $membership, ['phone' => '0922222222']);

    $key = avStore();
    $second = app(ProposeAvatarChange::class)->execute($person, $membership, $key);

    expect($second)->toBe($first);

    // A THIRD proposal, text again, must not drop the photograph.
    app(ProposeProfileChange::class)
        ->execute($person, $membership, ['email' => 'lan@example.com']);

    expect(avRow($first)->proposed_values)->toBe([
        'phone' => '0922222222', 'avatar_object' => $key, 'email' => 'lan@example.com',
    ]);

    // One row, and the image is still there for the manager to look at.
    expect(ProfileChangeRequest::query()->withoutGlobalScopes()->count())->toBe(1);
    Storage::disk('avatars')->assertExists($key);
});

it('a second photograph supersedes the first, and the first one is deleted', function () {
    [, $person, $membership] = avShelf();

    $first = avStore();
    app(ProposeAvatarChange::class)->execute($person, $membership, $first);

    $second = avStore(Images::jpeg(400, 400));
    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $second);

    expect(avRow($id)->proposed_values)->toBe(['avatar_object' => $second]);

    Storage::disk('avatars')->assertMissing($first);
    Storage::disk('avatars')->assertExists($second);
});

it('APPROVING discards the SUPERSEDED photograph and keeps the new one', function () {
    // Spec D6's asymmetry, half one. Approve is the only one of the three
    // that discards an image the request did NOT propose.
    [$shelf, $person, $membership] = avShelf();

    $old = avStore();
    $person->avatar_object = $old;
    $person->save();

    $new = avStore(Images::jpeg(400, 400));
    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $new);

    $manager = avManager($shelf);

    $discarded = app(ApproveProfileChange::class)->execute($manager, avRow($id));

    expect($person->fresh()->avatar_object)->toBe($new)
        ->and($discarded)->toBe($old);

    Storage::disk('avatars')->assertMissing($old);
    Storage::disk('avatars')->assertExists($new);
});

it('REJECTING discards the PROPOSED photograph and leaves the one in force', function () {
    // Spec D6's asymmetry, half two — the opposite image from approve's.
    [$shelf, $person, $membership] = avShelf();

    $inForce = avStore();
    $person->avatar_object = $inForce;
    $person->save();

    $proposed = avStore(Images::jpeg(400, 400));
    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $proposed);

    $manager = avManager($shelf);

    $discarded = app(RejectProfileChange::class)
        ->execute($manager, avRow($id), 'Ảnh chưa rõ mặt.');

    expect($discarded)->toBe($proposed)
        ->and($person->fresh()->avatar_object)->toBe($inForce);

    Storage::disk('avatars')->assertMissing($proposed);
    Storage::disk('avatars')->assertExists($inForce);
});

it('CANCELLING discards the PROPOSED photograph too', function () {
    // OPS §4.3: "a rejected or cancelled proposal's image is deleted rather
    // than left orphaned in storage" — both verbs, not only the one a
    // manager uses.
    [, $person, $membership] = avShelf();

    $proposed = avStore();
    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $proposed);

    $discarded = app(CancelProfileChange::class)
        ->execute($person, $membership, avRow($id));

    expect($discarded)->toBe($proposed)
        ->and(avRow($id)->status->value)->toBe('cancelled');

    Storage::disk('avatars')->assertMissing($proposed);
});

it('a FORCED ROLLBACK leaves the image intact and the request still pending', function () {
    // THE TEST THE ORDERING EXISTS FOR, and the only one that can pin it.
    // A successful reject deletes the proposed object under EITHER
    // ordering — inside the transaction or after it — so it cannot
    // falsify the placement. This can: the commit is made to fail, and a
    // discard issued inside the transaction has by then already destroyed
    // an image the rolled-back row still points at.
    //
    // The failure is injected on the LAST write inside
    // RejectProfileChange's transaction (the reader's notification, which
    // BR:490 requires and which the Action deliberately writes inside the
    // same transaction as the decision), so every earlier statement —
    // including any discard a future edit slipped in among them — has
    // already run when it fires.
    [$shelf, $person, $membership] = avShelf();

    $proposed = avStore();
    $id = app(ProposeAvatarChange::class)->execute($person, $membership, $proposed);

    $manager = avManager($shelf);

    Notification::creating(function (): never {
        throw new RuntimeException('forced rollback');
    });

    try {
        expect(fn () => app(RejectProfileChange::class)
            ->execute($manager, avRow($id), 'Ảnh chưa rõ mặt.'))
            ->toThrow(RuntimeException::class, 'forced rollback');
    } finally {
        Notification::flushEventListeners();
    }

    // The row rolled back: it is STILL PENDING, so it still references the
    // photograph.
    expect(avRow($id)->status->value)->toBe('pending');

    // …and the photograph is therefore still there. Under a discard placed
    // inside the transaction this assertion is the one that goes red: the
    // request survives the rollback holding a key whose object is gone.
    Storage::disk('avatars')->assertExists($proposed);
});

it('refuses an oversize upload with file_too_large', function () {
    avShelf();

    // Just over AvatarLimits::MAX_BYTES. Padded rather than drawn — what
    // is under test is the byte count, and generating five megabytes of
    // real photograph would make the test slow for no extra guarantee.
    $fat = Images::jpeg(64, 64).str_repeat("\0", 5 * 1024 * 1024);

    expect(fn () => avStore($fat))
        ->toThrow(RuleViolated::class, 'file_too_large');
});

it('refuses HEIC by its own code, never as invalid_image', function () {
    // A HEIC file is a real photograph in a codec nothing here can decode,
    // and its refusal says so. `heic_not_supported` and `invalid_image` are
    // two LITERAL throws rather than a ternary, because the refusal census
    // (RuleViolatedCodesHaveSentencesTest) is blind to an expression in the
    // first argument and would register neither code.
    avShelf();

    expect(fn () => app(AvatarStorage::class)->store(
        avUpload(Images::jpeg(64, 64), 'anh.heic', 'image/heic'),
    ))->toThrow(RuleViolated::class, 'heic_not_supported');
});

it('refuses a file that is not an image with invalid_image, and stores nothing', function () {
    avShelf();

    expect(fn () => app(AvatarStorage::class)->store(
        avUpload('Đây không phải là ảnh.', 'anh.png', 'image/png'),
    ))->toThrow(RuleViolated::class, 'invalid_image');

    // A wrong content type earns the same code, and neither path leaves an
    // object behind.
    expect(fn () => app(AvatarStorage::class)->store(
        avUpload(Images::jpeg(64, 64), 'ke-hoach.pdf', 'application/pdf'),
    ))->toThrow(RuleViolated::class, 'invalid_image');

    expect(Storage::disk('avatars')->allFiles())->toBe([]);
});

it('mints its own key — nothing a caller sends becomes one', function () {
    // A guest may never NAME a storage key (RegistrationController.php:94),
    // and neither may a reader. The uploaded filename is
    // attacker-controlled and, for a Vietnamese reader, frequently full of
    // diacritics that have no business in a URL.
    avShelf();

    $key = app(AvatarStorage::class)->store(
        avUpload(Images::jpeg(64, 64), '../../Ảnh của Lan.html.jpg'),
    );

    expect($key)->toMatch('/^[0-9a-f-]{36}\.(webp|jpg)$/')
        ->and(str_contains($key, 'Lan'))->toBeFalse()
        ->and(str_contains($key, '..'))->toBeFalse();
});

it('the reader posts a photograph through their own page, and the refusal comes back in Vietnamese', function () {
    [$shelf, $person] = avShelf();

    test()->post(route('shelves.profile.avatar', ['shelf' => $shelf->slug]), [
        'avatar' => avUpload(),
    ])->assertRedirect();

    $request = ProfileChangeRequest::query()->withoutGlobalScopes()->firstOrFail();
    $key = $request->proposed_values['avatar_object'];

    expect($key)->toBeString()
        ->and($person->fresh()->avatar_object)->toBeNull();
    Storage::disk('avatars')->assertExists($key);

    // And the refusal path: bootstrap/app.php renders every RuleViolated as
    // back()->withErrors(['rule' => …]), which is the banner at the top of
    // the reader's own page.
    test()->post(route('shelves.profile.avatar', ['shelf' => $shelf->slug]), [
        'avatar' => avUpload('Đây không phải là ảnh.', 'anh.png', 'image/png'),
    ])->assertSessionHasErrors(['rule' => __('rules.invalid_image')]);
});
