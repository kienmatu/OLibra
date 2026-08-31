<?php

namespace App\Actions\Admin;

use App\Exceptions\RuleViolated;
use App\Models\Bookshelf;
use App\Models\BookshelfContact;
use App\Models\User;
use App\Support\AuditRecorder;
use App\Support\ConcurrencyRetry;
use App\Support\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.5's shelf lifecycle, fourth command: BR §189's up to three people a
 * reader may phone about this shelf. Port of the contacts half of the
 * reference's `updateBookshelfSettings`
 * (old_next/src/domain/admin/commands/bookshelves.ts:326-380).
 *
 * ITS OWN COMMAND, NOT PART OF THE PROFILE SAVE (spec D2). The reference
 * split its single all-fields form for exactly this: while contacts rode
 * along with the profile, a shelf the migration deliberately left with zero
 * contacts could not change so much as its loan period without a super
 * admin first naming somebody. Here the split goes one step further than the
 * reference's — profile, policy and contacts are three forms, three submits
 * and three refusals — because spec D8 adds a fourth section in 3b-ii and
 * per-section forms make that an addition rather than a restructure.
 *
 * THE FORM POSTS ALL THREE BLOCKS EVERY TIME, so this is a wholesale
 * replacement rather than a diff: "what the form said" is the complete truth
 * about this shelf's contacts. A BLANK NAME MEANS NO ROW, NOT AN EMPTY ROW
 * (spec D3) — a volunteer who cleared block 2 removed that contact, and
 * storing a nameless row would put a blank line and a stray phone number on
 * every screen that lists who to call.
 *
 * POSITION 1 IS REQUIRED BY THE INTERFACE, NOT BY THE COLUMN (spec D3). A
 * shelf onboarded before this table existed may hold no contacts at all and
 * is flagged incomplete rather than assigned an invented volunteer — 3a's
 * dashboard already returns `contactsMissing` for it. What is refused is the
 * *save that would leave the gap*, and it is refused before anything is
 * written, so a submit missing position 1 does not soft-delete the existing
 * contacts on its way to failing. The Form Request refuses it first; the
 * guard below is the layer that keeps that true for a caller that is not
 * that form.
 *
 * REMOVAL IS A SOFT DELETE AND THAT IS WHAT FREES THE SLOT.
 * `bookshelf_contacts.position_key` is a generated hash of shelf and
 * position that is NULL once `deleted_at` is set, under a unique index — so
 * a retired contact stops holding the position it used to occupy, and the
 * order of operations inside the transaction does not have to be choreo-
 * graphed around a live-row collision. Positions are independent: a shelf
 * may hold contacts at 1 and 3 with nothing at 2, and nothing here shifts
 * anyone up.
 *
 * THE WIDENING IS REAL HERE, unlike in this directory's other three
 * commands. `BookshelfContact` carries `BelongsToBookshelf`, so its scope
 * throws under the tenant-less `/admin` group; widening is the sanctioned
 * way past that (spec D0) and this directory is one of the two
 * `WideningArchitectureTest` allows it in. THE ROWS ARE STILL REACHED
 * THROUGH THE RELATION and never through a hand-written shelf-column
 * predicate: under a widening the scope adds no predicate at all, so the
 * relation is the only thing keeping one parish's save off another parish's
 * contacts — and the create path takes its `bookshelf_id` from the relation
 * too, since the creating hook also stops stamping while widened.
 *
 * The audit row is `bookshelf.updated`, the same action the profile and
 * policy commands write, with the three slots before and after — and the
 * shelf's name in both bags, which is what the sentence for that action
 * substitutes. See `snapshot()`.
 */
final class UpdateBookshelfContacts
{
    public function __construct(
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @param  array<int, array{name: ?string, phone: ?string, role_label: ?string}>  $contacts  keyed 1..3
     */
    public function execute(User $actor, Bookshelf $shelf, array $contacts): void
    {
        Gate::forUser($actor)->authorize('update', $shelf);

        if (trim((string) ($contacts[1]['name'] ?? '')) === '') {
            throw new RuleViolated('contact_position_1_required');
        }

        DB::transaction(function () use ($shelf, $contacts): void {
            $this->context->systemWide(function () use ($shelf, $contacts): void {
                $existing = $shelf->contacts()->orderBy('position')->get()->keyBy('position');

                $before = $this->snapshot($shelf, $existing);

                foreach ([1, 2, 3] as $position) {
                    $name = trim((string) ($contacts[$position]['name'] ?? ''));
                    $row = $existing->get($position);

                    if ($name === '') {
                        // No row, not an empty row. A block left blank whose
                        // slot was already empty is simply nothing to do.
                        $row?->delete();

                        continue;
                    }

                    $fields = [
                        'name' => $name,
                        'phone' => $this->blankToNull($contacts[$position]['phone'] ?? null),
                        'role_label' => $this->blankToNull($contacts[$position]['role_label'] ?? null),
                    ];

                    if ($row !== null) {
                        $row->update($fields);

                        continue;
                    }

                    // From the relation, so the shelf column comes from the
                    // relation itself — under a widening the creating hook
                    // stamps nothing and an unstamped insert would be a
                    // contact belonging to no shelf.
                    $shelf->contacts()->create($fields + ['position' => $position]);
                }

                $after = $this->snapshot($shelf, $shelf->contacts()->orderBy('position')->get()->keyBy('position'));

                $this->audit->forShelf($shelf->id)->record('bookshelf.updated', 'bookshelf', $shelf->id, $before, $after);
            });
        }, ConcurrencyRetry::ATTEMPTS);
    }

    /**
     * The three slots as the audit log records them — always three entries,
     * `null` for an empty slot, so a reader of the log sees which position
     * gained or lost a person rather than a list that shortened.
     *
     * PLUS THE SHELF'S OWN NAME, unchanged either side. `AuditSentences`'
     * bookshelf.updated arm names the shelf out of $after (falling back to
     * $before) and this command moves no name, so without this key every
     * contacts save rendered "đã sửa thông tin MỘT tủ sách" on a log that
     * will be cross-shelf once Phase 3 ships the browser its class docblock names;
     * today's only reader is scoped to one shelf and supplies the name from
     * context. It sits beside `contact_1..3` rather than
     * inside one of them because it is a fact about the shelf, not about a
     * slot.
     *
     * @param  Collection<int, BookshelfContact>  $rows
     * @return array<string, string|array{name: string, phone: ?string, role_label: ?string}|null>
     */
    private function snapshot(Bookshelf $shelf, Collection $rows): array
    {
        $snapshot = ['name' => $shelf->name];

        foreach ([1, 2, 3] as $position) {
            $row = $rows->get($position);

            $snapshot['contact_'.$position] = $row === null ? null : [
                'name' => $row->name,
                'phone' => $row->phone,
                'role_label' => $row->role_label,
            ];
        }

        return $snapshot;
    }

    private function blankToNull(?string $value): ?string
    {
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
