<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use Inertia\Inertia;
use Inertia\Response;

/**
 * BR §16.1's public contact page (spec D2) — OPS §3.1's `GetSiteContact`,
 * rendered for whoever asks.
 *
 * **THIS PAGE IS PUBLIC IN THE STRONGEST SENSE THE APPLICATION HAS.** Not
 * "no membership required" — no bookshelf required. BR §16.1 says it in as
 * many words: a parish with no bookshelf yet has no membership anywhere, so
 * this is its only route to a human. So there is no `auth`, no `role:`, and
 * above all no `tenant` middleware on the route, and nothing here may read a
 * model that expects one.
 *
 * **NOTHING IN `resources/js` LINKS HERE YET** — measured, `grep -rn
 * 'route("contact")' resources/js` returns nothing at this commit. In the
 * reference the portal directory's empty state is what sends a parish to
 * this page; porting that link belongs to whoever owns the portal's empty
 * state, not to this task, and it is written down here rather than left as
 * a page that exists and cannot be found.
 *
 * **IT TOUCHES NO SHELF-SCOPED MODEL, AND THAT IS A HARD CONSTRAINT RATHER
 * THAN A TIDINESS PREFERENCE.** `BookshelfScope` (app/Models/Scopes/
 * BookshelfScope.php) fails closed: a scoped model queried with no tenant
 * bound throws `RuntimeException` instead of returning every shelf's rows.
 * With no `tenant` middleware on this route nothing ever binds one, so a
 * single `Book::query()` added here would 500 for exactly the stranger the
 * page was built to serve — while every test that signs somebody in stays
 * green. `SystemSetting` carries no `BelongsToBookshelf` — it is the
 * installation's own single row, not any parish's — which is what makes it
 * readable from here as it stands, with no `actSystemWide()` widening (which
 * `WideningArchitectureTest` fences to `app/Actions/Admin/` anyway).
 *
 * **A BLANK DETAIL IS OMITTED, NEVER FILLED IN.** The reference's page
 * printed an invented person and telephone number from a fixture on every
 * deployment before it was corrected; the correction is that an unset field
 * simply does not render. Normalising `''` to `null` happens HERE, once, so
 * the screen has one emptiness to test rather than two — a whitespace-only
 * `contact_hours` saved by a volunteer is as absent as a null one.
 *
 * **NO FEEDBACK FORM.** BR §16.1 lists one and D2 defers it to 3c
 * deliberately, to land together with the inbox that reads it: there is no
 * feedback write path in this application today, and `/admin/feedback` is
 * 3c's. A form whose messages land where no screen can read them promises a
 * reply that cannot come, which is worse than the honest sentence the page
 * shows instead. `docs/known-gaps.md` records it as a deferral rather than
 * leaving it to look like an oversight.
 */
class ContactController extends Controller
{
    public function show(): Response
    {
        $settings = SystemSetting::query()->sole();

        return Inertia::render('contact', [
            // Named one at a time rather than serialised: the row also
            // carries the six lending defaults and the two provenance
            // columns, none of which is any of the public's business, and
            // handing the attribute bag to Inertia would publish whatever
            // column a future migration adds. The keys drop the `contact_`
            // prefix the columns carry — on this page every value is the
            // contact.
            'contact' => [
                'name' => self::filled($settings->contact_name),
                'phone' => self::filled($settings->contact_phone),
                'hours' => self::filled($settings->contact_hours),
            ],
        ]);
    }

    /** A field that is null, empty or whitespace-only is one the page omits. */
    private static function filled(?string $value): ?string
    {
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
