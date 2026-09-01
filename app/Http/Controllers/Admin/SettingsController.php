<?php

namespace App\Http\Controllers\Admin;

use App\Actions\Admin\UpdateSiteContact;
use App\Actions\Admin\UpdateSystemDefaults;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateSiteContactRequest;
use App\Http\Requests\Admin\UpdateSystemDefaultsRequest;
use App\Models\SystemSetting;
use App\Models\User;
use App\Support\Clock;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.4's system-settings screen, spec D1 — the last configuration
 * surface an installation has, and the only one whose contents a member of
 * the public can see.
 *
 * **TWO FORMS, TWO SUBMITS, TWO REFUSALS, and the contact block is first.**
 * §16.4 puts it there because it is what a stranger reads on `/contact`, and
 * the split is 3b-i's own rule: a number out of range in the defaults must
 * not block correcting the administration's phone. Each submit flashes its
 * own sentence — a page with two independently-submittable forms cannot say
 * which one saved if both land on the same undifferentiated success.
 *
 * **THE WRITES ARE ACTIONS', NOT THIS CLASS'S.** Both audit globally, and
 * the audit configurator that lets a tenant-less request write a row is
 * fenced to `app/Actions/Admin/` by `WideningArchitectureTest`. What is left
 * here is what a controller is for: which component renders, which route a
 * redirect lands on, and which sentence flashes.
 *
 * **NO WIDENING, and none is needed.** `SystemSetting` carries no
 * `BelongsToBookshelf` — it is the installation's row, not any parish's — so
 * it is readable from the tenant-less `/admin` group as it stands.
 *
 * **THE LOCALE AND TIMEZONE ARE READ-ONLY AND HAVE NO COLUMN.** §16.4 lists
 * both and the reference renders both as fixed text rather than a `<select>`
 * with a single option, which would be a control that looks operable and is
 * not. The timezone string comes from `App\Support\Clock::ZONE`, the one
 * declaration of BR §5.4's civil zone that everything written from Phase 2c
 * onward reads — never a fresh literal, which `LabelsArchitectureTest`
 * censuses. The locale is not a value at all: the interface is Vietnamese,
 * so its label is copy, on the screen, beside the sentence explaining both.
 *
 * **THE PROP IS BUILT BY HAND** rather than serialising the model, the shape
 * `ShelfController::edit` uses: `changed_by` is a user id no screen shows
 * and `id` is the constant 1, and handing the attribute bag to Inertia would
 * put both on the wire in a shape that grows silently the day a migration
 * adds a column.
 */
class SettingsController extends Controller
{
    public function index(): Response
    {
        // Redundant with EnsureSuperAdmin today, and kept for the reason
        // ShelfController::index keeps its own: this is the screen the two
        // writes are made from, and a page whose permission is implicit is
        // the one page in the area nothing states a rule about.
        Gate::authorize('update', SystemSetting::class);

        $settings = SystemSetting::query()->sole();

        return Inertia::render('admin/settings/index', [
            'contact' => [
                'contact_name' => $settings->contact_name,
                'contact_phone' => $settings->contact_phone,
                'contact_hours' => $settings->contact_hours,
            ],
            // Under the shelf-side keys, not the column names: these are
            // the values a new shelf's own settings bag receives (Task 7),
            // and the screen shows the same words the shelf editor does.
            'defaults' => [
                'loan_days' => $settings->default_loan_days,
                'max_concurrent_loans' => $settings->default_max_concurrent_loans,
                'max_renewals' => $settings->default_max_renewals,
                'renewal_days' => $settings->default_renewal_days,
                'hold_days' => $settings->default_hold_days,
                'due_soon_days' => $settings->default_due_soon_days,
            ],
            // Read-only, and from Clock rather than a literal — see the
            // class docblock.
            'timezone' => Clock::ZONE,
            // The provenance half of D1's three column groups, rendered in
            // the civil zone rather than the UTC the column stores: "when
            // did an administrator last change these" is a fact about a
            // person's day, and both writers fill it explicitly because the
            // model keeps no conventional timestamps.
            //
            // GATED ON `changed_by`, NOT ON `changed_at`, and that is not
            // interchangeable. The column is `->useCurrent()` and NOT
            // nullable, so the row the migration seeded already carries the
            // instant the installation was migrated — rendering it would
            // tell an administrator that somebody changed these settings on
            // a day nobody did. `changed_by` is the one provenance column
            // that can be null, so it is the one that means "never edited".
            'changedAt' => $settings->changed_by === null
                ? null
                // No nullsafe operator: the column is NOT nullable, and
                // PHPStan says so from the model's own cast. The null above
                // is the only null this prop can carry.
                : $settings->changed_at->setTimezone(Clock::ZONE)->format('d/m/Y H:i'),
        ]);
    }

    /**
     * The contact form's own submit. It shares no route, no Form Request and
     * no flash with the defaults form.
     */
    public function updateContact(UpdateSiteContactRequest $request, UpdateSiteContact $updateContact): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        // Three keys read out one at a time, never a spread — the shape
        // every write in this area uses, so the day a fourth field is added
        // to the rules is not the day it silently reaches the command.
        $updateContact->execute($user, [
            'contact_name' => $validated['contact_name'] ?? null,
            'contact_phone' => $validated['contact_phone'] ?? null,
            'contact_hours' => $validated['contact_hours'] ?? null,
        ]);

        return redirect()
            ->route('admin.settings')
            ->with('success', __('rules.site_contact_saved_flash'));
    }

    /** The defaults form's own submit, with its own sentence. */
    public function updateDefaults(UpdateSystemDefaultsRequest $request, UpdateSystemDefaults $updateDefaults): RedirectResponse
    {
        /** @var User $user */
        $user = $request->user();
        $validated = $request->validated();

        $updateDefaults->execute($user, [
            'loan_days' => $validated['loan_days'],
            'max_concurrent_loans' => $validated['max_concurrent_loans'],
            'max_renewals' => $validated['max_renewals'],
            'renewal_days' => $validated['renewal_days'],
            'hold_days' => $validated['hold_days'],
            'due_soon_days' => $validated['due_soon_days'],
        ]);

        return redirect()
            ->route('admin.settings')
            ->with('success', __('rules.system_defaults_saved_flash'));
    }
}
