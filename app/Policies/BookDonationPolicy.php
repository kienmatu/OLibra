<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * OPS §4.4's donation commands, delegating to the act-as gates the way
 * CommentPolicy and AnnouncementPolicy do.
 *
 * create() takes no BookDonation, and cannot: the row does not exist
 * yet. OPS §4.4 gives OfferDonation the `reader` caller, which is the
 * one thing this method decides; the decisions on an offer are a
 * manager's and arrive with the commands that make them.
 *
 * WHOSE offer it is stays out of this class deliberately, following the
 * rule CommentPolicy states: a policy body that reads the row starts
 * answering questions about a specific donation, and a denial becomes an
 * existence oracle. The donor is decided one layer along, by
 * App\Actions\Community\OfferDonation, which takes the id from the bound
 * membership rather than from anything a caller supplies; what the row
 * BELONGS to is decided one layer earlier still, by BookshelfScope on
 * the model.
 */
final class BookDonationPolicy
{
    public function create(User $user): bool
    {
        return Gate::forUser($user)->allows('act-as-reader');
    }
}
