import { connect } from "./client";
import { migrate } from "./migrate";

/**
 * `bun run db:migrate` — applies every pending migration to whatever
 * `MIGRATION_DATABASE_URL` names (compose.yaml's `db`, unless overridden).
 * Thin on purpose: `migrate()` is the tested unit, this is just the process
 * that calls it and reports what happened.
 *
 * CRITICAL 2: deliberately not `DATABASE_URL` — that now names `olibra_pool`,
 * the non-superuser connection-pool role, which lacks the privileges a
 * migration needs (creating roles, enabling row level security). Migrations
 * run as the `olibra` superuser, which `MIGRATION_DATABASE_URL` names.
 */
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. Migrations need the olibra " +
        "superuser's privileges, not olibra_pool (DATABASE_URL) — see .env.example.",
    );
  }
  const sql = connect(url);
  try {
    const { applied } = await migrate(sql);
    if (applied.length === 0) {
      console.log("No pending migrations.");
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const name of applied) console.log(`  ${name}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
