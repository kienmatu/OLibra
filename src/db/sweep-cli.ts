import { connect } from "./client";
import { systemClock } from "../domain/kernel/clock";
import { sweepDueNotifications } from "../domain/notifications/sweep";

/**
 * `bun run db:sweep` — the caller `sweepDueNotifications` never had.
 *
 * D1 wrote the sweep, tested it, and made it idempotent; nothing in the
 * repository called it. `grep -rn sweepDueNotifications src bin scripts
 * package.json` returned the definition and nothing else, which means BR §15's
 * *"nhắc trả sách"* — the reminder a child gets three days before a book is due,
 * and the one when it lapses — has never fired in any deployment.
 *
 * The failure was invisible in exactly the way OPS §7's own bound predicts.
 * That paragraph argues the sweep is *housekeeping*: "if it doesn't run for a
 * few hours, nothing a user can observe becomes wrong… only late to be told."
 * That property is what made a job which never ran at all look like a working
 * system — every overdue badge, every dashboard count and every manager's
 * overdue list is computed from `olibra_now()` and was correct throughout.
 * Only the telling was missing.
 *
 * **A CLI rather than a route handler**, and the difference is who may run it.
 * A `route.ts` is reachable by anybody who can reach the application, so it
 * needs a shared secret, a header check, and a decision about what an
 * unauthenticated caller sees — three new things to get wrong for a job whose
 * whole purpose is to run unattended. A process invoked by `cron` or by the
 * host's scheduler is reachable by whoever can already run commands on the
 * host, which is the same person who can read the database directly. Nothing is
 * added to the attack surface.
 *
 * **`MIGRATION_DATABASE_URL`, not `DATABASE_URL`**, and the same reason
 * `migrate-cli.ts` gives at more length: `DATABASE_URL` names `olibra_pool`,
 * which is deliberately not a member of `olibra_admin`
 * (`20260808_13_pool_role.sql`) — and this sweep's first statement is
 * `set local role olibra_admin`, because it spans every shelf. Under
 * `DATABASE_URL` it fails with `42501: permission denied to set role`, which is
 * the correct refusal and not a useful way to discover the requirement at 3am.
 *
 * Exits non-zero on failure so a scheduler notices. It prints what it wrote
 * even when that is nothing, because "0 nhắc nhở" from a job that ran is a
 * different fact from silence.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. The sweep spans every shelf and " +
        "runs as olibra_admin, which olibra_pool (DATABASE_URL) may not " +
        "assume — see .env.example.",
    );
  }

  const sql = connect(url);
  try {
    const { dueSoon, overdue } = await sweepDueNotifications(sql, systemClock);
    console.log(
      `Sweep complete: ${dueSoon} due-soon, ${overdue} overdue notification(s).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
