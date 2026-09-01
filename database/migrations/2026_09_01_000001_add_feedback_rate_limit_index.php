<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Phase 3c-ii Task 1: the index the rate limit's count needs.
     *
     * SubmitFeedback runs `count(*) where guest_hash = ? and created_at > ?`
     * on EVERY submission, before it writes anything, and the feedback table
     * shipped in 2026_08_26_000012 with no index on guest_hash at all — the
     * plan asks for a decision, and this is it. Without one the count is a
     * full scan of every message ever sent to the whole installation, growing
     * with the deployment rather than with the parish: this is the one table
     * whose rows are written by unauthenticated callers, so it is also the
     * one whose volume an outsider chooses.
     *
     * (guest_hash, created_at) rather than guest_hash alone: both predicates
     * are in the same WHERE, the equality leads, and the range on created_at
     * then rides the same index instead of filtering rows after they are
     * read. That is the whole access path — the count reads no other column,
     * so this is a covering index for it.
     *
     * NOT UNIQUE, obviously — three rows a day per number is the rule the
     * count enforces, not one — so unlike the live-request-key migration this
     * cannot fail on existing data. One statement, so there is no half-landed
     * state to roll back around.
     */
    public function up(): void
    {
        Schema::table('feedback', function (Blueprint $table) {
            $table->index(['guest_hash', 'created_at'], 'feedback_rate_limit');
        });
    }

    public function down(): void
    {
        Schema::table('feedback', function (Blueprint $table) {
            $table->dropIndex('feedback_rate_limit');
        });
    }
};
